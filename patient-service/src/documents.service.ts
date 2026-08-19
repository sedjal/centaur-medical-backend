import { AppError, assertPermission, getDb, type InternalUser } from '@centaur/shared';
import { assertServiceAccess } from './patient.service';
import { createMedicalHistoryEvent } from './medical-history.service';
import {
  attachmentDisposition,
  documentTypeLabel,
  isDocumentType,
  validateDocumentFile,
  type DocumentType,
} from './file-validation';

type DbRow = Record<string, unknown>;
type DbClient = ReturnType<typeof getDb>;

export interface DocumentMetaDto {
  id: string;
  patientId: string;
  docType: DocumentType;
  filename: string;
  mimeType: string;
  byteSize: number;
  uploadedBy: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export interface DocumentFileDto {
  id: string;
  patientId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  content: Buffer;
  contentDisposition: string;
}

function toIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function asBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'binary');
  throw new AppError('Invalid document content', 500);
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

function toMetaDto(row: DbRow, names: Map<string, string | null>): DocumentMetaDto {
  const uploadedBy = row.uploaded_by == null ? null : String(row.uploaded_by);
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    docType: String(row.doc_type) as DocumentType,
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    byteSize: Number(row.byte_size),
    uploadedBy,
    uploadedByName: uploadedBy ? names.get(uploadedBy) ?? null : null,
    createdAt: toIso(row.created_at),
  };
}

async function writeDocumentAudit(
  user: InternalUser,
  action: 'DOCUMENT_UPLOADED' | 'DOCUMENT_DELETED',
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
    resource: 'DOCUMENT',
    resource_id: resourceId,
    patient_name: patientName,
    ip_address: ip || null,
    details: details ?? null,
  });
}

export async function listPatientDocuments(
  user: InternalUser,
  patientId: string
): Promise<DocumentMetaDto[]> {
  assertPermission(user, 'documents:read');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE');

  const rows = (await getDb()('patient_documents')
    .select(
      'id',
      'patient_id',
      'doc_type',
      'filename',
      'mime_type',
      'byte_size',
      'uploaded_by',
      'created_at'
    )
    .where({ patient_id: String(patient.id) })
    .orderBy('created_at', 'desc')) as DbRow[];

  const names = await namesById(rows.map((r) => (r.uploaded_by == null ? '' : String(r.uploaded_by))));
  return rows.map((row) => {
    const dto = toMetaDto(row, names);
    return dto;
  });
}

export async function createPatientDocument(
  user: InternalUser,
  patientId: string,
  input: {
    type: string;
    filename: string;
    declaredMime?: string;
    content: Buffer;
  },
  ip?: string
): Promise<DocumentMetaDto> {
  assertPermission(user, 'documents:create');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE');

  if (!isDocumentType(String(input.type || '').trim())) {
    throw new AppError('Invalid document type', 400);
  }
  const docType = String(input.type).trim() as DocumentType;
  const file = validateDocumentFile({
    filename: input.filename,
    declaredMime: input.declaredMime,
    content: input.content,
  });

  const created = await getDb().transaction(async (trx) => {
    const [row] = await trx('patient_documents')
      .insert({
        patient_id: String(patient.id),
        doc_type: docType,
        filename: file.filename,
        mime_type: file.mimeType,
        byte_size: file.byteSize,
        content: file.content,
        uploaded_by: user.id,
      })
      .returning(['id', 'patient_id', 'doc_type', 'filename', 'mime_type', 'byte_size', 'uploaded_by', 'created_at']);

    const summary = `Document ajouté : ${documentTypeLabel(docType)} (${file.filename})`.slice(0, 255);
    await createMedicalHistoryEvent(
      {
        patientId: String(patient.id),
        eventType: 'DOCUMENT_ADDED',
        occurredAt: new Date().toISOString(),
        service: patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE',
        doctorId: user.id,
        createdBy: user.id,
        summary,
        metadata: {
          documentId: String(row.id),
          docType,
          filename: file.filename,
        },
      },
      trx as unknown as DbClient
    );

    await writeDocumentAudit(
      user,
      'DOCUMENT_UPLOADED',
      String(row.id),
      `${patient.first_name} ${patient.last_name}`,
      ip,
      { patientId: String(patient.id), docType, filename: file.filename, byteSize: file.byteSize },
      trx as unknown as DbClient
    );

    return row as DbRow;
  });

  const names = await namesById([user.id]);
  return toMetaDto(created, names);
}

export async function getPatientDocumentFile(
  user: InternalUser,
  patientId: string,
  documentId: string
): Promise<DocumentFileDto> {
  assertPermission(user, 'documents:read');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE');

  const id = String(documentId || '').trim();
  if (!id) throw new AppError('documentId is required', 400);
  const row = (await getDb()('patient_documents')
    .where({ id, patient_id: String(patient.id) })
    .first()) as DbRow | undefined;
  if (!row) throw new AppError('Document not found', 404);

  const filename = String(row.filename);
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    filename,
    mimeType: String(row.mime_type),
    byteSize: Number(row.byte_size),
    content: asBuffer(row.content),
    contentDisposition: attachmentDisposition(filename),
  };
}

export async function deletePatientDocument(
  user: InternalUser,
  patientId: string,
  documentId: string,
  ip?: string
): Promise<{ ok: true }> {
  assertPermission(user, 'documents:delete');
  const patient = await loadPatientOr404(patientId);
  assertServiceAccess(user, patient.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE');

  const id = String(documentId || '').trim();
  if (!id) throw new AppError('documentId is required', 400);
  const existing = (await getDb()('patient_documents')
    .where({ id, patient_id: String(patient.id) })
    .first()) as DbRow | undefined;
  if (!existing) throw new AppError('Document not found', 404);

  await getDb().transaction(async (trx) => {
    await trx('patient_documents').where({ id }).del();
    await writeDocumentAudit(
      user,
      'DOCUMENT_DELETED',
      id,
      `${patient.first_name} ${patient.last_name}`,
      ip,
      {
        patientId: String(patient.id),
        docType: existing.doc_type,
        filename: existing.filename,
      },
      trx as unknown as DbClient
    );
  });

  return { ok: true };
}
