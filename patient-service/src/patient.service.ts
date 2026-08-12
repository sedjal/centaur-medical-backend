import {
  AppError,
  SERVICE_PERMISSION_MAP,
  assertPermission,
  createDb,
  getDb,
  type InternalUser,
  type ServiceType,
} from '@centaur/shared';

export interface SpecialtyData {
  // GENERAL
  notes?: string | null;
  // URGENCE
  arrivalTime?: string;
  triageLevel?: string;
  initialSeverity?: string;
  // ONCOLOGIE
  tumorType?: string;
  stage?: string;
  currentTreatment?: string;
  // CARDIOLOGIE
  ecgResults?: string;
  restingHeartRate?: number;
  bloodPressure?: string;
}

export interface PatientInput {
  firstName: string;
  lastName: string;
  hospitalizationDate: string;
  service: ServiceType;
  status?: string;
  specialty: SpecialtyData;
}

async function nextPatientCode(): Promise<string> {
  const row = await getDb()('patients').count<{ count: string }>('* as count').first();
  const n = Number(row?.count || 0) + 124;
  return `PT-${String(n).padStart(6, '0')}`;
}

function assertServiceAccess(user: InternalUser, service: ServiceType): void {
  const perm = SERVICE_PERMISSION_MAP[service];
  assertPermission(user, perm);
}

export async function listPatients(filters?: {
  service?: ServiceType;
  search?: string;
}) {
  let q = getDb()('patients').select('*').orderBy('created_at', 'desc');
  if (filters?.service) q = q.where('service', filters.service);
  if (filters?.search) {
    const s = `%${filters.search}%`;
    q = q.where(function () {
      this.whereILike('first_name', s)
        .orWhereILike('last_name', s)
        .orWhereILike('patient_code', s);
    });
  }
  return q;
}

async function loadSpecialty(medicalRecordId: string, service: ServiceType) {
  if (service === 'GENERAL') {
    return getDb()('general_records').where({ medical_record_id: medicalRecordId }).first();
  }
  if (service === 'URGENCE') {
    return getDb()('emergency_records').where({ medical_record_id: medicalRecordId }).first();
  }
  if (service === 'ONCOLOGIE') {
    return getDb()('oncology_records').where({ medical_record_id: medicalRecordId }).first();
  }
  return getDb()('cardiology_records').where({ medical_record_id: medicalRecordId }).first();
}

export async function getPatient(id: string) {
  const patient = await getDb()('patients').where({ id }).first();
  if (!patient) throw new AppError('Patient not found', 404);
  const mr = await getDb()('medical_records').where({ patient_id: id }).first();
  let specialty = null;
  if (mr) {
    specialty = await loadSpecialty(mr.id, patient.service as ServiceType);
  }
  return { ...patient, medicalRecord: mr, specialty };
}

export function validateSpecialty(service: ServiceType, data: SpecialtyData): void {
  if (service === 'URGENCE') {
    if (!data.arrivalTime || !data.triageLevel || !data.initialSeverity) {
      throw new AppError('Emergency fields required', 400);
    }
  }
  if (service === 'ONCOLOGIE') {
    if (!data.tumorType || !data.stage || !data.currentTreatment) {
      throw new AppError('Oncology fields required', 400);
    }
  }
  if (service === 'CARDIOLOGIE') {
    if (!data.ecgResults || data.restingHeartRate == null || !data.bloodPressure) {
      throw new AppError('Cardiology fields required', 400);
    }
  }
}

async function insertSpecialty(
  trx: ReturnType<typeof getDb>,
  medicalRecordId: string,
  service: ServiceType,
  data: SpecialtyData
) {
  if (service === 'GENERAL') {
    await trx('general_records').insert({
      medical_record_id: medicalRecordId,
      notes: data.notes ?? null,
    });
  } else if (service === 'URGENCE') {
    await trx('emergency_records').insert({
      medical_record_id: medicalRecordId,
      arrival_time: data.arrivalTime,
      triage_level: data.triageLevel,
      initial_severity: data.initialSeverity,
    });
  } else if (service === 'ONCOLOGIE') {
    await trx('oncology_records').insert({
      medical_record_id: medicalRecordId,
      tumor_type: data.tumorType,
      stage: data.stage,
      current_treatment: data.currentTreatment,
    });
  } else {
    await trx('cardiology_records').insert({
      medical_record_id: medicalRecordId,
      ecg_results: data.ecgResults,
      resting_heart_rate: data.restingHeartRate,
      blood_pressure: data.bloodPressure,
    });
  }
}

async function writeAudit(
  user: InternalUser,
  action: string,
  resourceId: string,
  patientName: string,
  ip?: string,
  details?: unknown
) {
  await getDb()('audit_logs').insert({
    user_id: user.id,
    action,
    resource: 'PATIENT',
    resource_id: resourceId,
    patient_name: patientName,
    ip_address: ip || null,
    details: details ? JSON.stringify(details) : null,
  });
}

export async function createPatient(user: InternalUser, input: PatientInput, ip?: string) {
  assertPermission(user, 'patients:create');
  assertServiceAccess(user, input.service);
  validateSpecialty(input.service, input.specialty);

  const code = await nextPatientCode();
  const status =
    input.status ||
    (input.service === 'URGENCE' && input.specialty.initialSeverity?.toLowerCase().includes('crit')
      ? 'CRITICAL'
      : 'STABLE');

  const result = await getDb().transaction(async (trx) => {
    const [patient] = await trx('patients')
      .insert({
        patient_code: code,
        first_name: input.firstName,
        last_name: input.lastName,
        hospitalization_date: input.hospitalizationDate,
        service: input.service,
        status,
      })
      .returning('*');

    const [mr] = await trx('medical_records')
      .insert({ patient_id: patient.id, service: input.service })
      .returning('*');

    await insertSpecialty(trx as unknown as ReturnType<typeof getDb>, mr.id, input.service, input.specialty);
    return patient;
  });

  await writeAudit(
    user,
    'CREATE',
    result.id,
    `${result.first_name} ${result.last_name}`,
    ip,
    { service: input.service }
  );

  return getPatient(result.id);
}

