import { AppError } from '@centaur/shared';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const DOCUMENT_TYPES = ['ECG', 'CARTE_GROUPE', 'ORDONNANCE', 'AUTRE'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const ALLOWED_DOCUMENT_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
] as const;

export type AllowedDocumentMime = (typeof ALLOWED_DOCUMENT_MIMES)[number];

const PDF_MAGIC = Buffer.from('%PDF');
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_MAGIC = Buffer.from('PK');
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function documentTypeLabel(type: DocumentType): string {
  const map: Record<DocumentType, string> = {
    ECG: 'ECG',
    CARTE_GROUPE: 'Carte de groupage',
    ORDONNANCE: 'Ordonnance',
    AUTRE: 'Autre',
  };
  return map[type];
}

function startsWith(buf: Buffer, magic: Buffer): boolean {
  return buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);
}

function normalizeDeclaredMime(raw: string): string {
  return String(raw || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function inferMimeFromMagic(content: Buffer): AllowedDocumentMime | null {
  if (startsWith(content, PDF_MAGIC)) return 'application/pdf';
  if (startsWith(content, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(content, PNG_MAGIC)) return 'image/png';
  if (startsWith(content, OLE_MAGIC)) return 'application/msword';
  if (startsWith(content, ZIP_MAGIC)) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return null;
}

export function sanitizeStoredFilename(filename: string): string {
  const base = String(filename || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || '';
  const cleaned = base.replace(/[\u0000\r\n"]/g, '_').trim();
  return cleaned.slice(0, 255) || 'document';
}

export function contentDispositionFilename(filename: string): string {
  const cleaned = sanitizeStoredFilename(filename)
    .replace(/[^\w.\- ()àâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ]/g, '_')
    .replace(/["\\]/g, '');
  return cleaned.slice(0, 180) || 'document';
}

export function attachmentDisposition(filename: string): string {
  return `attachment; filename="${contentDispositionFilename(filename)}"`;
}

export interface ValidatedDocumentFile {
  filename: string;
  mimeType: AllowedDocumentMime;
  byteSize: number;
  content: Buffer;
}

export function validateDocumentFile(input: {
  filename: string;
  declaredMime?: string;
  content: Buffer;
}): ValidatedDocumentFile {
  const content = input.content;
  if (!content || !Buffer.isBuffer(content) || content.length === 0) {
    throw new AppError('File is required', 400);
  }
  if (content.length > MAX_DOCUMENT_BYTES) {
    throw new AppError('File too large', 413);
  }

  const magicMime = inferMimeFromMagic(content);
  if (!magicMime) {
    throw new AppError('Unsupported file type', 400);
  }

  const declared = normalizeDeclaredMime(input.declaredMime || '');
  if (declared && declared !== magicMime) {
    throw new AppError('File content does not match declared type', 400);
  }

  return {
    filename: sanitizeStoredFilename(input.filename),
    mimeType: magicMime,
    byteSize: content.length,
    content,
  };
}
