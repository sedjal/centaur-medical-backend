import { AppError, assertPermission, getDb, type InternalUser } from '@centaur/shared';
import { assertServiceAccess } from './patient.service';
import { createMedicalHistoryEvent } from './medical-history.service';

type DbRow = Record<string, unknown>;
type DbClient = ReturnType<typeof getDb>;

export const CLINICAL_NOTE_TITLE_MAX = 120;
export const CLINICAL_NOTE_BODY_MAX = 10_000;

export interface ClinicalNoteDto {
  id: string;
  patientId: string;
  title: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

function toIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function loadPatientOr404(patientId: string): Promise<DbRow> {
  const trimmed = String(patientId || '').trim();
  if (!trimmed) throw new AppError('patientId is required', 400);
  const patient = await getDb()('patients').where({ id: trimmed }).first();
  if (!patient) throw new AppError('Patient not found', 404);
  return patient;
}

async function namesById(ids: string[]): Promise<Map<string, string | null>> {
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

function toDto(row: DbRow, names: Map<string, string | null>): ClinicalNoteDto {
  const authorId = row.author_id == null ? null : String(row.author_id);
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    title: String(row.title),
    body: String(row.body),
    authorId,
    authorName: authorId ? names.get(authorId) ?? null : null,
    createdAt: toIso(row.created_at),
  };
}

export function assertClinicalNoteContent(title: string, body: string): { title: string; body: string } {
  const cleanTitle = String(title || '').trim();
  const cleanBody = String(body || '').trim();
  if (!cleanTitle) throw new AppError('Le titre est obligatoire', 400);
  if (cleanTitle.length > CLINICAL_NOTE_TITLE_MAX) {
    throw new AppError(`Le titre ne peut pas dépasser ${CLINICAL_NOTE_TITLE_MAX} caractères`, 400);
  }
  if (!cleanBody) throw new AppError('Le compte rendu ne peut pas être vide', 400);
  if (cleanBody.length > CLINICAL_NOTE_BODY_MAX) {
    throw new AppError(`Le compte rendu ne peut pas dépasser ${CLINICAL_NOTE_BODY_MAX} caractères`, 400);
  }
  return { title: cleanTitle, body: cleanBody };
}

async function writeNoteAudit(
  user: InternalUser,
  action: 'CLINICAL_NOTE_CREATED' | 'CLINICAL_NOTE_DELETED',
  resourceId: string,
  patientName: string,
  ip?: string,
  details?: unknown,
  trx?: DbClient
) {
  const db = trx || getDb();
  await db('audit_logs').insert({
    user_id: user.id,
    action,
    resource: 'CLINICAL_NOTE',
    resource_id: resourceId,
    patient_name: patientName,
    ip_address: ip || null,
    details: details ?? null,
  });
}

export async function listPatientClinicalNotes(
  user: InternalUser,
  patientId: string
): Promise<ClinicalNoteDto[]> {
  assertPermission(user, 'reports:read');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE');

  const rows = (await getDb()('clinical_notes')
    .select('id', 'patient_id', 'title', 'body', 'author_id', 'created_at')
    .where({ patient_id: String(patient.id) })
    .orderBy('created_at', 'desc')) as DbRow[];

  const names = await namesById(rows.map((r) => (r.author_id == null ? '' : String(r.author_id))));
  return rows.map((row) => toDto(row, names));
}

export async function getPatientClinicalNote(
  user: InternalUser,
  patientId: string,
  noteId: string
): Promise<ClinicalNoteDto> {
  assertPermission(user, 'reports:read');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE');

  const id = String(noteId || '').trim();
  if (!id) throw new AppError('noteId is required', 400);
  const row = (await getDb()('clinical_notes')
    .where({ id, patient_id: String(patient.id) })
    .first()) as DbRow | undefined;
  if (!row) throw new AppError('Clinical note not found', 404);

  const names = await namesById([row.author_id == null ? '' : String(row.author_id)]);
  return toDto(row, names);
}

export async function createPatientClinicalNote(
  user: InternalUser,
  patientId: string,
  input: { title: string; body: string },
  ip?: string
): Promise<ClinicalNoteDto> {
  assertPermission(user, 'reports:create');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE');

  const { title, body } = assertClinicalNoteContent(input.title, input.body);

  const created = await getDb().transaction(async (trx) => {
    const [row] = await trx('clinical_notes')
      .insert({
        patient_id: String(patient.id),
        title,
        body,
        author_id: user.id,
      })
      .returning(['id', 'patient_id', 'title', 'body', 'author_id', 'created_at']);

    const summary = `Compte rendu : ${title}`.slice(0, 255);
    await createMedicalHistoryEvent(
      {
        patientId: String(patient.id),
        eventType: 'CLINICAL_NOTE',
        occurredAt: new Date().toISOString(),
        service: patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE',
        doctorId: user.id,
        createdBy: user.id,
        summary,
        metadata: {
          noteId: String(row.id),
          title,
        },
      },
      trx as unknown as DbClient
    );

    await writeNoteAudit(
      user,
      'CLINICAL_NOTE_CREATED',
      String(row.id),
      `${patient.first_name} ${patient.last_name}`,
      ip,
      { patientId: String(patient.id), title },
      trx as unknown as DbClient
    );

    return row as DbRow;
  });

  const names = await namesById([user.id]);
  return toDto(created, names);
}

export async function deletePatientClinicalNote(
  user: InternalUser,
  patientId: string,
  noteId: string,
  ip?: string
): Promise<{ ok: true }> {
  assertPermission(user, 'reports:create');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE');

  const id = String(noteId || '').trim();
  if (!id) throw new AppError('noteId is required', 400);
  const existing = (await getDb()('clinical_notes')
    .where({ id, patient_id: String(patient.id) })
    .first()) as DbRow | undefined;
  if (!existing) throw new AppError('Clinical note not found', 404);

  await getDb().transaction(async (trx) => {
    await trx('clinical_notes').where({ id }).del();
    await writeNoteAudit(
      user,
      'CLINICAL_NOTE_DELETED',
      id,
      `${patient.first_name} ${patient.last_name}`,
      ip,
      {
        patientId: String(patient.id),
        title: existing.title,
      },
      trx as unknown as DbClient
    );
  });

  return { ok: true };
}