export async function updatePatient(
  user: InternalUser,
  id: string,
  input: PatientInput,
  ip?: string
) {
  assertPermission(user, 'patients:update');
  assertServiceAccess(user, input.service);
  validateSpecialty(input.service, input.specialty);

  const existing = await getDb()('patients').where({ id }).first();
  if (!existing) throw new AppError('Patient not found', 404);
  assertServiceAccess(user, existing.service as ServiceType);

  await getDb().transaction(async (trx) => {
    await trx('patients').where({ id }).update({
      first_name: input.firstName,
      last_name: input.lastName,
      hospitalization_date: input.hospitalizationDate,
      service: input.service,
      status: input.status || existing.status,
      updated_at: trx.fn.now(),
    });

    let mr = await trx('medical_records').where({ patient_id: id }).first();
    if (!mr) {
      [mr] = await trx('medical_records')
        .insert({ patient_id: id, service: input.service })
        .returning('*');
    } else {
      await trx('medical_records').where({ id: mr.id }).update({
        service: input.service,
        updated_at: trx.fn.now(),
      });
      await trx('general_records').where({ medical_record_id: mr.id }).del();
      await trx('emergency_records').where({ medical_record_id: mr.id }).del();
      await trx('oncology_records').where({ medical_record_id: mr.id }).del();
      await trx('cardiology_records').where({ medical_record_id: mr.id }).del();
    }

    await insertSpecialty(trx as unknown as ReturnType<typeof getDb>, mr.id, input.service, input.specialty);
  });

  await writeAudit(
    user,
    'UPDATE',
    id,
    `${input.firstName} ${input.lastName}`,
    ip,
    { service: input.service }
  );

  return getPatient(id);
}

export async function deletePatient(user: InternalUser, id: string, ip?: string) {
  assertPermission(user, 'patients:delete');
  const existing = await getDb()('patients').where({ id }).first();
  if (!existing) throw new AppError('Patient not found', 404);
  assertServiceAccess(user, existing.service as ServiceType);

  await getDb()('patients').where({ id }).del();
  await writeAudit(
    user,
    'DELETE',
    id,
    `${existing.first_name} ${existing.last_name}`,
    ip
  );
  return { ok: true };
}

export async function getDashboardStats() {
  const CAPACITY: Record<string, number> = {
    GENERAL: 40,
    URGENCE: 30,
    ONCOLOGIE: 40,
    CARDIOLOGIE: 45,
  };
  const LABELS: Record<string, string> = {
    GENERAL: 'Chirurgie générale',
    URGENCE: 'Urgences',
    ONCOLOGIE: 'Oncologie',
    CARDIOLOGIE: 'Cardiologie',
  };

  const byService = await getDb()('patients')
    .select('service')
    .count('* as count')
    .groupBy('service');

  const total = await getDb()('patients').count<{ count: string }>('* as count').first();
  const critical = await getDb()('patients')
    .where({ status: 'CRITICAL' })
    .count<{ count: string }>('* as count')
    .first();

  const today = new Date().toISOString().slice(0, 10);
  const admittedToday = await getDb()('patients')
    .whereRaw('hospitalization_date::date = ?::date', [today])
    .count<{ count: string }>('* as count')
    .first();

  const byServiceMap: Record<string, number> = Object.fromEntries(
    (byService as Array<{ service: string; count: string | number }>).map((r) => [
      r.service,
      Number(r.count),
    ])
  );

  const occupancy = (['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE'] as const).map((service) => {
    const occupied = byServiceMap[service] || 0;
    const capacity = CAPACITY[service];
    const percent = capacity ? Math.round((occupied / capacity) * 100) : 0;
    const available = Math.max(capacity - occupied, 0);
    let load: 'Disponible' | 'Forte charge' | 'Saturé' = 'Disponible';
    if (percent >= 90) load = 'Saturé';
    else if (percent >= 70) load = 'Forte charge';
    return {
      service,
      label: LABELS[service],
      occupied,
      capacity,
      available,
      percent,
      load,
    };
  });

  const totalBeds = occupancy.reduce((s, o) => s + o.capacity, 0);
  const occupiedBeds = occupancy.reduce((s, o) => s + o.occupied, 0);

  const recent = await getDb()('patients').orderBy('created_at', 'desc').limit(5);

  return {
    total: Number(total?.count || 0),
    critical: Number(critical?.count || 0),
    admittedToday: Number(admittedToday?.count || 0),
    availableBeds: Math.max(totalBeds - occupiedBeds, 0),
    totalBeds,
    byService: byServiceMap,
    occupancy,
    recent,
  };
}

export async function listAuditLogs(limit = 50) {
  return getDb()
    .table('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.user_id')
    .select(
      'a.id',
      'a.action',
      'a.resource',
      'a.resource_id',
      'a.patient_name',
      'a.ip_address',
      'a.created_at',
      'u.email as user_email',
      'u.first_name as user_first_name',
      'u.last_name as user_last_name'
    )
    .orderBy('a.created_at', 'desc')
    .limit(limit);
}

createDb();
