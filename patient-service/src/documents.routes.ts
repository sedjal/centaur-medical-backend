import {
  getClientIp,
  handleRouteError,
  readInternalUserWithSession,
  reply,
} from '@centaur/shared';
import * as documentsService from './documents.service';
import {
  contentTypeFromHeaders,
  isPatientDocumentUploadPath,
  MAX_MULTIPART_BYTES,
  parseMultipartFormData,
} from './multipart';

type RouteService = {
  get: (path: string, handler: (req: unknown, res: unknown) => Promise<void> | void) => void;
  post: (path: string, handler: (req: unknown, res: unknown) => Promise<void> | void) => void;
  delete: (path: string, handler: (req: unknown, res: unknown) => Promise<void> | void) => void;
};

type ReqLike = {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  params?: { id?: string; docId?: string };
  rawBody?: Buffer;
};

type ResLike = {
  statusCode?: number;
  setHeader: (k: string, v: string) => void;
  end: (chunk?: string | Buffer) => void;
};

export async function attachPatientRequestBody(
  req: ReqLike & { body?: unknown },
  res: ResLike,
  next: () => void
): Promise<void> {
  const method = String(req.method || '').toUpperCase();
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    next();
    return;
  }

  const isUpload = isPatientDocumentUploadPath(req.url);
  const max = isUpload ? MAX_MULTIPART_BYTES : 1_048_576;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
    size += Buffer.byteLength(chunk);
    if (size > max) {
      reply(res, 413, { error: isUpload ? 'File too large' : 'Payload too large' });
      return;
    }
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);
  if (isUpload) {
    req.rawBody = raw;
    next();
    return;
  }
  const text = raw.toString('utf8');
  try {
    req.body = text ? JSON.parse(text) : {};
  } catch {
    req.body = {};
  }
  next();
}

export function registerDocumentRoutes(service: RouteService): void {
  service.get('/patients/:id/documents', async (req, res) => {
    try {
      const user = await readInternalUserWithSession(
        (req as ReqLike).headers as Record<string, string | string[] | undefined>
      );
      const id = String((req as ReqLike).params?.id || '');
      reply(res as ResLike, 200, await documentsService.listPatientDocuments(user, id));
    } catch (err) {
      handleRouteError(res as ResLike, err);
    }
  });

  service.post('/patients/:id/documents', async (req, res) => {
    try {
      const typed = req as ReqLike;
      const user = await readInternalUserWithSession(
        typed.headers as Record<string, string | string[] | undefined>
      );
      const id = String(typed.params?.id || '');
      const contentType = contentTypeFromHeaders(typed.headers || {});
      const parsed = parseMultipartFormData(typed.rawBody || Buffer.alloc(0), contentType);
      const file = parsed.files.find((f) => f.fieldName === 'file');
      if (!file) {
        reply(res as ResLike, 400, { error: 'File is required' });
        return;
      }
      const created = await documentsService.createPatientDocument(
        user,
        id,
        {
          type: parsed.fields.type || '',
          filename: file.filename,
          declaredMime: file.mimeType,
          content: file.data,
        },
        getClientIp(typed)
      );
      reply(res as ResLike, 201, created);
    } catch (err) {
      handleRouteError(res as ResLike, err);
    }
  });

  service.get('/patients/:id/documents/:docId/file', async (req, res) => {
    try {
      const typed = req as ReqLike;
      const user = await readInternalUserWithSession(
        typed.headers as Record<string, string | string[] | undefined>
      );
      const patientId = String(typed.params?.id || '');
      const docId = String(typed.params?.docId || '');
      const file = await documentsService.getPatientDocumentFile(user, patientId, docId);
      const out = res as ResLike;
      out.statusCode = 200;
      out.setHeader('Content-Type', file.mimeType);
      out.setHeader('Content-Disposition', file.contentDisposition);
      out.setHeader('Content-Length', String(file.content.length));
      out.setHeader('X-Content-Type-Options', 'nosniff');
      out.end(file.content);
    } catch (err) {
      handleRouteError(res as ResLike, err);
    }
  });

  service.delete('/patients/:id/documents/:docId', async (req, res) => {
    try {
      const typed = req as ReqLike;
      const user = await readInternalUserWithSession(
        typed.headers as Record<string, string | string[] | undefined>
      );
      const patientId = String(typed.params?.id || '');
      const docId = String(typed.params?.docId || '');
      reply(
        res as ResLike,
        200,
        await documentsService.deletePatientDocument(user, patientId, docId, getClientIp(typed))
      );
    } catch (err) {
      handleRouteError(res as ResLike, err);
    }
  });
}
