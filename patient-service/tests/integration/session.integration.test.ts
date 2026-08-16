/**
 * INTÉGRATION HTTP — session_version sur patient-service
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { INTERNAL_HEADERS } from '@centaur/shared';
import { defaultPatientSeed, installPatientDbMock, restorePatientDbMock } from '../helpers/patient-db-mock';
import {
  buildInternalHeaders,
  createPatientTestApp,
  listenPatientApp,
  patientHttp,
} from '../helpers/test-app';

const admin = {
  id: 'u-int',
  email: 'int@test.com',
  role: 'ADMIN',
  permissions: [
    'patients:read',
    'patients:delete',
    'service:general',
    'service:urgence',
    'service:oncologie',
    'service:cardiologie',
  ],
  firstName: 'Int',
  lastName: 'Test',
};

test('intégration session: headers sv valides / expirés / autre user', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  const { port, close } = await listenPatientApp(createPatientTestApp());
  try {
    const ok = await patientHttp(port, 'GET', '/patients', { headers: buildInternalHeaders(admin) });
    t.equal(ok.status, 200);

    const stale = await patientHttp(port, 'GET', '/patients', {
      headers: { ...buildInternalHeaders(admin), [INTERNAL_HEADERS.SESSION_VER]: '9' },
    });
    t.equal(stale.status, 401);

    const missing = await patientHttp(port, 'GET', '/patients', {
      headers: { ...buildInternalHeaders(admin), [INTERNAL_HEADERS.SESSION_VER]: '0' },
    });
    t.equal(missing.status, 401);

    const ghost = await patientHttp(port, 'GET', '/patients', {
      headers: buildInternalHeaders({ ...admin, id: 'u-unknown' }),
    });
    t.equal(ghost.status, 401);

    const row = state.users.find((u) => u.id === 'u-int')!;
    row.is_active = false;
    const inactive = await patientHttp(port, 'GET', '/patients', {
      headers: buildInternalHeaders(admin),
    });
    t.equal(inactive.status, 401);
  } finally {
    await close();
    restorePatientDbMock();
    t.end();
  }
});
