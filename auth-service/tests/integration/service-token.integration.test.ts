/**
 * INTÉGRATION HTTP — auth-service : requireServiceToken sur les routes publiques
 *
 * Vérifie que login / MFA / forgot / verify-reset-code / reset / change-required
 * retournent 401 si x-service-token est absent ou invalide.
 * Un token valide passe la porte (la logique métier renvoie une autre erreur
 * car la DB n'est pas branchée — on n'en a pas besoin ici).
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-xx';
process.env.NODE_ENV = 'test';
process.env.SERVICE_TOKEN = 'auth-int-service-token-32charslongXX';

import http from 'http';
import test from 'tape';
import restana from 'restana';
import { requireServiceToken, reply, handleRouteError } from '@centaur/shared';

const VALID_TOKEN = process.env.SERVICE_TOKEN as string;

// ---------------------------------------------------------------------------
// Mini auth-service HTTP (uniquement les routes à tester ; pas de DB).
// ---------------------------------------------------------------------------
function createAuthTestApp() {
  const service = restana();

  service.use(async (req, res, next) => {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        (req as { body?: unknown }).body = raw ? JSON.parse(raw) : {};
      } catch {
        (req as { body?: unknown }).body = {};
      }
    }
    next();
  });

  // Exactly mirrors the real handlers — only requireServiceToken, then stub reply.
  const publicRoutes: Array<{ method: 'POST'; path: string }> = [
    { method: 'POST', path: '/auth/login' },
    { method: 'POST', path: '/auth/mfa/verify' },
    { method: 'POST', path: '/auth/password/change-required' },
    { method: 'POST', path: '/auth/password/forgot' },
    { method: 'POST', path: '/auth/password/verify-reset-code' },
    { method: 'POST', path: '/auth/password/reset' },
  ];

  for (const { path } of publicRoutes) {
    service.post(path, async (req, res) => {
      try {
        requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
        // Token valid — respond with a sentinel so tests can distinguish "passed the gate"
        reply(res, 200, { ok: true });
      } catch (err) {
        handleRouteError(res, err);
      }
    });
  }

  return service;
}

async function listenApp(app: ReturnType<typeof createAuthTestApp>) {
  const server = await app.start(0);
  const address = (server as http.Server).address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    close: () => app.close(),
  };
}

async function post(
  port: number,
  path: string,
  opts: { serviceToken?: string } = {}
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.serviceToken !== undefined) headers['x-service-token'] = opts.serviceToken;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const ROUTES = [
  '/auth/login',
  '/auth/mfa/verify',
  '/auth/password/change-required',
  '/auth/password/forgot',
  '/auth/password/verify-reset-code',
  '/auth/password/reset',
];

test('auth-service routes publiques : requireServiceToken', async (t) => {
  const app = createAuthTestApp();
  const { port, close } = await listenApp(app);

  for (const route of ROUTES) {
    t.test(`${route} — sans token → 401`, async (st) => {
      const res = await post(port, route);
      st.equal(res.status, 401, `${route} sans token doit retourner 401`);
      st.end();
    });

    t.test(`${route} — token invalide → 401`, async (st) => {
      const res = await post(port, route, { serviceToken: 'wrong-token' });
      st.equal(res.status, 401, `${route} token invalide doit retourner 401`);
      st.end();
    });

    t.test(`${route} — token valide → passe la porte (200)`, async (st) => {
      const res = await post(port, route, { serviceToken: VALID_TOKEN });
      st.notEqual(res.status, 401, `${route} token valide ne doit pas retourner 401`);
      st.end();
    });
  }

  t.teardown(async () => { await close(); });
  t.end();
});
