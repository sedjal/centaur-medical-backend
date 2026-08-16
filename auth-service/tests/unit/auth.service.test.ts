/**
 * UNIT — auth.service (login, MFA, reset, users, roles) avec DB mockée
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import sinon from 'sinon';
import * as argon2 from 'argon2';
import axios from 'axios';
import { AppError, hashOtp, ROLE_PERMISSIONS } from '@centaur/shared';
import { installAuthDbMock, restoreAuthDbMock } from '../helpers/auth-db-mock';
import * as authService from '../../src/auth.service';

let axiosStub: sinon.SinonStub;

async function hash(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id });
}

async function seedMedecin(overrides: Record<string, unknown> = {}) {
  const password_hash = await hash('Admin123!');
  installAuthDbMock({
    users: [
      {
        id: 'u-med',
        email: 'medecin@test.com',
        password_hash,
        first_name: 'Racha',
        last_name: 'M',
        role_id: 'r-med',
        is_active: true,
        must_change_password: false,
        mfa_enabled: false,
        mfa_required: false,
        ...overrides,
      },
    ],
    role_permissions: [
      { role_id: 'r-med', permission_id: 'p-read' },
      { role_id: 'r-med', permission_id: 'p-create' },
    ],
  });
  axiosStub = sinon.stub(axios, 'post').resolves({ status: 200 });
  return password_hash;
}

function cleanup() {
  restoreAuthDbMock();
  if (axiosStub) axiosStub.restore();
}

test('auth.service: findUserByEmail + getUserPermissions', async (t) => {
  await seedMedecin();
  const user = await authService.findUserByEmail('medecin@test.com');
  t.ok(user);
  t.equal(user!.role_name, 'MEDECIN');
  const perms = await authService.getUserPermissions('MEDECIN');
  t.ok(perms.includes('patients:read'));
  cleanup();
  t.end();
});

test('auth.service: getUserPermissions fallback ROLE_PERMISSIONS', async (t) => {
  installAuthDbMock({ role_permissions: [] });
  const perms = await authService.getUserPermissions('SECRETAIRE');
  t.deepEqual(perms, ROLE_PERMISSIONS.SECRETAIRE);
  cleanup();
  t.end();
});

test('auth.service: login — invalid / inactive / wrong password', async (t) => {
  installAuthDbMock({ users: [] });
  try {
    await authService.login('unknown@test.com', 'x');
    t.fail('expected 401');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }
  restoreAuthDbMock();

  const offPw = await hash('Admin123!');
  installAuthDbMock({
    users: [
      {
        id: 'u-off',
        email: 'off@test.com',
        password_hash: offPw,
        first_name: 'O',
        last_name: 'F',
        role_id: 'r-med',
        is_active: false,
        must_change_password: false,
        mfa_enabled: false,
        mfa_required: false,
      },
    ],
  });
  try {
    await authService.login('off@test.com', 'Admin123!');
    t.fail('expected 401');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
    t.match((e as Error).message, /Invalid credentials/);
  }
  restoreAuthDbMock();

  await seedMedecin();
  try {
    await authService.login('medecin@test.com', 'wrong');
    t.fail('expected 401');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }
  cleanup();
  t.end();
});

test('auth.service: login OK (ACCESS)', async (t) => {
  await seedMedecin();
  const res = await authService.login('medecin@test.com', 'Admin123!');
  t.equal(res.status, 'OK');
  if (res.status === 'OK') {
    t.ok(res.token);
    t.equal(res.user.email, 'medecin@test.com');
  }
  cleanup();
  t.end();
});

test('auth.service: login CHANGE_PASSWORD + MFA', async (t) => {
  const pw = await hash('Admin123!');
  installAuthDbMock({
    users: [
      {
        id: 'u-new',
        email: 'new@test.com',
        password_hash: pw,
        first_name: 'N',
        last_name: 'E',
        role_id: 'r-med',
        is_active: true,
        must_change_password: true,
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
  });
  axiosStub = sinon.stub(axios, 'post').resolves({ status: 200 });

  const change = await authService.login('new@test.com', 'Admin123!');
  t.equal(change.status, 'CHANGE_PASSWORD');

  const mfa = await authService.login('admin@test.com', 'Admin123!');
  t.equal(mfa.status, 'REQUIRES_MFA');
  if (mfa.status === 'REQUIRES_MFA') t.ok(mfa.mfaToken);

  cleanup();
  t.end();
});

test('auth.service: verifyMfa success + failures', async (t) => {
  const pw = await hash('Admin123!');
  const code = '123456';
  const { state } = installAuthDbMock({
    users: [
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
    role_permissions: [{ role_id: 'r-admin', permission_id: 'p-users' }],
    mfa_codes: [
      {
        id: 'mfa-1',
        user_id: 'u-admin',
        code_hash: hashOtp(code),
        attempts: 0,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        used_at: null,
        created_at: new Date().toISOString(),
      },
    ],
  });
  axiosStub = sinon.stub(axios, 'post').resolves({ status: 200 });

  const ok = await authService.verifyMfa('u-admin', code);
  t.ok(ok.token);
  t.equal(ok.user.email, 'admin@test.com');

  state.mfa_codes.push({
    id: 'mfa-2',
    user_id: 'u-admin',
    code_hash: hashOtp('000000'),
    attempts: 5,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    used_at: null,
  });
  try {
    await authService.verifyMfa('u-admin', '000000');
    t.fail('expected 429');
  } catch (e) {
    t.equal((e as AppError).statusCode, 429);
  }

  try {
    await authService.verifyMfa('missing', code);
    t.fail('expected 401');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }

  cleanup();
  t.end();
});

test('auth.service: changePassword + completeForcedPasswordChange', async (t) => {
  await seedMedecin();
  await authService.changePassword('u-med', 'Admin123!', 'NewPass123!');
  const forced = await authService.completeForcedPasswordChange(
    'u-med',
    'NewPass123!',
    'Another123!'
  );
  t.equal(forced.status, 'OK');
  cleanup();
  t.end();
});

test('auth.service: password reset flow', async (t) => {
  const pw = await hash('Admin123!');
  const code = '654321';
  installAuthDbMock({
    users: [
      {
        id: 'u-med',
        email: 'medecin@test.com',
        password_hash: pw,
        first_name: 'R',
        last_name: 'M',
        role_id: 'r-med',
        is_active: true,
        must_change_password: false,
        mfa_enabled: false,
        mfa_required: false,
      },
    ],
    password_reset_tokens: [
      {
        id: 't1',
        user_id: 'u-med',
        token_hash: hashOtp(code),
        attempts: 0,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        used_at: null,
      },
    ],
  });
  axiosStub = sinon.stub(axios, 'post').resolves({ status: 200 });

  t.deepEqual(await authService.requestPasswordReset('unknown@test.com'), { ok: true });
  t.deepEqual(await authService.requestPasswordReset('medecin@test.com'), { ok: true });

  // Re-seed active token after requestPasswordReset invalidates previous rows
  installAuthDbMock({
    users: [
      {
        id: 'u-med',
        email: 'medecin@test.com',
        password_hash: pw,
        first_name: 'R',
        last_name: 'M',
        role_id: 'r-med',
        is_active: true,
        must_change_password: false,
        mfa_enabled: false,
        mfa_required: false,
      },
    ],
    password_reset_tokens: [
      {
        id: 't2',
        user_id: 'u-med',
        token_hash: hashOtp(code),
        attempts: 0,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        used_at: null,
      },
    ],
  });

  const { resetToken } = await authService.verifyPasswordResetCode('medecin@test.com', code);
  t.ok(resetToken);
  t.deepEqual(await authService.resetPasswordWithSession('u-med', 'ResetPass123!'), { ok: true });

  cleanup();
  t.end();
});

test('auth.service: verifyPasswordResetCode — expired + wrong + lock', async (t) => {
  const pw = await hash('Admin123!');
  const { state } = installAuthDbMock({
    users: [
      {
        id: 'u-med',
        email: 'medecin@test.com',
        password_hash: pw,
        first_name: 'R',
        last_name: 'M',
        role_id: 'r-med',
        is_active: true,
        must_change_password: false,
        mfa_enabled: false,
        mfa_required: false,
      },
    ],
    password_reset_tokens: [
      {
        id: 't1',
        user_id: 'u-med',
        token_hash: hashOtp('111111'),
        attempts: 0,
        expires_at: new Date(Date.now() - 1000).toISOString(),
        used_at: null,
      },
    ],
  });
  try {
    await authService.verifyPasswordResetCode('medecin@test.com', '111111');
    t.fail('expected 400 expired');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  }

  state.password_reset_tokens[0].expires_at = new Date(Date.now() + 600_000).toISOString();
  state.password_reset_tokens[0].attempts = 4;
  try {
    await authService.verifyPasswordResetCode('medecin@test.com', 'badbad');
    t.fail('expected 429');
  } catch (e) {
    t.equal((e as AppError).statusCode, 429);
  }

  cleanup();
  t.end();
});

test('auth.service: users CRUD + delete guards', async (t) => {
  const pw = await hash('Admin123!');
  const { state } = installAuthDbMock({
    users: [
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
      {
        id: 'u-admin2',
        email: 'admin2@test.com',
        password_hash: pw,
        first_name: 'A2',
        last_name: 'D',
        role_id: 'r-admin',
        is_active: true,
        must_change_password: false,
        mfa_enabled: true,
        mfa_required: true,
      },
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
    ],
    role_permissions: [{ role_id: 'r-med', permission_id: 'p-read' }],
  });
  axiosStub = sinon.stub(axios, 'post').resolves({ status: 200 });

  const list = await authService.listUsers();
  t.equal(list.length, 3);

  const created = await authService.createUser({
    email: 'NewUser@test.com',
    password: 'Welcome123!',
    firstName: 'New',
    lastName: 'User',
    role: 'MEDECIN',
  });
  t.ok(created.id);

  await authService.updateUser('u-med', { firstName: 'MedUp', isActive: false, role: 'SECRETAIRE' });
  const listed = await authService.listUsers();
  t.equal(listed.find((u: { id: string }) => u.id === 'u-med')?.first_name, 'MedUp');
  try {
    await authService.me('u-med');
    t.fail('inactive me');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }

  await authService.deleteUser('u-med', 'u-admin');
  t.equal(state.users.length, 3);

  try {
    await authService.deleteUser('u-admin', 'u-admin');
    t.fail('self-delete');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }

  try {
    await authService.deleteUser('u-admin2', 'u-admin');
    t.fail('last admin');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }

  cleanup();
  t.end();
});

test('auth.service: listStaffDirectory — comptes actifs seulement', async (t) => {
  installAuthDbMock({
    users: [
      {
        id: 'u-on',
        email: 'on@test.com',
        first_name: 'Léa',
        last_name: 'On',
        role_id: 'r-med',
        is_active: true,
      },
      {
        id: 'u-off',
        email: 'off@test.com',
        first_name: 'Bo',
        last_name: 'Off',
        role_id: 'r-admin',
        is_active: false,
      },
    ],
  });
  try {
    const list = await authService.listStaffDirectory();
    t.equal(list.length, 1);
    t.equal(list[0].id, 'u-on');
    t.equal(list[0].role, 'MEDECIN');
  } finally {
    restoreAuthDbMock();
    t.end();
  }
});

test('auth.service: roles + permissions', async (t) => {
  const { state } = installAuthDbMock({
    role_permissions: [{ role_id: 'r-med', permission_id: 'p-read' }],
  });

  const perms = await authService.listPermissions();
  t.ok(perms.length >= 1);

  const roles = await authService.listRoles();
  t.ok(roles.some((r) => r.name === 'MEDECIN'));

  const created = await authService.createRole({
    name: 'Technicien',
    permissions: ['patients:read'],
  });
  t.ok(created.id);

  await authService.updateRolePermissions('r-med', ['patients:read', 'patients:create']);
  t.ok(state.role_permissions.length >= 1);

  try {
    await authService.createRole({ name: 'ADMIN', permissions: [] });
    t.fail('system role');
  } catch (e) {
    t.equal((e as AppError).statusCode, 409);
  }

  try {
    await authService.deleteRole('r-admin');
    t.fail('system delete');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  }

  state.users.push({
    id: 'u-x',
    email: 'x@test.com',
    role_id: 'r-custom',
    is_active: true,
  });
  try {
    await authService.deleteRole('r-custom');
    t.fail('role in use');
  } catch (e) {
    t.equal((e as AppError).statusCode, 409);
  }

  cleanup();
  t.end();
});

test('auth.service: MFA refuse un compte inactif', async (t) => {
  const pw = await hash('Admin123!');
  const code = '654321';
  installAuthDbMock({
    users: [
      {
        id: 'u-admin',
        email: 'admin@test.com',
        password_hash: pw,
        first_name: 'A',
        last_name: 'D',
        role_id: 'r-admin',
        is_active: false,
        must_change_password: false,
        mfa_enabled: true,
        mfa_required: true,
      },
    ],
    mfa_codes: [
      {
        id: 'mfa-off',
        user_id: 'u-admin',
        code_hash: hashOtp(code),
        attempts: 0,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        used_at: null,
        created_at: new Date().toISOString(),
      },
    ],
  });
  try {
    await authService.verifyMfa('u-admin', code);
    t.fail('expected 401');
  } catch (e) {
    t.equal((e as AppError).statusCode, 401);
  }
  restoreAuthDbMock();
  t.end();
});

test('auth.service: impossible de désactiver le dernier ADMIN', async (t) => {
  const pw = await hash('Admin123!');
  installAuthDbMock({
    users: [
      {
        id: 'u-admin',
        email: 'admin@test.com',
        password_hash: pw,
        first_name: 'A',
        last_name: 'D',
        role_id: 'r-admin',
        is_active: true,
      },
    ],
  });
  try {
    await authService.updateUser('u-admin', { isActive: false });
    t.fail('last admin deactivate');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  restoreAuthDbMock();
  t.end();
});
