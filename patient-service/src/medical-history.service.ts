import {
  AppError,
  assertPermission,
  getDb,
  type InternalUser,
  type ServiceType,
} from '@centaur/shared';
import { assertServiceAccess, allowedServices } from './patient.service';

export const MEDICAL_HISTORY_EVENT_TYPES = [
  'HOSPITALIZATION',
  'CONSULTATION',
  'DIAGNOSIS',
  'PRESCRIPTION',
  'RECORD_UPDATE',
  'DOCUMENT_ADDED',
  'CLINICAL_NOTE',
] as const;

export type MedicalHistoryEventType = (typeof MEDICAL_HISTORY_EVENT_TYPES)[number];

export interface MedicalHistoryFilters {
  patientId?: string;
  service?: ServiceType;
  type?: MedicalHistoryEventType;
  from?: string;
  to?: string;
}

export interface CreateMedicalHistoryInput {
  patientId: string;
  eventType: MedicalHistoryEventType;
  occurredAt: string;
  service: ServiceType;
  doctorId?: string | null;
  createdBy?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

export interface MedicalHistoryItemDto {
  id: string;
  patientId: string;
  eventType: MedicalHistoryEventType;
  occurredAt: string;
  service: ServiceType;
  doctorId: string | null;
  doctorName: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
}

export interface MedicalHistoryListDto {
  items: MedicalHistoryItemDto[];
  total: number;
}

type DbRow = Record<string, unknown>;

const METADATA_KEYS = new Set([
  'prescriptionId',
  'action',
  'source',
  'documentId',
  'docType',
  'filename',
  'noteId',
  'title',
]);

function isEventType(value: string): value is MedicalHistoryEventType {
  return (MEDICAL_HISTORY_EVENT_TYPES as readonly string[]).includes(value);
}

function sanitizeMetadata(
  metadata?: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!METADATA_KEYS.has(k)) continue;
    if (k === 'prescriptionId' && typeof v === 'string' && v.trim()) {
      out.prescriptionId = v.trim();
    }
    if (k === 'action' && typeof v === 'string' && v.trim()) {
      out.action = v.trim();
    }
    if (k === 'source' && typeof v === 'string' && v.trim()) {
      out.source = v.trim();
    }
    if (k === 'documentId' && typeof v === 'string' && v.trim()) {
      out.documentId = v.trim();
    }
    if (k === 'docType' && typeof v === 'string' && v.trim()) {
      out.docType = v.trim();
    }
    if (k === 'filename' && typeof v === 'string' && v.trim()) {
      out.filename = v.trim().slice(0, 255);
    }
    if (k === 'noteId' && typeof v === 'string' && v.trim()) {
      out.noteId = v.trim();
    }
    if (k === 'title' && typeof v === 'string' && v.trim()) {
      out.title = v.trim().slice(0, 120);
    }
  }
  return Object.keys(out).length ? out : null;
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return sanitizeMetadata(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return sanitizeMetadata(raw as Record<string, unknown>);
  }
  return null;
}

function assertOptionalDate(value: string | undefined, name: string): void {
  if (!value) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new AppError(`Invalid ${name} date`, 400);
  }
}

async function loadPatientOr404(patientId: string): Promise<DbRow> {
  const trimmed = String(patientId || '').trim();
  if (!trimmed) throw new AppError('patientId is required', 400);
  const patient = await getDb()('patients').where({ id: trimmed }).first();
  if (!patient) throw new AppError('Patient not found', 404);
  return patient;
}

async function doctorNamesById(ids: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, string | null>();
  if (!unique.length) return map;
  const rows = (await getDb()('users').whereIn('id', unique)) as DbRow[];
  for (const id of unique) {
    const user = rows.find((r) => String(r.id) === id);
    if (!user) {
      map.set(id, null);
      continue;
    }
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    map.set(id, name || null);
  }
  return map;
}

function toIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function toDto(row: DbRow, names: Map<string, string | null>): Promise<MedicalHistoryItemDto> {
  const doctorId = row.doctor_id == null ? null : String(row.doctor_id);
  const eventType = String(row.event_type);
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    eventType: isEventType(eventType) ? eventType : 'RECORD_UPDATE',
    occurredAt: toIso(row.occurred_at),
    service: String(row.service) as ServiceType,
    doctorId,
    doctorName: doctorId ? names.get(doctorId) ?? null : null,
    summary: String(row.summary),
    metadata: parseMetadata(row.metadata),
  };
}

