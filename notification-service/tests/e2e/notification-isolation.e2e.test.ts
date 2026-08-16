/**
 * E2E — isolation service:* : URGENCE notifie URGENCE, pas CARDIOLOGIE.
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { startNotificationE2e, USERS, waitForRecipient, notificationsFor, staffHeaders } from './helpers/harness';
import { prescriptionPayload } from './helpers/notification-e2e-seed';
import { gwHttp } from './helpers/e2e-gateway';
import { parseSseCreatedPayloads, readAvailable, readUntil, notifStreamUrl } from './helpers/sse-read';

test('e2e isolation: ordonnance URGENCE → B reçoit, C (CARDIO) ne reçoit rien', async (t) => {
  const h = await startNotificationE2e();
  const acB = new AbortController();
  const acC = new AbortController();
  try {
    const streamB = await fetch(notifStreamUrl(h.notifPort), {
      headers: staffHeaders(USERS.b),
      signal: acB.signal,
    });
    const streamC = await fetch(notifStreamUrl(h.notifPort), {
      headers: staffHeaders(USERS.c),
      signal: acC.signal,
    });
    t.equal(streamB.status, 200);
    t.equal(streamC.status, 200);

    const pendingB = readUntil(streamB, 'notification.created');

    const created = await gwHttp(h.gatewayPort, 'POST', '/api/prescriptions', {
      token: h.tokens.a,
      body: prescriptionPayload(),
    });
    t.equal(created.status, 201);

    const bufB = await pendingB;
    const eventsB = parseSseCreatedPayloads(bufB);
    t.equal(eventsB.length >= 1, true);
    t.equal(eventsB[0].type, 'PRESCRIPTION');
    t.equal(typeof eventsB[0].notificationId, 'string');
    t.equal(eventsB[0].unreadCount, 1);
    t.equal(JSON.stringify(eventsB[0]).includes('Ibuprofène'), false);

    const bufC = await readAvailable(streamC, 250);
    t.equal(bufC.includes('notification.created'), false, 'SSE CARDIO silencieux');

    await waitForRecipient(h.state, USERS.b.id);
    t.equal(notificationsFor(h.state, USERS.c.id).length, 0);
    t.equal(notificationsFor(h.state, USERS.a.id).length, 0);
  } finally {
    acB.abort();
    acC.abort();
    await h.close();
    t.end();
  }
});
