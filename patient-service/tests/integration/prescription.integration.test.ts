/**
 * INTÉGRATION — prescriptions HTTP (patient-service)
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
} from '../helpers/test-app';
import {
  defaultPatientSeed,
  installPatientDbMock,
  restorePatientDbMock,
} from '../helpers/patient-db-mock';

const urgHeaders = buildInternalHeaders({
  id: 'u-urg',
  email: 'urg@test.com',
  role: 'MEDECIN',
  permissions: [
    'prescriptions:read',
    'prescriptions:create',
    'prescriptions:cancel',
    'service:urgence',
  ],
  firstName: 'Léa',
  lastName: 'Urg',
});

const noCreateHeaders = buildInternalHeaders({
  id: 'u-urg',
  email: 'urg@test.com',
  role: 'MEDECIN',
  permissions: ['prescriptions:read', 'service:urgence'],
  firstName: 'Léa',
  lastName: 'Urg',
});

function payload(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'p-urg-1',
    prescribedAt: '2026-08-12T14:30:00.000Z',
    notes: 'Antalgique',
    medications: [
      {
        name: 'Ibuprofène',
        dosage: '400mg',
        frequency: '2x/jour',
        duration: '3 jours',
      },
    ],
    ...overrides,
  };
}

test('intégration prescriptions: POST create + GET detail + GET patient', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const created = await patientHttp(port, 'POST', '/prescriptions', {
      headers: urgHeaders,
      body: { ...payload(), doctorId: 'should-be-ignored' },
    });
    t.equal(created.status, 201);
    const body = created.data as { id: string; doctorId: string; status: string };
    t.equal(body.doctorId, 'u-urg');
    t.equal(body.status, 'ACTIVE');

    const detail = await patientHttp(port, 'GET', `/prescriptions/${body.id}`, {
      headers: urgHeaders,
    });
    t.equal(detail.status, 200);

    const list = await patientHttp(port, 'GET', '/patients/p-urg-1/prescriptions', {
      headers: urgHeaders,
    });
    t.equal(list.status, 200);
    t.ok(Array.isArray(list.data));
    t.equal((list.data as unknown[]).length, 1);

    const filtered = await patientHttp(
      port,
      'GET',
      '/prescriptions?patientId=p-urg-1&status=ACTIVE',
      { headers: urgHeaders }
    );
    t.equal(filtered.status, 200);
    t.equal((filtered.data as unknown[]).length, 1);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration prescriptions: POST sans permission → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const res = await patientHttp(port, 'POST', '/prescriptions', {
      headers: noCreateHeaders,
      body: payload(),
    });
    t.equal(res.status, 403);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration prescriptions: POST medications [] → 400', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const res = await patientHttp(port, 'POST', '/prescriptions', {
      headers: urgHeaders,
      body: payload({ medications: [] }),
    });
    t.equal(res.status, 400);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration prescriptions: PATCH cancel + 409', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const created = await patientHttp(port, 'POST', '/prescriptions', {
      headers: urgHeaders,
      body: payload(),
    });
    const id = (created.data as { id: string }).id;

    const cancel = await patientHttp(port, 'PATCH', `/prescriptions/${id}/cancel`, {
      headers: urgHeaders,
    });
    t.equal(cancel.status, 200);
    t.equal((cancel.data as { status: string }).status, 'CANCELLED');

    const again = await patientHttp(port, 'PATCH', `/prescriptions/${id}/cancel`, {
      headers: urgHeaders,
    });
    t.equal(again.status, 409);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration prescriptions: GET inexistant → 404', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const res = await patientHttp(port, 'GET', '/prescriptions/missing', {
      headers: urgHeaders,
    });
    t.equal(res.status, 404);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});
