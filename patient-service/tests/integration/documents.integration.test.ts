/**
 * INTÉGRATION — documents HTTP multipart (patient-service)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import {
  createPatientTestApp,
  listenPatientApp,
  buildInternalHeaders,
  patientHttp,
  patientHttpRaw,
} from '../helpers/test-app';
import {
  defaultPatientSeed,
  installPatientDbMock,
  restorePatientDbMock,
} from '../helpers/patient-db-mock';

const boundary = '----CentaurDocBoundary';

function pdfBuf() {
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('stream\n')]);
}

function jpegBuf() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}

function multipart(type: string, filename: string, mime: string, data: Buffer): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${type}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, data, tail]);
}

const writeHeaders = buildInternalHeaders({
  id: 'u-urg',
  email: 'urg@test.com',
  role: 'MEDECIN',
  permissions: ['documents:read', 'documents:create', 'medical_history:read', 'service:urgence'],
  firstName: 'Léa',
  lastName: 'Urg',
});

const adminHeaders = buildInternalHeaders({
  id: 'u-urg',
  email: 'urg@test.com',
  role: 'ADMIN',
  permissions: [
    'documents:read',
    'documents:create',
    'documents:delete',
    'patients:delete',
    'medical_history:read',
    'service:urgence',
  ],
  firstName: 'Léa',
  lastName: 'Urg',
});

test('intégration documents: POST multipart PDF + GET list sans content + GET file', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const { port, close } = await listenPatientApp(createPatientTestApp());
  try {
    const uploaded = await patientHttpRaw(port, 'POST', '/patients/p-urg-1/documents', {
      headers: {
        ...writeHeaders,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipart('ECG', 'ecg.pdf', 'application/pdf', pdfBuf()),
    });
    t.equal(uploaded.status, 201);
    const created = uploaded.data as { id: string; filename: string; content?: unknown };
    t.equal(created.filename, 'ecg.pdf');
    t.equal(created.content, undefined);

    const list = await patientHttp(port, 'GET', '/patients/p-urg-1/documents', { headers: writeHeaders });
    t.equal(list.status, 200);
    const items = list.data as Array<{ filename: string; content?: unknown }>;
    t.equal(items.length, 1);
    t.equal(items[0].content, undefined);

    const file = await patientHttpRaw(port, 'GET', `/patients/p-urg-1/documents/${created.id}/file`, {
      headers: writeHeaders,
    });
    t.equal(file.status, 200);
    t.match(file.headers.get('content-disposition') || '', /attachment/);
    t.ok(file.raw.includes(Buffer.from('%PDF')));

    const hist = await patientHttp(port, 'GET', '/patients/p-urg-1/medical-history', {
      headers: writeHeaders,
    });
    t.equal(hist.status, 200);
    const events = (hist.data as { items: Array<{ eventType: string; metadata?: { filename?: string } }> }).items;
    t.equal(events[0].eventType, 'DOCUMENT_ADDED');
    t.equal(events[0].metadata?.filename, 'ecg.pdf');
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration documents: MIME spoof JPEG as PDF → 400', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const { port, close } = await listenPatientApp(createPatientTestApp());
  try {
    const res = await patientHttpRaw(port, 'POST', '/patients/p-urg-1/documents', {
      headers: {
        ...writeHeaders,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipart('AUTRE', 'fake.pdf', 'application/pdf', jpegBuf()),
    });
    t.equal(res.status, 400);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration documents: trop volumineux → 413', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const { port, close } = await listenPatientApp(createPatientTestApp());
  try {
    const huge = Buffer.concat([pdfBuf(), Buffer.alloc(5 * 1024 * 1024)]);
    const res = await patientHttpRaw(port, 'POST', '/patients/p-urg-1/documents', {
      headers: {
        ...writeHeaders,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipart('AUTRE', 'huge.pdf', 'application/pdf', huge),
    });
    t.equal(res.status, 413);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration documents: sans documents:create → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const { port, close } = await listenPatientApp(createPatientTestApp());
  try {
    const headers = buildInternalHeaders({
      id: 'u-urg',
      email: 'urg@test.com',
      role: 'DIRECTION',
      permissions: ['documents:read', 'service:urgence'],
      firstName: 'Dir',
      lastName: 'Test',
    });
    const res = await patientHttpRaw(port, 'POST', '/patients/p-urg-1/documents', {
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipart('AUTRE', 'a.pdf', 'application/pdf', pdfBuf()),
    });
    t.equal(res.status, 403);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration documents: DELETE ADMIN + patient 409', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const { port, close } = await listenPatientApp(createPatientTestApp());
  try {
    const uploaded = await patientHttpRaw(port, 'POST', '/patients/p-urg-1/documents', {
      headers: {
        ...adminHeaders,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipart('AUTRE', 'a.pdf', 'application/pdf', pdfBuf()),
    });
    t.equal(uploaded.status, 201);
    const id = (uploaded.data as { id: string }).id;

    const delPatient = await patientHttp(port, 'DELETE', '/patients/p-urg-1', { headers: adminHeaders });
    t.equal(delPatient.status, 409);

    const del = await patientHttp(port, 'DELETE', `/patients/p-urg-1/documents/${id}`, {
      headers: adminHeaders,
    });
    t.equal(del.status, 200);

    const hist = await patientHttp(port, 'GET', '/patients/p-urg-1/medical-history', {
      headers: adminHeaders,
    });
    const events = (hist.data as { items: Array<{ eventType: string }> }).items;
    t.ok(events.some((e) => e.eventType === 'DOCUMENT_ADDED'));
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});
