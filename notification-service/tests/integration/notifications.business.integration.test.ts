/**
 * INTÉGRATION — notifications métier internes (service token)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { INTERNAL_HEADERS } from '@centaur/shared';
import {
  defaultNotifSeed,
  installNotifDbMock,
  restoreNotifDbMock,
} from '../helpers/notif-db-mock';
import { createNotifTestApp, listenNotifApp, notifHttp } from '../helpers/test-app';

test('intégration: POST /internal/notifications/events exige le service token', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  try {
    const denied = await notifHttp(port, 'POST', '/internal/notifications/events', {
      headers: { 'content-type': 'application/json' },
      body: {
        kind: 'PRESCRIPTION_CREATED',
        actorId: 'u-med',
        patientId: 'p-urg-1',
        service: 'URGENCE',
      },
    });
    t.equal(denied.status, 401);

    const ok = await notifHttp(port, 'POST', '/internal/notifications/events', {
      headers: {
        'content-type': 'application/json',
        [INTERNAL_HEADERS.SERVICE_TOKEN]: 'test-service-token',
      },
      body: {
        kind: 'PRESCRIPTION_CREATED',
        actorId: 'u-med',
        patientId: 'p-urg-1',
        service: 'URGENCE',
      },
    });
    t.equal(ok.status, 200);
    t.equal((ok.data as { created: number }).created, 1);
    t.deepEqual((ok.data as { recipientIds: string[] }).recipientIds, ['u-sec']);
  } finally {
    await close();
    restoreNotifDbMock();
    t.end();
  }
});
