import {
  AppError,
  SERVICE_PERMISSION_MAP,
  assertPermission,
  createDb,
  getDb,
  type InternalUser,
  type ServiceType,
} from '@centaur/shared';
import { createMedicalHistoryEvent } from './medical-history.service';
import { notifyBusinessEvent, patientStaffLabel } from './business-notify';

export interface SpecialtyData {
  notes?: string | null;
  arrivalTime?: string;
  triageLevel?: string;
  initialSeverity?: string;
  tumorType?: string;
  stage?: string;
  currentTreatment?: string;
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

type DbRow = Record<string, unknown>;

async function nextPatientCode(): Promise<string> {
  const row = await getDb()('patients').count<{ count: string }>('* as count').first();
  const n = Number(row?.count || 0) + 124;
  return `PT-${String(n).padStart(6, '0')}`;
}

const ALL_SERVICES: ServiceType[] = ['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE'];

export function allowedServices(user: InternalUser): ServiceType[] {
  return ALL_SERVICES.filter((s) => user.permissions.includes(SERVICE_PERMISSION_MAP[s]));
}

export function assertServiceAccess(user: InternalUser, service: ServiceType): void {
  const perm = SERVICE_PERMISSION_MAP[service];
  assertPermission(user, perm);
}

export function validateHospitalizationDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '').trim())) {
    throw new AppError('Invalid hospitalization date', 400);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new AppError('Invalid hospitalization date', 400);
  }
}

/** Query `service` must be in the caller's scope; otherwise 403. Search never widens the scope. */
export function resolveListScope(user: InternalUser, requested?: ServiceType): ServiceType[] {
  const allowed = allowedServices(user);
  if (!allowed.length) {
    throw new AppError('Forbidden: no service scope', 403);
  }
  if (requested) {
    if (!allowed.includes(requested)) {
      throw new AppError(`Forbidden: missing permission ${SERVICE_PERMISSION_MAP[requested]}`, 403);
    }
    return [requested];
  }
  return allowed;
}

export function filterPatientsByScope<
  T extends { service: string; first_name: string; last_name: string; patient_code: string }
>(rows: T[], allowed: ServiceType[], search?: string): T[] {
  let out = rows.filter((r) => allowed.includes(r.service as ServiceType));
  if (search && search.trim()) {
    const s = search.trim().toLowerCase();
    out = out.filter(
      (r) =>
        r.first_name.toLowerCase().includes(s) ||
        r.last_name.toLowerCase().includes(s) ||
        r.patient_code.toLowerCase().includes(s)
    );
  }
  return out;
}

export async function listPatients(
  user: InternalUser,
  filters?: {
    service?: ServiceType;
    search?: string;
    page?: number;
    limit?: number;
  }
): Promise<{ items: DbRow[]; total: number; page: number; limit: number }> {
  assertPermission(user, 'patients:read');
  const scope = resolveListScope(user, filters?.service);

  const page = Math.max(1, filters?.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters?.limit ?? 50));
  const offset = (page - 1) * limit;

  let baseQuery = getDb()('patients').whereIn('service', scope);
  if (filters?.search) {
    const s = `%${filters.search}%`;
    baseQuery = baseQuery.where(function () {
      this.whereILike('first_name', s)
        .orWhereILike('last_name', s)
        .orWhereILike('patient_code', s);
    });
  }

  const [{ count }] = (await baseQuery.clone().count('id as count')) as [{ count: number | string }];
  const total = Number(count);

  const rows = (await baseQuery
    .select('*')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)) as DbRow[];

  if (!rows.length) return { items: [], total, page, limit };

  // Batch load medical records (1 query instead of N)
  const patientIds = rows.map((r) => String(r.id));
  const medicalRecords = (await getDb()('medical_records').whereIn('patient_id', patientIds)) as DbRow[];
  const mrByPatientId = new Map(medicalRecords.map((mr) => [String(mr.patient_id), mr]));

  // Batch load specialty records grouped by service (1 query per service at most)
  const mrByService = new Map<string, string[]>();
  for (const mr of medicalRecords) {
    const svc = String(mr.service || '');
    if (!mrByService.has(svc)) mrByService.set(svc, []);
    mrByService.get(svc)!.push(String(mr.id));
  }

  const specialtyMap = new Map<string, DbRow>();
  const serviceTableMap: Record<string, string> = {
    GENERAL: 'general_records',
    URGENCE: 'emergency_records',
    ONCOLOGIE: 'oncology_records',
    CARDIOLOGIE: 'cardiology_records',
  };
  for (const [svc, mrIds] of mrByService.entries()) {
    const table = serviceTableMap[svc];
    if (!table || !mrIds.length) continue;
    const specialties = (await getDb()(table).whereIn('medical_record_id', mrIds)) as DbRow[];
    for (const sp of specialties) {
      specialtyMap.set(String(sp.medical_record_id), sp);
    }
  }

  const items: DbRow[] = rows.map((r) => {
    const mr = mrByPatientId.get(String(r.id)) ?? null;
    const specialty = mr ? (specialtyMap.get(String(mr.id)) ?? null) : null;
    return { ...r, medicalRecord: mr, specialty };
  });

  return { items, total, page, limit };
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

