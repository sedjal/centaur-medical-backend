import {
  AppError,
  assertPermission,
  getDb,
  type InternalUser,
  type ServiceType,
} from '@centaur/shared';
import { assertServiceAccess, allowedServices } from './patient.service';
import { createMedicalHistoryEvent } from './medical-history.service';
import { notifyBusinessEvent, patientStaffLabel } from './business-notify';

export type PrescriptionStatus = 'ACTIVE' | 'CANCELLED';

export interface PrescriptionMedicationInput {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string | null;
}

export interface CreatePrescriptionInput {
  patientId: string;
  prescribedAt: string;
  notes?: string | null;
  medications: PrescriptionMedicationInput[];
  patientAge?: string | null;
  patientGender?: string | null;
  doctorName?: string | null;
}

export interface PrescriptionListFilters {
  patientId?: string;
  service?: ServiceType;
  status?: PrescriptionStatus;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface PrescriptionMedicationDto {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}

export interface PrescriptionDto {
  id: string;
  patientId: string;
  doctorId: string | null;
  doctorName: string | null;
  prescribedAt: string;
  status: PrescriptionStatus;
  notes: string | null;
  medications: PrescriptionMedicationDto[];
  createdAt: string;
  updatedAt: string;
  prescriptionNumber: number;
  patientAge: string | null;
  patientGender: string | null;
}

type DbRow = Record<string, unknown>;

type PrescriptionAuditAction = 'PRESCRIPTION_CREATED' | 'PRESCRIPTION_CANCELLED';

function buildPrescriptionAuditRow(
  user: InternalUser,
  action: PrescriptionAuditAction,
  resourceId: string,
  patientName: string,
  ip?: string,
  details?: unknown
) {
  return {
    user_id: user.id,
    action,
    resource: 'PRESCRIPTION',
    resource_id: resourceId,
    patient_name: patientName,
    ip_address: ip || null,
    details: details ?? null,
  };
}

async function writePrescriptionAudit(
  user: InternalUser,
  action: PrescriptionAuditAction,
  resourceId: string,
  patientName: string,
  ip?: string,
  details?: unknown,
  trx?: ReturnType<typeof getDb>
) {
  const db = trx || getDb();
  await db('audit_logs').insert(
    buildPrescriptionAuditRow(user, action, resourceId, patientName, ip, details)
  );
}

export function validatePrescribedAt(value: string): void {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new AppError('prescribedAt is required', 400);
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new AppError('Invalid prescribedAt date', 400);
  }
}

export function validateMedications(medications: PrescriptionMedicationInput[]): void {
  if (!Array.isArray(medications) || medications.length < 1) {
    throw new AppError('At least one medication is required', 400);
  }
  for (const med of medications) {
    if (!String(med.name || '').trim()) throw new AppError('medication name is required', 400);
    if (!String(med.dosage || '').trim()) throw new AppError('medication dosage is required', 400);
    if (!String(med.frequency || '').trim()) {
      throw new AppError('medication frequency is required', 400);
    }
    if (!String(med.duration || '').trim()) {
      throw new AppError('medication duration is required', 400);
    }
  }
}

async function loadMedications(
  prescriptionId: string,
  trx?: ReturnType<typeof getDb>
): Promise<PrescriptionMedicationDto[]> {
  const db = trx || getDb();
  const rows = await db('prescription_items')
    .where({ prescription_id: prescriptionId })
    .orderBy('created_at', 'asc');
  return (rows as DbRow[]).map((r) => ({
    id: String(r.id),
    name: String(r.medication_name),
    dosage: String(r.dosage),
    frequency: String(r.frequency),
    duration: String(r.duration),
    instructions: r.instructions == null ? null : String(r.instructions),
  }));
}

