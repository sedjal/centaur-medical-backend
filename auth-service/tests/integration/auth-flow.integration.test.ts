/**
 * INTÉGRATION — auth-service HTTP + auth.service mockée (login / MFA / reset)
 */
import test from 'tape';
import sinon from 'sinon';
import axios from 'axios';
import restana from 'restana';
import { z } from 'zod';
import {
  parseBody,
  requireServiceToken,
  verifyToken,
  reply,
  handleRouteError,
  signToken,
  hashOtp,
} from '@centaur/shared';
import * as authService from '../../src/auth.service';
import { installAuthDbMock, restoreAuthDbMock } from '../helpers/auth-db-mock';
import * as argon2 from 'argon2';

const VALID_TOKEN = 'auth-int-service-token-32charslongXX';

function createAuthApp() {
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

  service.post('/auth/login', async (req, res) => {
    try {
      requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
      const body = z
        .object({ email: z.string().email(), password: z.string().min(1) })
        .parse(parseBody(req));
      reply(res, 200, await authService.login(body.email, body.password));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  service.post('/auth/mfa/verify', async (req, res) => {
    try {
      requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
      const body = z
        .object({ mfaToken: z.string().min(1), code: z.string().length(6) })
        .parse(parseBody(req));
      const payload = verifyToken(body.mfaToken);
      if (payload.purpose !== 'MFA') {
        reply(res, 401, { error: 'Invalid MFA token' });
        return;
      }
      reply(res, 200, await authService.verifyMfa(payload.sub, body.code));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  service.post('/auth/password/forgot', async (req, res) => {
    try {
      requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
      const body = z.object({ email: z.string().email() }).parse(parseBody(req));
      reply(res, 200, await authService.requestPasswordReset(body.email));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  return service;
}

async function listenApp(app: ReturnType<typeof createAuthApp>) {
  const server = await app.start(0);
  const address = (server as { address(): { port: number } | null }).address();
  const port = address?.port || 0;
  return { port, close: () => app.close() };
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
  serviceToken = VALID_TOKEN
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-service-token': serviceToken,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

test('intégration auth HTTP: login OK + MFA + forgot', async (t) => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-xx';
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_TOKEN = VALID_TOKEN;

  const pw = await argon2.hash('Admin123!', { type: argon2.argon2id });
  const code = '112233';
  installAuthDbMock({
    users: [
      {
        id: 'u-med',
        email: 'medecin@test.com',
        password_hash: pw,
        first_name: 'M',
        last_name: 'D',
        role_id: 'r-med',
        is_active: true,
        must_change_password: false,
        mfa_enabled: false,
        mfa_required: false,
      },
      {
        id: 'u-admin',
        email: 'admin@test.com',
        password_hash: pw,
        first_name: 'A',
        last_name: 'D',
        role_id: 'r-admin',
        is_active: true,
        must_change_password: false,
        mfa_enabled: true,
        mfa_required: true,
      },
    ],
    role_permissions: [{ role_id: 'r-med', permission_id: 'p-read' }],
    mfa_codes: [
      {
        id: 'mfa-1',
        user_id: 'u-admin',
        code_hash: hashOtp(code),
        attempts: 0,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        used_at: null,
      },
    ],
  });
  const axiosStub = sinon.stub(axios, 'post').resolves({ status: 200 });

  const app = createAuthApp();
  const { port, close } = await listenApp(app);

  const login = await postJson(port, '/auth/login', {
    email: 'medecin@test.com',
    password: 'Admin123!',
  });
  t.equal(login.status, 200);
  t.equal(login.data.status, 'OK');

  const mfaLogin = await postJson(port, '/auth/login', {
    email: 'admin@test.com',
    password: 'Admin123!',
  });
  t.equal(mfaLogin.status, 200);
  t.equal(mfaLogin.data.status, 'REQUIRES_MFA');
  t.ok(mfaLogin.data.mfaToken);

  const forgot = await postJson(port, '/auth/password/forgot', { email: 'medecin@test.com' });
  t.equal(forgot.status, 200);
  t.deepEqual(forgot.data, { ok: true });

  const noToken = await fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
  });
  t.equal(noToken.status, 401);

  await close();
  restoreAuthDbMock();
  axiosStub.restore();
  t.end();
});
