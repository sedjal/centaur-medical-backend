/**
 * INTÉGRATION — SSE notifications
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';
process.env.NOTIFICATION_SSE_HEARTBEAT_MS = '5000';

import test from 'tape';
import { EventEmitter } from 'events';
import { processScheduledNotifications } from '../../src/notification.service';
import {
  addSseConnection,
  sseConnectionCount,
  __resetSseConnections,
} from '../../src/notification-sse';
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

class FakeSink extends EventEmitter {
  chunks: string[] = [];
  writable = true;
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  text() {
    return this.chunks.join('');
  }
}

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

async function readUntil(res: Response, needle: string, ms = 2000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const slice = await Promise.race([
      reader.read(),
      new Promise<{ value?: Uint8Array; done: boolean }>((resolve) =>
        setTimeout(() => resolve({ done: false }), remaining)
      ),
    ]);
    if (slice.value) buf += decoder.decode(slice.value, { stream: true });
    if (buf.includes(needle)) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return buf;
    }
    if (slice.done) break;
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  throw new Error(`SSE timeout, got: ${buf.slice(0, 200)}`);
}

test('intégration SSE: 403 sans notifications:read', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  try {
    const denied = await notifHttp(port, 'GET', '/notifications/stream', {
      headers: noPermHeaders,
    });
    t.equal(denied.status, 403);
  } finally {
    await close();
    restoreNotifDbMock();
    __resetSseConnections();
    t.end();
  }
});

test('intégration SSE: create SENT pousse l’event au destinataire seulement', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  __resetSseConnections();
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  const ac = new AbortController();
  try {
    const stream = await fetch(`http://127.0.0.1:${port}/notifications/stream`, {
      headers: secHeaders,
      signal: ac.signal,
    });
    t.equal(stream.status, 200);
    t.match(String(stream.headers.get('content-type')), /text\/event-stream/);

    const pending = readUntil(stream, 'notification.created');
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
    const buf = await pending;
    t.match(buf, /notification\.created/);
    t.match(buf, /"unreadCount":/);
    t.equal(buf.includes('World'), false);

    const other = new FakeSink();
    addSseConnection('u-med', other);
    await new Promise((r) => setTimeout(r, 30));
    t.equal(other.text().includes('notification.created'), false);
  } finally {
    ac.abort();
    await close();
    restoreNotifDbMock();
    __resetSseConnections();
    t.end();
  }
});

test('intégration SSE: worker PENDING → SENT émet ; CANCELLED n’émet pas', async (t) => {
  const past = new Date(Date.now() - 60_000).toISOString();
  installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      {
        id: 'n-due',
        recipient_id: 'u-sec',
        type: 'REMINDER',
        title: 'Rappel',
        message: 'Secret',
        scheduled_at: past,
        sent_at: null,
        status: 'PENDING',
        created_by: 'u-med',
      },
      {
        id: 'n-cancel',
        recipient_id: 'u-sec',
        type: 'REMINDER',
        title: 'Annulée',
        message: 'Nope',
        scheduled_at: past,
        sent_at: null,
        status: 'CANCELLED',
        created_by: 'u-med',
      },
    ],
  });
  __resetSseConnections();
  const sink = new FakeSink();
  addSseConnection('u-sec', sink);
  try {
    const result = await processScheduledNotifications({ now: new Date() });
    t.equal(result.processed, 1);
    t.match(sink.text(), /notification\.created/);
    t.match(sink.text(), /n-due/);
    t.equal(sink.text().includes('n-cancel'), false);
    t.equal(sink.text().includes('Secret'), false);
  } finally {
    restoreNotifDbMock();
    __resetSseConnections();
    t.end();
  }
});

test('intégration SSE: cleanup connexion', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  const app = createNotifTestApp();
  const { port, close } = await listenNotifApp(app);
  const ac = new AbortController();
  try {
    const stream = await fetch(`http://127.0.0.1:${port}/notifications/stream`, {
      headers: secHeaders,
      signal: ac.signal,
    });
    t.equal(stream.status, 200);
    t.ok(sseConnectionCount('u-sec') >= 1);
    ac.abort();
    await new Promise((r) => setTimeout(r, 50));
    t.equal(sseConnectionCount('u-sec'), 0);
  } finally {
    await close();
    restoreNotifDbMock();
    __resetSseConnections();
    t.end();
  }
});
