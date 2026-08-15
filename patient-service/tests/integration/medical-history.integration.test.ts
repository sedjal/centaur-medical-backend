/**
 * INTÉGRATION — medical-history HTTP (patient-service)
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
    'medical_history:read',
    'service:urgence',
  ],
  firstName: 'Léa',
  lastName: 'Urg',
});

const noReadHeaders = buildInternalHeaders({
  id: 'u-urg',
  email: 'urg@test.com',
  role: 'MEDECIN',
  permissions: ['service:urgence'],
  firstName: 'Léa',
  lastName: 'Urg',
});

function payload() {
  return {
    patientId: 'p-urg-1',
    prescribedAt: '2026-08-12T14:30:00.000Z',
    medications: [
      { name: 'Ibuprofène', dosage: '400mg', frequency: '2x/jour', duration: '3 jours' },
    ],
  };
}

test('intégration medical-history: GET patient 200 + tri DESC', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const created = await patientHttp(port, 'POST', '/prescriptions', {
      headers: urgHeaders,
      body: payload(),
    });
    t.equal(created.status, 201);
    const rx = created.data as { id: string };

    const hist = await patientHttp(port, 'GET', '/patients/p-urg-1/medical-history', {
      headers: urgHeaders,
    });
    t.equal(hist.status, 200);
    const body = hist.data as { items: Array<{ eventType: string; metadata?: { prescriptionId?: string } }>; total: number };
    t.equal(body.total, 1);
    t.equal(body.items[0].eventType, 'PRESCRIPTION');
    t.equal(body.items[0].metadata?.prescriptionId, rx.id);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration medical-history: GET list filtres + isolation', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    await patientHttp(port, 'POST', '/prescriptions', { headers: urgHeaders, body: payload() });

    const list = await patientHttp(
      port,
      'GET',
      '/medical-history?service=URGENCE&type=PRESCRIPTION',
      { headers: urgHeaders }
    );
    t.equal(list.status, 200);
    const body = list.data as { total: number };
    t.equal(body.total, 1);

    const cardio = await patientHttp(port, 'GET', '/patients/p-cardio-1/medical-history', {
      headers: urgHeaders,
    });
    t.equal(cardio.status, 403);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration medical-history: 400 / 403 / 404', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const badType = await patientHttp(port, 'GET', '/medical-history?type=NOT_A_TYPE', {
      headers: urgHeaders,
    });
    t.equal(badType.status, 400);

    const forbidden = await patientHttp(port, 'GET', '/patients/p-urg-1/medical-history', {
      headers: noReadHeaders,
    });
    t.equal(forbidden.status, 403);

    const missing = await patientHttp(port, 'GET', '/patients/missing/medical-history', {
      headers: urgHeaders,
    });
    t.equal(missing.status, 404);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration medical-history: POST prescription + PATCH cancel créent des events', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const created = await patientHttp(port, 'POST', '/prescriptions', {
      headers: urgHeaders,
      body: payload(),
    });
    t.equal(created.status, 201);
    const id = (created.data as { id: string }).id;

    const cancelled = await patientHttp(port, 'PATCH', `/prescriptions/${id}/cancel`, {
      headers: urgHeaders,
    });
    t.equal(cancelled.status, 200);

    const hist = await patientHttp(port, 'GET', '/patients/p-urg-1/medical-history', {
      headers: urgHeaders,
    });
    const body = hist.data as { items: Array<{ summary: string }>; total: number };
    t.equal(body.total, 2);
    t.ok(body.items.some((i) => i.summary === 'Nouvelle ordonnance créée'));
    t.ok(body.items.some((i) => i.summary === 'Ordonnance annulée'));
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});

test('intégration medical-history: pas de POST public', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const posted = await patientHttp(port, 'POST', '/medical-history', {
      headers: urgHeaders,
      body: { eventType: 'PRESCRIPTION' },
    });
    t.equal(posted.status, 404);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});
