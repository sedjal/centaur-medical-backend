/**
 * E2E — sécurité SSE / Gateway : JWT, permissions, pas de broadcast read_all, pas de ?userId=.
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import fs from 'fs';
import path from 'path';
import test from 'tape';
import { startNotificationE2e, USERS, waitForRecipient, notificationsFor, staffHeaders, bearer } from './helpers/harness';
import { prescriptionPayload } from './helpers/notification-e2e-seed';
import { gwHttp } from './helpers/e2e-gateway';
import { parseSseCreatedPayloads, readAvailable, readUntil, notifStreamUrl, gatewayStreamUrl } from './helpers/sse-read';

test('e2e sécurité: stream sans token / MFA / reset / change / query JWT / sans permission', async (t) => {
  const h = await startNotificationE2e();
  try {
    const none = await fetch(gatewayStreamUrl(h.gatewayPort));
    t.equal(none.status, 401);

    const queryJwt = await fetch(gatewayStreamUrl(h.gatewayPort, { access_token: h.tokens.b }));
    t.equal(queryJwt.status, 401, 'JWT query interdit');

    const mfa = await fetch(gatewayStreamUrl(h.gatewayPort), { headers: bearer(h.tokens.mfa) });
    t.equal(mfa.status, 401);

    const reset = await fetch(gatewayStreamUrl(h.gatewayPort), { headers: bearer(h.tokens.reset) });
    t.equal(reset.status, 401);

    const change = await fetch(gatewayStreamUrl(h.gatewayPort), { headers: bearer(h.tokens.change) });
    t.equal(change.status, 401);

    const noPerm = await fetch(gatewayStreamUrl(h.gatewayPort), { headers: bearer(h.tokens.noPerm) });
    t.equal(noPerm.status, 403);

    const ok = await fetch(gatewayStreamUrl(h.gatewayPort), { headers: bearer(h.tokens.b) });
    t.equal(ok.status, 200);
    ok.body?.cancel();
  } finally {
    await h.close();
    t.end();
  }
});

test('e2e sécurité: ?userId= ne permet pas d’espionner un autre utilisateur', async (t) => {
  const h = await startNotificationE2e();
  const ac = new AbortController();
  try {
    const streamC = await fetch(gatewayStreamUrl(h.gatewayPort, { userId: USERS.b.id }), {
      headers: bearer(h.tokens.c),
      signal: ac.signal,
    });
    t.equal(streamC.status, 200);

    const created = await gwHttp(h.gatewayPort, 'POST', '/api/prescriptions', {
      token: h.tokens.a,
      body: prescriptionPayload(),
    });
    t.equal(created.status, 201);
    await waitForRecipient(h.state, USERS.b.id);
    const buf = await readAvailable(streamC, 300);
    t.equal(buf.includes('notification.created'), false);
    t.equal(notificationsFor(h.state, USERS.c.id).length, 0);
  } finally {
    ac.abort();
    await h.close();
    t.end();
  }
});

test('e2e sécurité: read_all ≠ broadcast SSE', async (t) => {
  const h = await startNotificationE2e();
  const ac = new AbortController();
  try {
    const streamDir = await fetch(notifStreamUrl(h.notifPort), {
      headers: staffHeaders(USERS.dir),
      signal: ac.signal,
    });
    t.equal(streamDir.status, 200);

    const created = await gwHttp(h.gatewayPort, 'POST', '/api/prescriptions', {
      token: h.tokens.a,
      body: prescriptionPayload(),
    });
    t.equal(created.status, 201);
    await waitForRecipient(h.state, USERS.b.id);
    const buf = await readAvailable(streamDir, 300);
    t.equal(buf.includes('notification.created'), false);
    t.equal(notificationsFor(h.state, USERS.dir.id).length, 0);

    const rest = await gwHttp(h.gatewayPort, 'GET', '/api/notifications', { token: h.tokens.dir });
    t.equal(rest.status, 200, 'REST read_all reste autorisé');
  } finally {
    ac.abort();
    await h.close();
    t.end();
  }
});

test('e2e sécurité: event uniquement au destinataire, payload minimal', async (t) => {
  const h = await startNotificationE2e();
  const acA = new AbortController();
  const acB = new AbortController();
  try {
    const streamA = await fetch(notifStreamUrl(h.notifPort), {
      headers: staffHeaders(USERS.a),
      signal: acA.signal,
    });
    const streamB = await fetch(notifStreamUrl(h.notifPort), {
      headers: staffHeaders(USERS.b),
      signal: acB.signal,
    });
    const pendingB = readUntil(streamB, 'notification.created');
    const created = await gwHttp(h.gatewayPort, 'POST', '/api/prescriptions', {
      token: h.tokens.a,
      body: prescriptionPayload(),
    });
    t.equal(created.status, 201);
    const bufB = await pendingB;
    const payload = parseSseCreatedPayloads(bufB)[0];
    t.ok(payload.notificationId);
    t.equal(payload.type, 'PRESCRIPTION');
    t.equal(JSON.stringify(payload).includes('Ibuprofène'), false);
    t.equal(JSON.stringify(payload).includes(h.tokens.a), false);
    t.equal(JSON.stringify(payload).includes('password'), false);

    const bufA = await readAvailable(streamA, 250);
    t.equal(bufA.includes('notification.created'), false, 'acteur: pas de SSE');
  } finally {
    acA.abort();
    acB.abort();
    await h.close();
    t.end();
  }
});

test('e2e sécurité: pas de if (role === MEDECIN) dans le métier notifications', (t) => {
  const roots = [
    path.join(__dirname, '../../src'),
    path.join(__dirname, '../../../patient-service/src'),
    path.join(__dirname, '../../../gateway/src'),
  ];
  const hits: string[] = [];
  function walk(dir: string) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts')) {
        const src = fs.readFileSync(full, 'utf8');
        if (/role\s*===\s*['"]MEDECIN['"]/.test(src) || /role\s*===\s*['"]ADMIN['"]/.test(src)) {
          hits.push(full);
        }
      }
    }
  }
  for (const root of roots) walk(root);
  t.deepEqual(hits, []);
  t.end();
});

test('e2e session: sv bump / compte désactivé → 401 (REST + SSE)', async (t) => {
  const h = await startNotificationE2e();
  try {
    const ok = await gwHttp(h.gatewayPort, 'GET', '/api/notifications', { token: h.tokens.b });
    t.equal(ok.status, 200);

    const b = h.state.users.find((u) => u.id === USERS.b.id)!;
    b.session_version = 2;
    const stale = await gwHttp(h.gatewayPort, 'GET', '/api/notifications', { token: h.tokens.b });
    t.equal(stale.status, 401, 'ancien JWT après permission/session bump');

    const staleStream = await fetch(gatewayStreamUrl(h.gatewayPort), { headers: bearer(h.tokens.b) });
    t.equal(staleStream.status, 401);
    staleStream.body?.cancel();

    b.session_version = 1;
    b.is_active = false;
    const inactive = await gwHttp(h.gatewayPort, 'GET', '/api/notifications', { token: h.tokens.b });
    t.equal(inactive.status, 401, 'compte désactivé');

    const other = await gwHttp(h.gatewayPort, 'GET', '/api/notifications', { token: h.tokens.a });
    t.equal(other.status, 200, 'autre session intacte');
  } finally {
    await h.close();
    t.end();
  }
});
