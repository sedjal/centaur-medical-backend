/**
 * INTÉGRATION — worker de notifications planifiées
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { processScheduledNotifications } from '../../src/notification.service';
import {
  createNotifTestApp,
  listenNotifApp,
  buildInternalHeaders,
  notifHttp,
} from '../helpers/test-app';
import {
  defaultNotifSeed,
  installNotifDbMock,
  restoreNotifDbMock,
} from '../helpers/notif-db-mock';

const medHeaders = buildInternalHeaders({
  id: 'u-med',
  email: 'med@test.com',
  role: 'MEDECIN',
  permissions: [
    'notifications:read',
    'notifications:create',
    'notifications:cancel',
    'service:urgence',
  ],
  firstName: 'Léa',
  lastName: 'Urg',
});

const secHeaders = buildInternalHeaders({
  id: 'u-sec',
  email: 'sec@test.com',
  role: 'SECRETAIRE',
  permissions: ['notifications:read', 'service:urgence'],
  firstName: 'Sam',
  lastName: 'Sec',
});

test('intégration worker: PENDING dû → SENT puis non retraité', async (t) => {
  const past = new Date(Date.now() - 120_000).toISOString();
  const now = new Date().toISOString();
  installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      {
        id: 'n-due-http',
        recipient_id: 'u-sec',
        patient_id: null,
        type: 'REMINDER',
        title: 'Échéance',
        message: 'À envoyer',
        scheduled_at: past,
        sent_at: null,
        read_at: null,
        status: 'PENDING',
        created_by: 'u-med',
        created_at: now,
        updated_at: now,
      },
    ],
  });
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  try {
    const before = await notifHttp(port, 'GET', '/notifications/n-due-http', {
      headers: secHeaders,
    });
    t.equal(before.status, 200);
    t.equal((before.data as { status: string }).status, 'PENDING');

    const first = await processScheduledNotifications();
    t.equal(first.processed, 1);

    const after = await notifHttp(port, 'GET', '/notifications/n-due-http', {
      headers: secHeaders,
    });
    t.equal(after.status, 200);
    const body = after.data as { status: string; sentAt: string | null };
    t.equal(body.status, 'SENT');
    t.ok(body.sentAt);

    const second = await processScheduledNotifications();
    t.equal(second.found, 0);
    t.equal(second.processed, 0);

    const again = await notifHttp(port, 'GET', '/notifications/n-due-http', {
      headers: secHeaders,
    });
    t.equal((again.data as { status: string }).status, 'SENT');
  } finally {
    await close();
    restoreNotifDbMock();
    t.end();
  }
});

test('intégration worker: scheduledAt futur reste PENDING', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  try {
    const created = await notifHttp(port, 'POST', '/notifications', {
      headers: medHeaders,
      body: {
        recipientId: 'u-sec',
        type: 'REMINDER',
        title: 'Plus tard',
        message: 'Pas encore',
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    t.equal(created.status, 201);
    const id = (created.data as { id: string }).id;
    t.equal((created.data as { status: string }).status, 'PENDING');

    const result = await processScheduledNotifications();
    t.equal(result.found, 0);

    const get = await notifHttp(port, 'GET', `/notifications/${id}`, {
      headers: secHeaders,
    });
    t.equal((get.data as { status: string }).status, 'PENDING');

    const later = await processScheduledNotifications({
      now: new Date(Date.now() + 3_700_000),
    });
    t.equal(later.processed, 1);

    const sent = await notifHttp(port, 'GET', `/notifications/${id}`, {
      headers: secHeaders,
    });
    t.equal((sent.data as { status: string }).status, 'SENT');
  } finally {
    await close();
    restoreNotifDbMock();
    t.end();
  }
});
