/**
 * UNIT — live session version + listen bind
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import {
  AppError,
  INTERNAL_HEADERS,
  assertLiveSession,
  getListenHost,
  readInternalUserWithSession,
  verifyToken,
  type InternalUser,
} from '@centaur/shared';
import { installAuthDbMock, restoreAuthDbMock } from '../helpers/auth-db-mock';
import * as authService from '../../src/auth.service';

const user: InternalUser = {
  id: 'u-med',
  email: 'medecin@test.com',
  role: 'MEDECIN',
  permissions: ['patients:read'],
  firstName: 'Racha',
  lastName: 'M',
};

function headers(sv: string | number) {
  return {
    [INTERNAL_HEADERS.SERVICE_TOKEN]: 'test-service-token',
    [INTERNAL_HEADERS.USER_ID]: user.id,
    [INTERNAL_HEADERS.USER_EMAIL]: user.email,
    [INTERNAL_HEADERS.USER_ROLE]: user.role,
    [INTERNAL_HEADERS.USER_PERMISSIONS]: JSON.stringify(user.permissions),
    [INTERNAL_HEADERS.USER_FIRST_NAME]: user.firstName,
    [INTERNAL_HEADERS.USER_LAST_NAME]: user.lastName,
    [INTERNAL_HEADERS.SESSION_VER]: String(sv),
  };
}

function seedUser(overrides: Record<string, unknown> = {}) {
  installAuthDbMock({
    users: [
      {
        id: 'u-med',
        email: 'medecin@test.com',
        password_hash: 'x',
        first_name: 'Racha',
        last_name: 'M',
        role_id: 'r-med',
        is_active: true,
        session_version: 1,
        ...overrides,
      },
    ],
  });
}

test('assertLiveSession: sv + actif OK', async (t) => {
  seedUser();
  await assertLiveSession(user, headers(1));
  restoreAuthDbMock();
  t.end();
});

test('assertLiveSession: sv mismatch / inactif / absent / missing claim → 401', async (t) => {
  seedUser();
  try {
    await assertLiveSession(user, headers(0));
    t.fail('legacy 0');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }
  try {
    await assertLiveSession(user, headers(9));
    t.fail('wrong sv');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }
  restoreAuthDbMock();

  seedUser({ is_active: false });
  try {
    await assertLiveSession(user, headers(1));
    t.fail('inactive');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }
  restoreAuthDbMock();

  installAuthDbMock({ users: [] });
  try {
    await assertLiveSession(user, headers(1));
    t.fail('missing user');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }
  restoreAuthDbMock();
  t.end();
});

test('readInternalUserWithSession: headers sv=1', async (t) => {
  seedUser();
  const live = await readInternalUserWithSession(headers(1));
  t.equal(live.id, 'u-med');
  restoreAuthDbMock();
  t.end();
});

test('auth.service: login ACCESS carries sv; logout/refresh/permissions bump', async (t) => {
  const argon2 = await import('argon2');
  const password_hash = await argon2.hash('Admin123!', { type: argon2.argon2id });
  seedUser({ password_hash, must_change_password: false, mfa_enabled: false, mfa_required: false });
  const login = await authService.login('medecin@test.com', 'Admin123!');
  if (login.status !== 'OK') {
    t.fail('login');
    restoreAuthDbMock();
    t.end();
    return;
  }
  t.equal(login.user.sv, 1);
  t.equal(verifyToken(login.token).purpose, 'ACCESS');
  t.equal(verifyToken(login.token).sv, 1);

  await authService.logoutSession('u-med');
  const refreshed = await authService.refreshAccessSession('u-med');
  t.equal(refreshed.user.sv, 2);

  await authService.updateUser('u-med', { isActive: false });
  try {
    await authService.refreshAccessSession('u-med');
    t.fail('inactive');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }
  restoreAuthDbMock();
  t.end();
});

test('getListenHost: public vs internal', (t) => {
  const prevListen = process.env.LISTEN_HOST;
  const prevGw = process.env.GATEWAY_LISTEN_HOST;
  const prevNode = process.env.NODE_ENV;
  delete process.env.LISTEN_HOST;
  delete process.env.GATEWAY_LISTEN_HOST;
  process.env.NODE_ENV = 'test';
  t.equal(getListenHost('internal'), '127.0.0.1');
  t.equal(getListenHost('public'), '0.0.0.0');
  process.env.LISTEN_HOST = '0.0.0.0';
  t.equal(getListenHost('internal'), '0.0.0.0');
  process.env.NODE_ENV = 'production';
  delete process.env.LISTEN_HOST;
  t.equal(getListenHost('internal'), '127.0.0.1');
  t.equal(getListenHost('public'), '0.0.0.0');
  if (prevListen === undefined) delete process.env.LISTEN_HOST;
  else process.env.LISTEN_HOST = prevListen;
  if (prevGw === undefined) delete process.env.GATEWAY_LISTEN_HOST;
  else process.env.GATEWAY_LISTEN_HOST = prevGw;
  process.env.NODE_ENV = prevNode;
  t.end();
});
