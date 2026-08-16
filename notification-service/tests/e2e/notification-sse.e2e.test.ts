/**
 * E2E — SSE temps réel, multi-onglets, worker PENDING→SENT, mark as read.
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';
process.env.NOTIFICATION_SSE_HEARTBEAT_MS = '80';

import test from 'tape';
import { processScheduledNotifications } from '../../src/notification.service';
import { sseConnectionCount } from '../../src/notification-sse';
import { startNotificationE2e, USERS, waitForRecipient, notificationsFor, staffHeaders } from './helpers/harness';
import { prescriptionPayload } from './helpers/notification-e2e-seed';
import { gwHttp } from './helpers/e2e-gateway';
import { parseSseCreatedPayloads, readUntil, notifStreamUrl, gatewayStreamUrl } from './helpers/sse-read';

test('e2e SSE: SENT → event → GET inbox → PATCH read (via Gateway)', async (t) => {
  const h = await startNotificationE2e();
  const ac = new AbortController();
  try {
    const stream = await fetch(gatewayStreamUrl(h.gatewayPort, { access_token: h.tokens.b }), {
      signal: ac.signal,
    });
    t.equal(stream.status, 200);
    t.match(String(stream.headers.get('content-type')), /text\/event-stream/);

    const pending = readUntil(stream, 'notification.created');
    const created = await gwHttp(h.gatewayPort, 'POST', '/api/prescriptions', {
      token: h.tokens.a,
      body: prescriptionPayload(),
    });
    t.equal(created.status, 201);
    const buf = await pending;
    const events = parseSseCreatedPayloads(buf);
    t.equal(events[0].type, 'PRESCRIPTION');
    t.equal(events[0].unreadCount, 1);
    t.equal(Object.keys(events[0]).sort().join(','), 'notificationId,type,unreadCount');

    const list = await gwHttp(h.gatewayPort, 'GET', '/api/notifications?read=false', {
      token: h.tokens.b,
    });
    t.equal(list.status, 200);
    const items = (list.data as { items: Array<{ id: string; title: string; status: string }> }).items;
    t.equal(items.length, 1);
    t.equal(items[0].title, 'Nouvelle ordonnance créée');
    t.equal(items[0].status, 'SENT');

    const read = await gwHttp(h.gatewayPort, 'PATCH', `/api/notifications/${items[0].id}/read`, {
      token: h.tokens.b,
    });
    t.equal(read.status, 200);
    t.equal((read.data as { status: string }).status, 'READ');

    const unread = await gwHttp(h.gatewayPort, 'GET', '/api/notifications?read=false', {
      token: h.tokens.b,
    });
    t.equal((unread.data as { total?: number; items: unknown[] }).items.length, 0);
  } finally {
    ac.abort();
    await h.close();
    t.end();
  }
});

test('e2e SSE: multi-onglets du même utilisateur reçoivent le même event', async (t) => {
  const h = await startNotificationE2e();
  const ac1 = new AbortController();
  const ac2 = new AbortController();
  try {
    const headers = staffHeaders(USERS.b);
    const s1 = await fetch(notifStreamUrl(h.notifPort), {
      headers,
      signal: ac1.signal,
    });
    const s2 = await fetch(notifStreamUrl(h.notifPort), {
      headers,
      signal: ac2.signal,
    });
    t.equal(s1.status, 200);
    t.equal(s2.status, 200);
    t.ok(sseConnectionCount(USERS.b.id) >= 2);

    const p1 = readUntil(s1, 'notification.created');
    const p2 = readUntil(s2, 'notification.created');
    const created = await gwHttp(h.gatewayPort, 'POST', '/api/prescriptions', {
      token: h.tokens.a,
      body: prescriptionPayload(),
    });
    t.equal(created.status, 201);
    const [b1, b2] = await Promise.all([p1, p2]);
    t.ok(parseSseCreatedPayloads(b1).length >= 1);
    t.ok(parseSseCreatedPayloads(b2).length >= 1);
    await waitForRecipient(h.state, USERS.b.id);
    t.equal(notificationsFor(h.state, USERS.b.id).length, 1, 'une seule ligne DB');
  } finally {
    ac1.abort();
    ac2.abort();
    await h.close();
    t.end();
  }
});

test('e2e SSE: heartbeat + worker PENDING → SENT émet, CANCELLED n’émet pas', async (t) => {
  const h = await startNotificationE2e();
  const ac = new AbortController();
  try {
    const stream = await fetch(notifStreamUrl(h.notifPort), {
      headers: staffHeaders(USERS.b),
      signal: ac.signal,
    });
    t.equal(stream.status, 200);
    const beat = await readUntil(stream, ': heartbeat', 400);
    t.match(beat, /heartbeat/);
    ac.abort();

    const past = new Date(Date.now() - 60_000).toISOString();
    h.state.notifications.push(
      {
        id: 'n-due',
        recipient_id: USERS.b.id,
        type: 'REMINDER',
        title: 'Rappel',
        message: 'Secret médical',
        scheduled_at: past,
        sent_at: null,
        status: 'PENDING',
        created_by: USERS.a.id,
      },
      {
        id: 'n-cancel',
        recipient_id: USERS.b.id,
        type: 'REMINDER',
        title: 'Annulée',
        message: 'Nope',
        scheduled_at: past,
        sent_at: null,
        status: 'CANCELLED',
        created_by: USERS.a.id,
      }
    );

    const ac2 = new AbortController();
    const stream2 = await fetch(notifStreamUrl(h.notifPort), {
      headers: staffHeaders(USERS.b),
      signal: ac2.signal,
    });
    const pending = readUntil(stream2, 'n-due');
    const result = await processScheduledNotifications({ now: new Date() });
    t.equal(result.processed, 1);
    const buf = await pending;
    t.match(buf, /notification\.created/);
    t.equal(buf.includes('n-cancel'), false);
    t.equal(buf.includes('Secret médical'), false);
    t.equal(h.state.notifications.find((n) => n.id === 'n-due')?.status, 'SENT');
    ac2.abort();
  } finally {
    await h.close();
    t.end();
  }
});