/** Batch-load all medications for a set of prescription IDs in a single query. */
async function loadMedicationsBatch(
  prescriptionIds: string[]
): Promise<Map<string, PrescriptionMedicationDto[]>> {
  if (!prescriptionIds.length) return new Map();
  const rows = await getDb()('prescription_items')
    .whereIn('prescription_id', prescriptionIds)
    .orderBy('created_at', 'asc');
  const map = new Map<string, PrescriptionMedicationDto[]>();
  for (const r of rows as DbRow[]) {
    const pid = String(r.prescription_id);
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push({
      id: String(r.id),
      name: String(r.medication_name),
      dosage: String(r.dosage),
      frequency: String(r.frequency),
      duration: String(r.duration),
      instructions: r.instructions == null ? null : String(r.instructions),
    });
  }
  return map;
}

async function doctorDisplayName(doctorId: string | null | undefined): Promise<string | null> {
  if (!doctorId) return null;
  const user = await getDb()('users').where({ id: doctorId }).first();
  if (!user) return null;
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || null;
}

async function toDto(row: DbRow): Promise<PrescriptionDto> {
  const doctorId = row.doctor_id == null ? null : String(row.doctor_id);
  const medications = await loadMedications(String(row.id));
  const prescribedAt = row.prescribed_at
    ? new Date(String(row.prescribed_at)).toISOString()
    : new Date().toISOString();
  const createdAt = row.created_at
    ? new Date(String(row.created_at)).toISOString()
    : prescribedAt;
  const updatedAt = row.updated_at
    ? new Date(String(row.updated_at)).toISOString()
    : createdAt;
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    doctorId,
    doctorName: row.doctor_name ? String(row.doctor_name) : await doctorDisplayName(doctorId),
    prescribedAt,
    status: String(row.status) as PrescriptionStatus,
    notes: row.notes == null ? null : String(row.notes),
    medications,
    createdAt,
    updatedAt,
    prescriptionNumber: Number(row.prescription_number || 0),
    patientAge: row.patient_age == null ? null : String(row.patient_age),
    patientGender: row.patient_gender == null ? null : String(row.patient_gender),
  };
}

async function loadPatientOr404(patientId: string): Promise<DbRow> {
  const patient = await getDb()('patients').where({ id: patientId }).first();
  if (!patient) throw new AppError('Patient not found', 404);
  return patient;
}

function inDateRange(prescribedAt: string, from?: string, to?: string): boolean {
  const t = Date.parse(prescribedAt);
  if (Number.isNaN(t)) return false;
  if (from) {
    const fromMs = Date.parse(from);
    if (!Number.isNaN(fromMs) && t < fromMs) return false;
  }
  if (to) {
    const toMs = Date.parse(to);
    if (!Number.isNaN(toMs) && t > toMs) return false;
  }
  return true;
}

export async function createPrescription(
  user: InternalUser,
  input: CreatePrescriptionInput,
  ip?: string
): Promise<PrescriptionDto> {
  assertPermission(user, 'prescriptions:create');
  if (!String(input.patientId || '').trim()) {
    throw new AppError('patientId is required', 400);
  }
  validatePrescribedAt(input.prescribedAt);
  validateMedications(input.medications);

  const patient = await loadPatientOr404(input.patientId);
  assertServiceAccess(user, patient.service as ServiceType);

  // doctorId ALWAYS from authenticated user — never from body
  const doctorId = user.id;

  const created = await getDb().transaction(async (trx) => {
    const now = new Date().toISOString();
    const resolvedDoctorName = input.doctorName || await doctorDisplayName(doctorId);
    const [rx] = await trx('prescriptions')
      .insert({
        patient_id: input.patientId,
        doctor_id: doctorId,
        prescribed_at: new Date(input.prescribedAt).toISOString(),
        status: 'ACTIVE',
        notes: input.notes?.trim() ? input.notes.trim() : null,
        created_at: now,
        updated_at: now,
        patient_age: input.patientAge?.trim() ? input.patientAge.trim() : null,
        patient_gender: input.patientGender?.trim() ? input.patientGender.trim() : null,
        doctor_name: resolvedDoctorName?.trim() ? resolvedDoctorName.trim() : null,
      })
      .returning('*');

    for (const med of input.medications) {
      await trx('prescription_items').insert({
        prescription_id: rx.id,
        medication_name: med.name.trim(),
        dosage: med.dosage.trim(),
        frequency: med.frequency.trim(),
        duration: med.duration.trim(),
        instructions: med.instructions?.trim() ? med.instructions.trim() : null,
      });
    }

    await writePrescriptionAudit(
      user,
      'PRESCRIPTION_CREATED',
      String(rx.id),
      `${patient.first_name} ${patient.last_name}`,
      ip,
      { patientId: input.patientId, medicationCount: input.medications.length },
      trx as unknown as ReturnType<typeof getDb>
    );

    await createMedicalHistoryEvent(
      {
        patientId: String(input.patientId),
        eventType: 'PRESCRIPTION',
        occurredAt: new Date(input.prescribedAt).toISOString(),
        service: patient.service as ServiceType,
        doctorId,
        createdBy: user.id,
        summary: 'Nouvelle ordonnance créée',
        metadata: { prescriptionId: String(rx.id), action: 'CREATED' },
      },
      trx as unknown as ReturnType<typeof getDb>
    );

    return rx as DbRow;
  });

  notifyBusinessEvent({
    kind: 'PRESCRIPTION_CREATED',
    actorId: user.id,
    patientId: String(input.patientId),
    service: patient.service as ServiceType,
    ...patientStaffLabel(patient),
  });

  return toDto(created);
}

