/**
 * INTÉGRATION — Gateway JWT → patient-service (isolation service:*)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'gw-test-service-token-16+';
process.env.NODE_ENV = 'test';

import test from 'tape';
import http from 'http';
import { signToken, type JwtPayload, type Permission } from '@centaur/shared';
import { createTestGateway, listen, httpJson } from './test-app';
import { createPatientServiceProxy } from './patient-proxy';
import {
  defaultPatientSeed,
  installPatientDbMock,
  restorePatientDbMock,
} from '../../../patient-service/tests/helpers/patient-db-mock';

function tokenFor(permissions: Permission[], purpose: JwtPayload['purpose'] = 'ACCESS') {
  return signToken(
    {
      sub: 'u-gw',
      email: 'gw@test.com',
      role: 'CUSTOM',
      permissions,
      firstName: 'Gw',
      lastName: 'Test',
      purpose,
    },
    '5m'
  );
}

const adminPerms: Permission[] = [
  'patients:read',
  'patients:create',
  'patients:update',
  'patients:delete',
  'service:general',
  'service:urgence',
  'service:oncologie',
  'service:cardiologie',
];

const urgPerms: Permission[] = [
  'patients:read',
  'patients:create',
  'patients:update',
  'service:urgence',
];

test('gateway → patient-service isolation', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  const { createPatientTestApp } = await import('../../../patient-service/tests/helpers/test-app');
  const patientApp = createPatientTestApp();
  const server = await patientApp.start(0);
  const address = (server as http.Server).address();
  const patientPort = typeof address === 'object' && address ? address.port : 0;
  const closePatient = async () => {
    await patientApp.close();
  };
  const proxyFn = createPatientServiceProxy(patientPort);
  const gw = createTestGateway(proxyFn);
  const { port, close: closeGw } = await listen(gw);

  t.test('ADMIN GET /api/patients → 5', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients', { token: tokenFor(adminPerms) });
    st.equal(res.status, 200);
    st.equal((res.data as unknown[]).length, 5);
    st.end();
  });

  t.test('URGENCE-only GET /api/patients → 1', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients', { token: tokenFor(urgPerms) });
    st.equal(res.status, 200);
    st.equal((res.data as unknown[]).length, 1);
    st.end();
  });

  t.test('URGENCE-only GET /api/patients/p-cardio-1 → 403', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients/p-cardio-1', {
      token: tokenFor(urgPerms),
    });
    st.equal(res.status, 403);
    st.end();
  });

  t.test('GET /api/patients?search=Ahmed URGENCE-only → 1', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients?search=Ahmed', {
      token: tokenFor(urgPerms),
    });
    st.equal(res.status, 200);
    st.equal((res.data as unknown[]).length, 1);
    st.end();
  });

  t.test('GET /api/dashboard/stats URGENCE scoped', async (st) => {
    const res = await httpJson(port, 'GET', '/api/dashboard/stats', { token: tokenFor(urgPerms) });
    st.equal(res.status, 200);
    st.equal((res.data as { total: number }).total, 1);
    st.end();
  });

  t.test('sans JWT → 401', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients');
    st.equal(res.status, 401);
    st.end();
  });

  t.test('MFA token → 401', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients', {
      token: tokenFor(urgPerms, 'MFA'),
    });
    st.equal(res.status, 401);
    st.end();
  });

  t.test('sans patients:read → 403', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients', {
      token: tokenFor(['service:urgence']),
    });
    st.equal(res.status, 403);
    st.end();
  });

  t.test('POST cross-service CARDIO by URGENCE → 403', async (st) => {
    const res = await httpJson(port, 'POST', '/api/patients', {
      token: tokenFor(urgPerms),
      body: {
        firstName: 'X',
        lastName: 'Y',
        hospitalizationDate: '2026-08-12',
        service: 'CARDIOLOGIE',
        specialty: { ecgResults: 'NSR', restingHeartRate: 70, bloodPressure: '120/80' },
      },
    });
    st.equal(res.status, 403);
    st.end();
  });

  t.teardown(async () => {
    await closeGw();
    await closePatient();
    restorePatientDbMock();
  });
  t.end();
});
