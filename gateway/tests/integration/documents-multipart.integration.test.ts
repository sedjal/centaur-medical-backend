/**
 * INTÉGRATION — gateway multipart → patient-service (proxy réel, pas mock-only)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'gw-test-service-token-16+';
process.env.NODE_ENV = 'test';

import test from 'tape';
import http from 'http';
import restana from 'restana';
import { AppError, signToken, type JwtPayload, type Permission, reply } from '@centaur/shared';
import { requireAuth } from '../../src/auth-guard';
import { hasPermission, proxyBinary, proxyMultipart } from '../../src/proxy';
import {
  isGatewayDocumentUploadPath,
  MAX_MULTIPART_BYTES,
  readLimitedBody,
} from '../../src/request-body';
import { createPatientTestApp } from '../../../patient-service/tests/helpers/test-app';
import {
  defaultPatientSeed,
  installPatientDbMock,
  restorePatientDbMock,
} from '../../../patient-service/tests/helpers/patient-db-mock';

const boundary = '----CentaurGwDoc';

function pdfBuf() {
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('ok')]);
}

function multipart(type: string, filename: string, mime: string, data: Buffer): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${type}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  );
  return Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
}

function tokenFor(permissions: Permission[]) {
  return signToken(
    {
      sub: 'u-urg',
      email: 'gw@test.com',
      role: 'MEDECIN',
      permissions,
      firstName: 'Gw',
      lastName: 'Test',
      purpose: 'ACCESS',
      sv: 1,
    },
    '5m'
  );
}

function createDocumentGateway(patientBase: string) {
  const service = restana();
  service.use(async (req, res, next) => {
    const pathName = (req as { url?: string }).url?.split('?')[0] || '';
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const isUpload = isGatewayDocumentUploadPath(pathName);
      const max = isUpload ? MAX_MULTIPART_BYTES : 1_048_576;
      const read = await readLimitedBody(req as unknown as AsyncIterable<Buffer>, max);
      if (!read.ok) {
        reply(res, 413, { error: 'File too large' });
        return;
      }
      if (isUpload) {
        (req as { rawBody?: Buffer }).rawBody = read.body;
        next();
        return;
      }
      try {
        (req as { body?: unknown }).body = read.body.length ? JSON.parse(read.body.toString('utf8')) : {};
      } catch {
        reply(res, 400, { error: 'Invalid JSON' });
        return;
      }
    }
    next();
  });

  function requirePerm(user: JwtPayload, perm: Permission) {
    if (!hasPermission(user, perm)) throw new AppError(`Forbidden: ${perm}`, 403);
  }

  service.post('/api/patients/:id/documents', async (req, res) => {
    try {
      const user = requireAuth(req);
      requirePerm(user, 'documents:create');
      const id = (req as unknown as { params: { id: string } }).params.id;
      const contentType = String((req.headers as Record<string, string>)['content-type'] || '');
      const result = await proxyMultipart(patientBase, `/patients/${id}/documents`, {
        user,
        body: (req as { rawBody?: Buffer }).rawBody || Buffer.alloc(0),
        contentType,
      });
      reply(res, result.status, result.data);
    } catch (err) {
      if (err instanceof AppError) reply(res, err.statusCode, { error: err.message });
      else reply(res, 500, { error: 'Internal gateway error' });
    }
  });

  service.get('/api/patients/:id/documents/:docId/file', async (req, res) => {
    try {
      const user = requireAuth(req);
      requirePerm(user, 'documents:read');
      const params = (req as unknown as { params: { id: string; docId: string } }).params;
      proxyBinary({
        targetBase: patientBase,
        path: `/patients/${params.id}/documents/${params.docId}/file`,
        user,
        incoming: req as unknown as http.IncomingMessage,
        outgoing: res as unknown as http.ServerResponse,
      });
    } catch (err) {
      if (err instanceof AppError) reply(res, err.statusCode, { error: err.message });
      else reply(res, 500, { error: 'Internal gateway error' });
    }
  });

  return service;
}

test('gateway multipart → patient-service: upload PDF + download binary', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const patientApp = createPatientTestApp();
  const patientServer = await patientApp.start(0);
  const pAddr = (patientServer as http.Server).address();
  const patientPort = typeof pAddr === 'object' && pAddr ? pAddr.port : 0;
  const patientBase = `http://127.0.0.1:${patientPort}`;

  const gw = createDocumentGateway(patientBase);
  const gwServer = await gw.start(0);
  const gAddr = (gwServer as http.Server).address();
  const gwPort = typeof gAddr === 'object' && gAddr ? gAddr.port : 0;

  try {
    const token = tokenFor(['documents:read', 'documents:create', 'medical_history:read', 'service:urgence']);
    const uploaded = await fetch(`http://127.0.0.1:${gwPort}/api/patients/p-urg-1/documents`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: new Uint8Array(multipart('ECG', 'trace.pdf', 'application/pdf', pdfBuf())),
    });
    t.equal(uploaded.status, 201);
    const created = (await uploaded.json()) as { id: string; content?: unknown };
    t.equal(created.content, undefined);
    t.ok(created.id);

    const file = await fetch(
      `http://127.0.0.1:${gwPort}/api/patients/p-urg-1/documents/${created.id}/file`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    t.equal(file.status, 200);
    t.match(file.headers.get('content-disposition') || '', /attachment/);
    const bytes = Buffer.from(await file.arrayBuffer());
    t.ok(bytes.includes(Buffer.from('%PDF')));
  } finally {
    await gw.close();
    await patientApp.close();
    restorePatientDbMock();
    t.end();
  }
});

test('gateway multipart: JSON POST sur documents est rejeté (pas de parse JSON 1Mo)', async (t) => {
  t.equal(isGatewayDocumentUploadPath('/api/patients/p-1/documents'), true);
  t.equal(isGatewayDocumentUploadPath('/api/patients'), false);
  t.end();
});