export async function getPrescription(
  user: InternalUser,
  id: string
): Promise<PrescriptionDto> {
  assertPermission(user, 'prescriptions:read');
  const row = await getDb()('prescriptions').where({ id }).first();
  if (!row) throw new AppError('Prescription not found', 404);

  const patient = await loadPatientOr404(String(row.patient_id));
  assertServiceAccess(user, patient.service as ServiceType);

  return toDto(row);
}

export interface PrescriptionListResult {
  items: PrescriptionDto[];
  total: number;
  page: number;
  limit: number;
}

export async function listPrescriptions(
  user: InternalUser,
  filters: PrescriptionListFilters = {}
): Promise<PrescriptionListResult> {
  assertPermission(user, 'prescriptions:read');
  const allowed = allowedServices(user);
  if (!allowed.length) {
    throw new AppError('Forbidden: no service scope', 403);
  }

  let serviceFilter = allowed;
  if (filters.service) {
    assertServiceAccess(user, filters.service);
    serviceFilter = [filters.service];
  }

  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const offset = (page - 1) * limit;

  // Resolve patient IDs for service-scoped queries when no patientId given
  let patientIdFilter: string[] | undefined;
  if (!filters.patientId) {
    const scopedPatients = (await getDb()('patients')
      .whereIn('service', serviceFilter)
      .select('id')) as DbRow[];
    patientIdFilter = scopedPatients.map((p) => String(p.id));
    if (!patientIdFilter.length) return { items: [], total: 0, page, limit };
  }

  let baseQuery = getDb()('prescriptions');
  if (filters.patientId) {
    baseQuery = baseQuery.where({ patient_id: filters.patientId });
  } else if (patientIdFilter) {
    baseQuery = baseQuery.whereIn('patient_id', patientIdFilter);
  }
  if (filters.status) {
    baseQuery = baseQuery.where({ status: filters.status });
  }
  if (filters.from) {
    baseQuery = baseQuery.where('prescribed_at', '>=', filters.from);
  }
  if (filters.to) {
    baseQuery = baseQuery.where('prescribed_at', '<=', filters.to);
  }

  const [{ count }] = (await baseQuery.clone().count('id as count')) as [{ count: number | string }];
  const total = Number(count);

  const rows = (await baseQuery
    .select('*')
    .orderBy('prescribed_at', 'desc')
    .limit(limit)
    .offset(offset)) as DbRow[];

  if (!rows.length) return { items: [], total, page, limit };

  // Batch-load medications (1 query for all prescriptions)
  const prescriptionIds = rows.map((r) => String(r.id));
  const medicationsMap = await loadMedicationsBatch(prescriptionIds);

  // Batch-load doctor names for rows missing doctor_name
  const missingDoctorIds = [
    ...new Set(
      rows
        .filter((r) => !r.doctor_name && r.doctor_id)
        .map((r) => String(r.doctor_id))
    ),
  ];
  const doctorMap = new Map<string, string>();
  if (missingDoctorIds.length) {
    const users = (await getDb()('users').whereIn('id', missingDoctorIds).select(['id', 'first_name', 'last_name'])) as DbRow[];
    for (const u of users) {
      doctorMap.set(String(u.id), `${u.first_name || ''} ${u.last_name || ''}`.trim());
    }
  }

  const items: PrescriptionDto[] = rows.map((row) => {
    const doctorId = row.doctor_id == null ? null : String(row.doctor_id);
    const prescribedAt = row.prescribed_at
      ? new Date(String(row.prescribed_at)).toISOString()
      : new Date().toISOString();
    const createdAt = row.created_at ? new Date(String(row.created_at)).toISOString() : prescribedAt;
    const updatedAt = row.updated_at ? new Date(String(row.updated_at)).toISOString() : createdAt;
    return {
      id: String(row.id),
      patientId: String(row.patient_id),
      doctorId,
      doctorName: row.doctor_name
        ? String(row.doctor_name)
        : (doctorId ? (doctorMap.get(doctorId) ?? null) : null),
      prescribedAt,
      status: String(row.status) as PrescriptionStatus,
      notes: row.notes == null ? null : String(row.notes),
      medications: medicationsMap.get(String(row.id)) ?? [],
      createdAt,
      updatedAt,
      prescriptionNumber: Number(row.prescription_number || 0),
      patientAge: row.patient_age == null ? null : String(row.patient_age),
      patientGender: row.patient_gender == null ? null : String(row.patient_gender),
    };
  });

  return { items, total, page, limit };
}