export function assertSpecialtyPresent(service: ServiceType, specialty: DbRow | null | undefined): void {
  if (!specialty) {
    const label =
      service === 'GENERAL'
        ? 'General record missing for patient'
        : `Specialty record missing for service ${service}`;
    throw new AppError(label, 500);
  }
}

export function assertMedicalRecordIntegrity(
  patient: DbRow,
  medicalRecord: DbRow | null | undefined,
  specialty: DbRow | null | undefined
): void {
  if (!medicalRecord) {
    throw new AppError('Medical record missing for patient', 500);
  }
  if (medicalRecord.service !== patient.service) {
    throw new AppError('Medical record service mismatch', 500);
  }
  assertSpecialtyPresent(patient.service as ServiceType, specialty);
}

async function assemblePatientDossier(patientId: string, patientRow?: DbRow) {
  const patient = patientRow || (await getDb()('patients').where({ id: patientId }).first());
  if (!patient) throw new AppError('Patient not found', 404);
  const mr = await getDb()('medical_records').where({ patient_id: patientId }).first();
  const specialty = mr
    ? await loadSpecialty(String(mr.id), patient.service as ServiceType)
    : null;
  assertMedicalRecordIntegrity(patient, mr, specialty);
  return { ...patient, medicalRecord: mr, specialty };
}

export async function getPatient(id: string, user: InternalUser, ip?: string) {
  const patient = await getDb()('patients').where({ id }).first();
  if (!patient) throw new AppError('Patient not found', 404);
  assertServiceAccess(user, patient.service as ServiceType);
  const dossier = await assemblePatientDossier(id, patient);
  await writeAudit(
    user,
    'PATIENT_READ',
    id,
    `${patient.first_name} ${patient.last_name}`,
    ip,
    { service: patient.service }
  );
  return dossier;
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
    if (data.restingHeartRate <= 0) {
      throw new AppError('Resting heart rate must be positive', 400);
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

export type PatientAuditAction =
  | 'PATIENT_READ'
  | 'PATIENT_CREATE'
  | 'PATIENT_UPDATE'
  | 'PATIENT_DELETE';

export function buildPatientAuditRow(
  user: InternalUser,
  action: PatientAuditAction,
  resourceId: string,
  patientName: string,
  ip?: string,
  details?: unknown
) {
  return {
    user_id: user.id,
    action,
    resource: 'PATIENT',
    resource_id: resourceId,
    patient_name: patientName,
    ip_address: ip || null,
    details: details ?? null,
  };
}

async function writeAudit(
  user: InternalUser,
  action: PatientAuditAction,
  resourceId: string,
  patientName: string,
  ip?: string,
  details?: unknown,
  trx?: ReturnType<typeof getDb>
) {
  const db = trx || getDb();
  await db('audit_logs').insert(
    buildPatientAuditRow(user, action, resourceId, patientName, ip, details)
  );
}

export async function createPatient(user: InternalUser, input: PatientInput, ip?: string) {
  assertPermission(user, 'patients:create');
  assertServiceAccess(user, input.service);
  validateHospitalizationDate(input.hospitalizationDate);
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

    await writeAudit(
      user,
      'PATIENT_CREATE',
      String(patient.id),
      `${patient.first_name} ${patient.last_name}`,
      ip,
      { service: input.service },
      trx as unknown as ReturnType<typeof getDb>
    );

    return patient;
  });

  notifyBusinessEvent({
    kind: 'PATIENT_CREATED',
    actorId: user.id,
    patientId: String(result.id),
    service: input.service,
    ...patientStaffLabel(result),
  });

  return assemblePatientDossier(String(result.id), result);
}

