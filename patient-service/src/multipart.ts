import { AppError } from '@centaur/shared';

export const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;

export interface MultipartFile {
  fieldName: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  files: MultipartFile[];
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] || '';
  return raw || '';
}

export function isPatientDocumentUploadPath(url?: string): boolean {
  const pathName = String(url || '').split('?')[0];
  return /^\/patients\/[^/]+\/documents\/?$/.test(pathName);
}

function parseBoundary(contentType: string): string {
  const m = /boundary=([^;]+)/i.exec(contentType);
  if (!m) throw new AppError('multipart boundary is required', 400);
  let boundary = m[1].trim();
  if (boundary.startsWith('"') && boundary.endsWith('"')) {
    boundary = boundary.slice(1, -1);
  }
  if (!boundary) throw new AppError('multipart boundary is required', 400);
  return boundary;
}

function indexOf(buf: Buffer, search: Buffer, from = 0): number {
  return buf.indexOf(search, from);
}

function parseDisposition(value: string): { name: string; filename?: string } {
  const nameMatch = /(?:^|;)\s*name\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(value);
  const name = (nameMatch?.[1] || nameMatch?.[2] || '').trim();
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value);
  if (star?.[1]) {
    try {
      return { name, filename: decodeURIComponent(star[1].trim()) };
    } catch {
      return { name, filename: star[1].trim() };
    }
  }
  const filenameMatch = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(value);
  const filename = (filenameMatch?.[1] || filenameMatch?.[2] || '').trim();
  return filename ? { name, filename } : { name };
}

function parsePartHeaders(raw: Buffer): Record<string, string> {
  const text = raw.toString('utf8');
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

export function parseMultipartFormData(body: Buffer, contentType: string): ParsedMultipart {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new AppError('Empty multipart body', 400);
  }
  const ct = String(contentType || '');
  if (!/multipart\/form-data/i.test(ct)) {
    throw new AppError('Content-Type must be multipart/form-data', 400);
  }

  const boundary = parseBoundary(ct);
  const delim = Buffer.from(`\r\n--${boundary}`);
  const startDelim = Buffer.from(`--${boundary}`);
  const start = indexOf(body, startDelim, 0);
  if (start !== 0) {
    throw new AppError('Invalid multipart payload', 400);
  }

  const parts: Buffer[] = [];
  let cursor = startDelim.length;
  if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2;

  while (cursor < body.length) {
    const next = indexOf(body, delim, cursor);
    if (next < 0) break;
    parts.push(body.subarray(cursor, next));
    cursor = next + delim.length;
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break;
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2;
    if (parts.length > 16) {
      throw new AppError('Too many multipart parts', 400);
    }
  }

  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  for (const part of parts) {
    const sep = indexOf(part, Buffer.from('\r\n\r\n'));
    if (sep < 0) continue;
    const headers = parsePartHeaders(part.subarray(0, sep));
    const payload = part.subarray(sep + 4);
    const disp = parseDisposition(headers['content-disposition'] || '');
    if (!disp.name) continue;
    if (disp.filename) {
      files.push({
        fieldName: disp.name,
        filename: disp.filename,
        mimeType: headers['content-type'] || 'application/octet-stream',
        data: payload,
      });
    } else {
      if (payload.length > 4096) {
        throw new AppError('Multipart field too large', 400);
      }
      fields[disp.name] = payload.toString('utf8').trim();
    }
  }

  return { fields, files };
}

export function contentTypeFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string {
  return headerValue(headers, 'content-type');
}
