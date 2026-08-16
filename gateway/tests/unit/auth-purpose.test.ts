/**
 * UNIT — gateway requireAuth exige purpose === ACCESS (tape)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { AppError, signToken, type JwtPayload } from '@centaur/shared';
import { requireAuth, requireAuthSse } from '../../src/auth-guard';

function base(purpose?: JwtPayload['purpose']): JwtPayload {
  return {
    sub: 'u1',
    email: 'a@b.c',
    role: 'MEDECIN',
    permissions: ['patients:read'],
    firstName: 'A',
    lastName: 'B',
    purpose,
  };
}

function reqWithBearer(token: string | null) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

test('ACCESS JWT accepté (session réelle)', (t) => {
  const token = signToken(base('ACCESS'), '5m');
  const user = requireAuth(reqWithBearer(token));
  t.equal(user.purpose, 'ACCESS');
  t.equal(user.email, 'a@b.c');
  t.end();
});

test('MFA JWT rejeté (ne peut pas /auth/me ni /patients)', (t) => {
  const token = signToken(base('MFA'), '10m');
  try {
    requireAuth(reqWithBearer(token));
    t.fail('aurait dû throw');
  } catch (err) {
    t.ok(err instanceof AppError);
    t.equal((err as AppError).statusCode, 401);
    t.match((err as AppError).message, /Invalid access token/);
  }
  t.end();
});

test('PASSWORD_RESET JWT rejeté', (t) => {
  const token = signToken(base('PASSWORD_RESET'), '15m');
  t.throws(() => requireAuth(reqWithBearer(token)), /Invalid access token/);
  t.end();
});

test('CHANGE_PASSWORD JWT rejeté', (t) => {
  const token = signToken(base('CHANGE_PASSWORD'), '15m');
  t.throws(() => requireAuth(reqWithBearer(token)), /Invalid access token/);
  t.end();
});

test('JWT sans purpose rejeté', (t) => {
  const payload = base(undefined);
  delete payload.purpose;
  const token = signToken(payload, '5m');
  t.throws(() => requireAuth(reqWithBearer(token)), /Invalid access token/);
  t.end();
});

test('sans Bearer → Unauthorized', (t) => {
  t.throws(() => requireAuth(reqWithBearer(null)), /Unauthorized/);
  t.end();
});

test('requireAuthSse: ACCESS via access_token query', (t) => {
  const token = signToken(base('ACCESS'), '5m');
  const user = requireAuthSse({
    headers: {},
    url: `/api/notifications/stream?access_token=${token}`,
  });
  t.equal(user.sub, 'u1');
  t.end();
});

test('requireAuthSse: query token MFA refusé', (t) => {
  const token = signToken(base('MFA'), '10m');
  t.throws(
    () =>
      requireAuthSse({
        headers: {},
        url: `/api/notifications/stream?access_token=${token}`,
      }),
    /Invalid access token/
  );
  t.end();
});

test('JWT malformé → Invalid or expired token', (t) => {
  t.throws(() => requireAuth(reqWithBearer('not-a-jwt')), /Invalid or expired token/);
  t.end();
});

test('Authorization tableau Bearer accepté', (t) => {
  const token = signToken(base('ACCESS'), '5m');
  const user = requireAuth({
    headers: { Authorization: [`Bearer ${token}`] },
  });
  t.equal(user.purpose, 'ACCESS');
  t.end();
});