export async function listPatientPrescriptions(
  user: InternalUser,
  patientId: string
): Promise<PrescriptionDto[]> {
  assertPermission(user, 'prescriptions:read');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as ServiceType);
  const result = await listPrescriptions(user, { patientId, limit: 100 });
  return result.items;
}

export async function cancelPrescription(
  user: InternalUser,
  id: string,
  ip?: string
): Promise<PrescriptionDto> {
  assertPermission(user, 'prescriptions:cancel');
  const row = await getDb()('prescriptions').where({ id }).first();
  if (!row) throw new AppError('Prescription not found', 404);

  const patient = await loadPatientOr404(String(row.patient_id));
  assertServiceAccess(user, patient.service as ServiceType);

  if (String(row.status) === 'CANCELLED') {
    throw new AppError('Prescription already cancelled', 409);
  }

  await getDb().transaction(async (trx) => {
    await trx('prescriptions').where({ id }).update({
      status: 'CANCELLED',
      updated_at: trx.fn.now(),
    });
    await writePrescriptionAudit(
      user,
      'PRESCRIPTION_CANCELLED',
      id,
      `${patient.first_name} ${patient.last_name}`,
      ip,
      { patientId: String(row.patient_id) },
      trx as unknown as ReturnType<typeof getDb>
    );
    await createMedicalHistoryEvent(
      {
        patientId: String(row.patient_id),
        eventType: 'PRESCRIPTION',
        occurredAt: new Date().toISOString(),
        service: patient.service as ServiceType,
        doctorId: user.id,
        createdBy: user.id,
        summary: 'Ordonnance annulée',
        metadata: { prescriptionId: id, action: 'CANCELLED' },
      },
      trx as unknown as ReturnType<typeof getDb>
    );
  });

  notifyBusinessEvent({
    kind: 'PRESCRIPTION_CANCELLED',
    actorId: user.id,
    patientId: String(row.patient_id),
    service: patient.service as ServiceType,
    ...patientStaffLabel(patient),
  });

  const updated = await getDb()('prescriptions').where({ id }).first();
  return toDto(updated as DbRow);
}