export async function updatePatient(
  user: InternalUser,
  id: string,
  input: PatientInput,
  ip?: string
) {
  assertPermission(user, 'patients:update');
  assertServiceAccess(user, input.service);
  validateHospitalizationDate(input.hospitalizationDate);
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

    await writeAudit(
      user,
      'PATIENT_UPDATE',
      id,
      `${input.firstName} ${input.lastName}`,
      ip,
      { service: input.service },
      trx as unknown as ReturnType<typeof getDb>
    );

    await createMedicalHistoryEvent(
      {
        patientId: id,
        eventType: 'RECORD_UPDATE',
        occurredAt: new Date().toISOString(),
        service: input.service,
        doctorId: user.id,
        createdBy: user.id,
        summary: 'Modification du dossier médical',
        metadata: { source: 'PATIENT_UPDATE' },
      },
      trx as unknown as ReturnType<typeof getDb>
    );
  });

  notifyBusinessEvent({
    kind: 'PATIENT_UPDATED',
    actorId: user.id,
    patientId: id,
    service: input.service,
    patientName: `${input.lastName.toUpperCase()} ${input.firstName}`.trim(),
    patientCode: String(existing.patient_code || ''),
  });

  return assemblePatientDossier(id);
}

export async function deletePatient(user: InternalUser, id: string, ip?: string) {
  assertPermission(user, 'patients:delete');
  const existing = await getDb()('patients').where({ id }).first();
  if (!existing) throw new AppError('Patient not found', 404);
  assertServiceAccess(user, existing.service as ServiceType);

  // RESTRICT: do not silently erase prescription or medical-history with the patient
  const existingRx = await getDb()('prescriptions').where({ patient_id: id }).first();
  if (existingRx) {
    throw new AppError('Cannot delete patient with existing prescriptions', 409);
  }
  const existingDoc = await getDb()('patient_documents').where({ patient_id: id }).first();
  if (existingDoc) {
    throw new AppError('Cannot delete patient with existing documents', 409);
  }
  const existingNote = await getDb()('clinical_notes').where({ patient_id: id }).first();
  if (existingNote) {
    throw new AppError('Cannot delete patient with existing clinical notes', 409);
  }
  const existingHistory = await getDb()('medical_history').where({ patient_id: id }).first();
  if (existingHistory) {
    throw new AppError('Cannot delete patient with existing medical history', 409);
  }

  await getDb().transaction(async (trx) => {
    await trx('patients').where({ id }).del();
    await writeAudit(
      user,
      'PATIENT_DELETE',
      id,
      `${existing.first_name} ${existing.last_name}`,
      ip,
      { service: existing.service },
      trx as unknown as ReturnType<typeof getDb>
    );
  });

  return { ok: true };
}

export function buildDashboardFromRows(
  patients: Array<{
    service: string;
    status: string;
    hospitalization_date: string | Date;
    created_at?: string | Date;
  }>,
  allowed: ServiceType[]
) {
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

  const scoped = patients.filter((p) => allowed.includes(p.service as ServiceType));
  const byServiceMap: Record<string, number> = {};
  for (const s of allowed) byServiceMap[s] = 0;
  for (const p of scoped) {
    byServiceMap[p.service] = (byServiceMap[p.service] || 0) + 1;
  }

  const occupancy = allowed.map((service) => {
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
  const today = new Date().toISOString().slice(0, 10);
  const critical = scoped.filter((p) => p.status === 'CRITICAL').length;
  const admittedToday = scoped.filter((p) => String(p.hospitalization_date).slice(0, 10) === today).length;
  const recent = [...scoped]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 5);

  return {
    total: scoped.length,
    critical,
    admittedToday,
    availableBeds: Math.max(totalBeds - occupiedBeds, 0),
    totalBeds,
    byService: byServiceMap,
    occupancy,
    recent,
  };
}

export async function getDashboardStats(user: InternalUser) {
  assertPermission(user, 'patients:read');
  const allowed = allowedServices(user);
  if (!allowed.length) {
    throw new AppError('Forbidden: no service scope', 403);
  }
  const patients = await getDb()('patients').whereIn('service', allowed).select('*');
  return buildDashboardFromRows(patients, allowed);
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
