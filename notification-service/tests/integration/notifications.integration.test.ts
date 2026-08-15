/**
 * INTÉGRATION — notifications HTTP
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
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

const noPermHeaders = buildInternalHeaders({
  id: 'u-med',
  email: 'med@test.com',
  role: 'MEDECIN',
  permissions: ['service:urgence'],
  firstName: 'Léa',
  lastName: 'Urg',
});

test('intégration notifications: POST create 201 + GET list', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  try {
    const created = await notifHttp(port, 'POST', '/notifications', {
      headers: medHeaders,
      body: {
        recipientId: 'u-sec',
        type: 'GENERAL',
        title: 'Hello',
        message: 'World',
        scheduledAt: new Date().toISOString(),
      },
    });
    t.equal(created.status, 201);
    const body = created.data as { id: string; status: string };
    t.equal(body.status, 'SENT');

    const list = await notifHttp(port, 'GET', '/notifications', { headers: secHeaders });
    t.equal(list.status, 200);
    const listBody = list.data as { total: number; items: unknown[] };
    t.equal(listBody.total, 1);

    const one = await notifHttp(port, 'GET', `/notifications/${body.id}`, {
      headers: secHeaders,
    });
    t.equal(one.status, 200);
  } finally {
    await close();
    restoreNotifDbMock();
    t.end();
  }
});

test('intégration notifications: 400 / 403 / 404', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  try {
    const bad = await notifHttp(port, 'POST', '/notifications', {
      headers: medHeaders,
      body: {
        recipientId: 'u-sec',
        type: 'NOT_A_TYPE',
        title: 'x',
        message: 'y',
        scheduledAt: new Date().toISOString(),
      },
    });
    t.equal(bad.status, 400);

    const forbidden = await notifHttp(port, 'GET', '/notifications', {
      headers: noPermHeaders,
    });
    t.equal(forbidden.status, 403);

    const missing = await notifHttp(port, 'GET', '/notifications/missing', {
      headers: secHeaders,
    });
    t.equal(missing.status, 404);

    const cross = await notifHttp(port, 'POST', '/notifications', {
      headers: medHeaders,
      body: {
        recipientId: 'u-sec',
        patientId: 'p-cardio-1',
        type: 'PATIENT',
        title: 'x',
        message: 'y',
        scheduledAt: new Date().toISOString(),
      },
    });
    t.equal(cross.status, 403);
  } finally {
    await close();
    restoreNotifDbMock();
    t.end();
  }
});

test('intégration notifications: mark read + cancel', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  try {
    const sent = await notifHttp(port, 'POST', '/notifications', {
      headers: medHeaders,
      body: {
        recipientId: 'u-sec',
        type: 'GENERAL',
        title: 'Lire',
        message: 'msg',
        scheduledAt: new Date().toISOString(),
      },
    });
    const sentId = (sent.data as { id: string }).id;

    const read = await notifHttp(port, 'PATCH', `/notifications/${sentId}/read`, {
      headers: secHeaders,
    });
    t.equal(read.status, 200);
    t.equal((read.data as { status: string }).status, 'READ');

    const pending = await notifHttp(port, 'POST', '/notifications', {
      headers: medHeaders,
      body: {
        recipientId: 'u-sec',
        type: 'REMINDER',
        title: 'Futur',
        message: 'msg',
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    const pendingId = (pending.data as { id: string }).id;
    const cancelled = await notifHttp(port, 'PATCH', `/notifications/${pendingId}/cancel`, {
      headers: medHeaders,
    });
    t.equal(cancelled.status, 200);
    t.equal((cancelled.data as { status: string }).status, 'CANCELLED');
  } finally {
    await close();
    restoreNotifDbMock();
    t.end();
  }
});

test('intégration notifications: recipient isolation HTTP', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  try {
    const created = await notifHttp(port, 'POST', '/notifications', {
      headers: medHeaders,
      body: {
        recipientId: 'u-sec',
        type: 'GENERAL',
        title: 'Privé',
        message: 'msg',
        scheduledAt: new Date().toISOString(),
      },
    });
    const id = (created.data as { id: string }).id;

    const other = await notifHttp(port, 'GET', `/notifications/${id}`, {
      headers: medHeaders,
    });
    t.equal(other.status, 403);
  } finally {
    await close();
    restoreNotifDbMock();
    t.end();
  }
});
