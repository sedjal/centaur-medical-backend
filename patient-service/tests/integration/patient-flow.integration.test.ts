/**
 * INTÉGRATION HTTP — patient-service routes + headers internes
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { defaultPatientSeed, installPatientDbMock, restorePatientDbMock } from '../helpers/patient-db-mock';
import {
  buildInternalHeaders,
  createPatientTestApp,
  listenPatientApp,
  patientHttp,
} from '../helpers/test-app';

function user(
  permissions: string[],
  role: string,
  id = 'u-int'
) {
  return {
    id,
    email: 'int@test.com',
    role,
    permissions,
    firstName: 'Int',
    lastName: 'Test',
  };
}

const admin = () =>
  user(
    [
      'patients:read',
      'patients:create',
      'patients:update',
      'patients:delete',
      'service:general',
      'service:urgence',
      'service:oncologie',
      'service:cardiologie',
    ],
    'ADMIN'
  );

const urgOnly = () =>
  user(['patients:read', 'patients:create', 'patients:update', 'service:urgence'], 'MEDECIN_URGENCE');

test('integration patient-service HTTP', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);

  t.test('GET /patients ADMIN → 5', async (st) => {
    const res = await patientHttp(port, 'GET', '/patients', {
      headers: buildInternalHeaders(admin()),
    });
    st.equal(res.status, 200);
    st.equal((res.data as unknown[]).length, 5);
    st.end();
  });

  t.test('GET /patients URGENCE-only → 1', async (st) => {
    const res = await patientHttp(port, 'GET', '/patients', {
      headers: buildInternalHeaders(urgOnly()),
    });
    st.equal(res.status, 200);
    st.equal((res.data as unknown[]).length, 1);
    st.end();
  });

  t.test('GET /patients?search=Ahmed URGENCE-only → 1', async (st) => {
    const res = await patientHttp(port, 'GET', '/patients?search=Ahmed', {
      headers: buildInternalHeaders(urgOnly()),
    });
    st.equal(res.status, 200);
    st.equal((res.data as unknown[]).length, 1);
    st.end();
  });

  t.test('GET /patients?service=CARDIOLOGIE URGENCE-only → 403', async (st) => {
    const res = await patientHttp(port, 'GET', '/patients?service=CARDIOLOGIE', {
      headers: buildInternalHeaders(urgOnly()),
    });
    st.equal(res.status, 403);
    st.end();
  });

  t.test('GET /patients/:id cross-service → 403', async (st) => {
    const res = await patientHttp(port, 'GET', '/patients/p-cardio-1', {
      headers: buildInternalHeaders(urgOnly()),
    });
    st.equal(res.status, 403);
    st.end();
  });

  t.test('GET /patients/:id authorized → 200 + dossier', async (st) => {
    const res = await patientHttp(port, 'GET', '/patients/p-urg-1', {
      headers: buildInternalHeaders(urgOnly()),
    });
    st.equal(res.status, 200);
    st.ok((res.data as { specialty?: unknown }).specialty);
    st.end();
  });

  t.test('GET /dashboard/stats URGENCE scoped', async (st) => {
    const res = await patientHttp(port, 'GET', '/dashboard/stats', {
      headers: buildInternalHeaders(urgOnly()),
    });
    st.equal(res.status, 200);
    st.equal((res.data as { total: number }).total, 1);
    st.end();
  });

  t.test('sans service token → 401', async (st) => {
    const res = await patientHttp(port, 'GET', '/patients', {
      headers: { 'x-user-id': 'x', 'x-user-email': 'a@b.c', 'x-user-role': 'ADMIN', 'x-user-permissions': '[]' },
    });
    st.equal(res.status, 401);
    st.end();
  });

  t.test('sans patients:read → 403', async (st) => {
    const res = await patientHttp(port, 'GET', '/patients', {
      headers: buildInternalHeaders(user(['service:urgence'], 'X')),
    });
    st.equal(res.status, 403);
    st.end();
  });

  t.test('POST /patients URGENCE OK', async (st) => {
    const body = {
      firstName: 'Nouveau',
      lastName: 'Urg',
      hospitalizationDate: '2026-08-12',
      service: 'URGENCE',
      specialty: { arrivalTime: '12:00', triageLevel: '2', initialSeverity: 'Stable' },
    };
    const res = await patientHttp(port, 'POST', '/patients', {
      headers: { ...buildInternalHeaders(urgOnly()), 'x-forwarded-for': '10.0.0.5' },
      body,
    });
    st.equal(res.status, 201);
    st.end();
  });

  t.test('POST /patients cross-service → 403', async (st) => {
    const body = {
      firstName: 'Bad',
      lastName: 'Cross',
      hospitalizationDate: '2026-08-12',
      service: 'CARDIOLOGIE',
      specialty: { ecgResults: 'NSR', restingHeartRate: 70, bloodPressure: '120/80' },
    };
    const res = await patientHttp(port, 'POST', '/patients', {
      headers: buildInternalHeaders(urgOnly()),
      body,
    });
    st.equal(res.status, 403);
    st.end();
  });

  t.teardown(async () => {
    await close();
    restorePatientDbMock();
  });
  t.end();
});