/**
 * Internal write — never exposed as a public POST.
 * Must be called inside the same transaction as the source business event.
 */
export async function createMedicalHistoryEvent(
  input: CreateMedicalHistoryInput,
  trx?: ReturnType<typeof getDb>
): Promise<string> {
  if (!isEventType(input.eventType)) {
    throw new AppError('Invalid medical history event type', 400);
  }
  const patientId = String(input.patientId || '').trim();
  if (!patientId) throw new AppError('patientId is required', 400);
  const summary = String(input.summary || '').trim();
  if (!summary) throw new AppError('summary is required', 400);
  assertOptionalDate(input.occurredAt, 'occurredAt');

  const db = trx || getDb();
  const [row] = await db('medical_history')
    .insert({
      patient_id: patientId,
      event_type: input.eventType,
      occurred_at: new Date(input.occurredAt).toISOString(),
      service: input.service,
      doctor_id: input.doctorId || null,
      summary,
      metadata: sanitizeMetadata(input.metadata),
      created_by: input.createdBy || input.doctorId || null,
    })
    .returning(['id']);

  return String(row.id);
}

export async function getPatientMedicalHistory(
  user: InternalUser,
  patientId: string
): Promise<MedicalHistoryListDto> {
  assertPermission(user, 'medical_history:read');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as ServiceType);

  const rows = (await getDb()('medical_history')
    .where({ patient_id: String(patient.id) })
    .orderBy('occurred_at', 'desc')) as DbRow[];

  const names = await doctorNamesById(
    rows.map((r) => (r.doctor_id == null ? '' : String(r.doctor_id)))
  );
  const items: MedicalHistoryItemDto[] = [];
  for (const row of rows) {
    items.push(await toDto(row, names));
  }
  return { items, total: items.length };
}

export async function getMedicalHistory(
  user: InternalUser,
  filters: MedicalHistoryFilters = {}
): Promise<MedicalHistoryListDto> {
  assertPermission(user, 'medical_history:read');
  const allowed = allowedServices(user);
  if (!allowed.length) {
    throw new AppError('Forbidden: no service scope', 403);
  }

  assertOptionalDate(filters.from, 'from');
  assertOptionalDate(filters.to, 'to');

  let serviceFilter = allowed;
  if (filters.service) {
    assertServiceAccess(user, filters.service);
    serviceFilter = [filters.service];
  }

  let patientIds: string[];
  if (filters.patientId) {
    const patient = await loadPatientOr404(filters.patientId);
    assertServiceAccess(user, patient.service as ServiceType);
    if (!serviceFilter.includes(patient.service as ServiceType)) {
      throw new AppError(
        `Forbidden: missing permission service:${String(patient.service).toLowerCase()}`,
        403
      );
    }
    patientIds = [String(patient.id)];
  } else {
    const scoped = (await getDb()('patients').whereIn('service', serviceFilter).select('id')) as DbRow[];
    patientIds = scoped.map((p) => String(p.id));
    if (!patientIds.length) {
      return { items: [], total: 0 };
    }
  }

  let query = getDb()('medical_history').whereIn('patient_id', patientIds);
  if (filters.type) {
    if (!isEventType(filters.type)) {
      throw new AppError('Invalid medical history event type', 400);
    }
    query = query.where({ event_type: filters.type });
  }
  if (filters.from) {
    query = query.where('occurred_at', '>=', filters.from);
  }
  if (filters.to) {
    query = query.where('occurred_at', '<=', filters.to);
  }

  const rows = (await query.orderBy('occurred_at', 'desc')) as DbRow[];
  const names = await doctorNamesById(
    rows.map((r) => (r.doctor_id == null ? '' : String(r.doctor_id)))
  );
  const items: MedicalHistoryItemDto[] = [];
  for (const row of rows) {
    items.push(await toDto(row, names));
  }
  return { items, total: items.length };
}
