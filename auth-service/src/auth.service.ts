import * as argon2 from 'argon2';
import axios from 'axios';
import {
  AppError,
  ROLE_PERMISSIONS,
  assertPasswordPolicy,
  createDb,
  generateOtpCode,
  getDb,
  hashOtp,
  logDevSecret,
  signToken,
  type JwtPayload,
  type Permission,
  type RoleName,
} from '@centaur/shared';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role_id: string;
  is_active: boolean;
  must_change_password: boolean;
  mfa_enabled: boolean;
  mfa_required: boolean;
  role_name: RoleName;
}

async function notify(path: string, body: Record<string, unknown>): Promise<void> {
  const notifUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:3003';
  const serviceToken = process.env.SERVICE_TOKEN || 'centaur-internal-service-token-dev';
  await axios.post(`${notifUrl}${path}`, body, {
    headers: { 'x-service-token': serviceToken },
    timeout: 5000,
  });
}

function needsMfa(user: UserRow): boolean {
  return (
    user.mfa_required || user.role_name === 'ADMIN' || user.role_name === 'DIRECTION'
  );
}

async function issueMfaChallenge(user: UserRow): Promise<{ status: 'REQUIRES_MFA'; mfaToken: string; email: string }> {
  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await getDb()('mfa_codes').where({ user_id: user.id, used_at: null }).update({
    used_at: getDb().fn.now(),
  });

  await getDb()('mfa_codes').insert({
    user_id: user.id,
    code_hash: codeHash,
    attempts: 0,
    expires_at: expiresAt,
  });

  try {
    await notify('/internal/emails/mfa', {
      userId: user.id,
      email: user.email,
      code,
      firstName: user.first_name,
    });
  } catch (err) {
    console.warn('[auth] MFA email failed');
    console.warn(err instanceof Error ? err.message : err);
    logDevSecret(`MFA code for ${user.email}`, code);
  }

  logDevSecret(`MFA code for ${user.email}`, code);

  const mfaToken = signToken(
    {
      sub: user.id,
      email: user.email,
      role: user.role_name,
      permissions: [],
      firstName: user.first_name,
      lastName: user.last_name,
      purpose: 'MFA',
    },
    '10m'
  );
  return { status: 'REQUIRES_MFA', mfaToken, email: user.email };
}

async function issueAccessSession(user: UserRow): Promise<{ status: 'OK'; token: string; user: JwtPayload }> {
  const permissions = await getUserPermissions(user.role_name);
  const payload = buildJwtPayload(user, permissions);
  const token = signToken({ ...payload, purpose: 'ACCESS' });
  return { status: 'OK', token, user: payload };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const row = await getDb()
    .table('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .whereRaw('LOWER(u.email) = ?', [email.toLowerCase()])
    .select(
      'u.id',
      'u.email',
      'u.password_hash',
      'u.first_name',
      'u.last_name',
      'u.role_id',
      'u.is_active',
      'u.must_change_password',
      'u.mfa_enabled',
      'u.mfa_required',
      'r.name as role_name'
    )
    .first();
  return (row as UserRow) || null;
}

export async function getUserPermissions(roleName: RoleName): Promise<Permission[]> {
  const rows = await getDb()
    .table('role_permissions as rp')
    .join('roles as r', 'r.id', 'rp.role_id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('r.name', roleName)
    .select('p.code');
  if (rows.length === 0) {
    return (ROLE_PERMISSIONS as Record<string, Permission[]>)[roleName] || [];
  }
  return rows.map((r: { code: Permission }) => r.code);
}

function buildJwtPayload(user: UserRow, permissions: Permission[]): JwtPayload {
  return {
    sub: user.id,
    email: user.email,
    role: user.role_name,
    permissions,
    firstName: user.first_name,
    lastName: user.last_name,
  };
}

export async function login(
  email: string,
  password: string
): Promise<
  | { status: 'OK'; token: string; user: JwtPayload }
  | { status: 'REQUIRES_MFA'; mfaToken: string; email: string }
  | { status: 'CHANGE_PASSWORD'; tempToken: string }
> {
  const user = await findUserByEmail(email);
  if (!user) throw new AppError('Invalid credentials', 401);
  if (!user.is_active) throw new AppError('Account is inactive', 403);

  const valid = await argon2.verify(user.password_hash, password);
  if (!valid) throw new AppError('Invalid credentials', 401);

  if (user.must_change_password) {
    const tempToken = signToken(
      {
        sub: user.id,
        email: user.email,
        role: user.role_name,
        permissions: [],
        firstName: user.first_name,
        lastName: user.last_name,
        purpose: 'CHANGE_PASSWORD',
      },
      '15m'
    );
    return { status: 'CHANGE_PASSWORD', tempToken };
  }

  if (needsMfa(user)) {
    return issueMfaChallenge(user);
  }

  return issueAccessSession(user);
}

export async function verifyMfa(
  mfaTokenSub: string,
  code: string
): Promise<{ token: string; user: JwtPayload }> {
  const userRow = await getDb()
    .table('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .where('u.id', mfaTokenSub)
    .select(
      'u.id',
      'u.email',
      'u.password_hash',
      'u.first_name',
      'u.last_name',
      'u.role_id',
      'u.is_active',
      'u.must_change_password',
      'u.mfa_enabled',
      'u.mfa_required',
      'r.name as role_name'
    )
    .first();

  if (!userRow) throw new AppError('Invalid MFA session', 401);
  const user = userRow as UserRow;

  const mfa = await getDb()('mfa_codes')
    .where({ user_id: user.id })
    .whereNull('used_at')
    .orderBy('created_at', 'desc')
    .first();

  if (!mfa) throw new AppError('No active MFA code', 401);
  if (new Date(mfa.expires_at).getTime() < Date.now()) {
    throw new AppError('MFA code expired', 401);
  }
  if (mfa.attempts >= 5) throw new AppError('Too many MFA attempts', 429);

  const expected = hashOtp(code);
  if (expected !== mfa.code_hash) {
    await getDb()('mfa_codes').where({ id: mfa.id }).update({ attempts: mfa.attempts + 1 });
    throw new AppError('Invalid MFA code', 401);
  }

  await getDb()('mfa_codes').where({ id: mfa.id }).update({ used_at: getDb().fn.now() });

  const session = await issueAccessSession(user);
  return { token: session.token, user: session.user };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await getDb()('users').where({ id: userId }).first();
  if (!user) throw new AppError('User not found', 404);
  const ok = await argon2.verify(user.password_hash, currentPassword);
  if (!ok) throw new AppError('Current password is incorrect', 401);
  assertPasswordPolicy(newPassword);
  if (currentPassword === newPassword) {
    throw new AppError('Le nouveau mot de passe doit être différent de l’ancien', 400);
  }
  const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await getDb()('users').where({ id: userId }).update({
    password_hash: hash,
    must_change_password: false,
    updated_at: getDb().fn.now(),
  });
}

/** First-login / forced change using a short-lived CHANGE_PASSWORD token. */
export async function completeForcedPasswordChange(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<
  | { status: 'OK'; token: string; user: JwtPayload }
  | { status: 'REQUIRES_MFA'; mfaToken: string; email: string }
> {
  await changePassword(userId, currentPassword, newPassword);
  const row = await getDb()
    .table('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .where('u.id', userId)
    .select(
      'u.id',
      'u.email',
      'u.password_hash',
      'u.first_name',
      'u.last_name',
      'u.role_id',
      'u.is_active',
      'u.must_change_password',
      'u.mfa_enabled',
      'u.mfa_required',
      'r.name as role_name'
    )
    .first();
  if (!row || !(row as UserRow).is_active) throw new AppError('User not found', 404);
  const user = row as UserRow;
  if (needsMfa(user)) return issueMfaChallenge(user);
  return issueAccessSession(user);
}

export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const user = await findUserByEmail(email);
  // Anti-enumeration: always succeed
  if (!user || !user.is_active) return { ok: true };

  const code = generateOtpCode();
  const tokenHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  await getDb()('password_reset_tokens').where({ user_id: user.id, used_at: null }).update({
    used_at: getDb().fn.now(),
  });

  await getDb()('password_reset_tokens').insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  try {
    await notify('/internal/emails/password-reset', {
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      code,
    });
  } catch (err) {
    console.warn('[auth] Reset email failed');
    console.warn(err instanceof Error ? err.message : err);
    logDevSecret(`Password reset code for ${user.email}`, code);
  }

  logDevSecret(`Password reset code for ${user.email}`, code);
  return { ok: true };
}

export async function verifyPasswordResetCode(
  email: string,
  code: string
): Promise<{ resetToken: string }> {
  const user = await findUserByEmail(email);
  if (!user || !user.is_active) {
    throw new AppError('Code invalide ou expiré', 400);
  }

  const row = await getDb()('password_reset_tokens')
    .where({ user_id: user.id })
    .whereNull('used_at')
    .orderBy('created_at', 'desc')
    .first();

  if (!row) throw new AppError('Code invalide ou expiré', 400);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new AppError('Code expiré', 400);
  }

  const expected = hashOtp(code);
  if (expected !== row.token_hash) {
    throw new AppError('Code invalide ou expiré', 400);
  }

  // Keep token valid until password is set; issue short-lived session
  const resetToken = signToken(
    {
      sub: user.id,
      email: user.email,
      role: user.role_name,
      permissions: [],
      firstName: user.first_name,
      lastName: user.last_name,
      purpose: 'PASSWORD_RESET',
    },
    '15m'
  );

  return { resetToken };
}

export async function resetPasswordWithSession(
  userId: string,
  newPassword: string
): Promise<{ ok: true }> {
  assertPasswordPolicy(newPassword);
  const hash = await argon2.hash(newPassword, { type: argon2.argon2id });

  await getDb().transaction(async (trx) => {
    const n = await trx('users').where({ id: userId, is_active: true }).update({
      password_hash: hash,
      must_change_password: false,
      updated_at: trx.fn.now(),
    });
    if (!n) throw new AppError('Utilisateur introuvable', 404);

    await trx('password_reset_tokens')
      .where({ user_id: userId })
      .whereNull('used_at')
      .update({ used_at: trx.fn.now() });
  });

  return { ok: true };
}

export async function listUsers() {
  return getDb()
    .table('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .select(
      'u.id',
      'u.email',
      'u.first_name',
      'u.last_name',
      'u.is_active',
      'u.mfa_required',
      'u.must_change_password',
      'u.created_at',
      'r.name as role'
    )
    .orderBy('u.created_at', 'desc');
}

export async function createUser(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
}): Promise<{ id: string }> {
  const role = await getDb()('roles').where({ name: input.role.toUpperCase() }).first();
  if (!role) throw new AppError('Invalid role', 400);
  const existing = await findUserByEmail(input.email);
  if (existing) throw new AppError('Email already in use', 409);

  assertPasswordPolicy(input.password);
  const password_hash = await argon2.hash(input.password, { type: argon2.argon2id });
  const roleName = role.name as string;
  const mfaRequired = roleName === 'ADMIN' || roleName === 'DIRECTION';
  const [row] = await getDb()('users')
    .insert({
      email: input.email.toLowerCase(),
      password_hash,
      first_name: input.firstName,
      last_name: input.lastName,
      role_id: role.id,
      mfa_enabled: mfaRequired,
      mfa_required: mfaRequired,
      must_change_password: true,
    })
    .returning(['id']);

  const notifUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:3003';
  const serviceToken = process.env.SERVICE_TOKEN || 'centaur-internal-service-token-dev';
  try {
    await axios.post(
      `${notifUrl}/internal/emails/welcome`,
      {
        userId: row.id,
        email: input.email,
        firstName: input.firstName,
        tempPassword: input.password,
      },
      { headers: { 'x-service-token': serviceToken }, timeout: 5000 }
    );
  } catch {
    console.warn('[auth] Welcome email failed');
  }

  return { id: row.id };
}

export async function updateUser(
  id: string,
  input: Partial<{
    firstName: string;
    lastName: string;
    isActive: boolean;
    role: string;
  }>
): Promise<void> {
  const updates: Record<string, unknown> = { updated_at: getDb().fn.now() };
  if (input.firstName !== undefined) updates.first_name = input.firstName;
  if (input.lastName !== undefined) updates.last_name = input.lastName;
  if (input.isActive !== undefined) updates.is_active = input.isActive;
  if (input.role !== undefined) {
    const role = await getDb()('roles').where({ name: input.role.toUpperCase() }).first();
    if (!role) throw new AppError('Invalid role', 400);
    updates.role_id = role.id;
    const roleName = role.name as string;
    updates.mfa_required = roleName === 'ADMIN' || roleName === 'DIRECTION';
    updates.mfa_enabled = updates.mfa_required;
  }
  const n = await getDb()('users').where({ id }).update(updates);
  if (!n) throw new AppError('User not found', 404);
}

export async function deleteUser(id: string): Promise<void> {
  const n = await getDb()('users').where({ id }).del();
  if (!n) throw new AppError('User not found', 404);
}

export async function me(userId: string) {
  const user = await getDb()
    .table('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .where('u.id', userId)
    .select(
      'u.id',
      'u.email',
      'u.first_name',
      'u.last_name',
      'u.is_active',
      'u.mfa_required',
      'r.name as role'
    )
    .first();
  if (!user) throw new AppError('User not found', 404);
  const permissions = await getUserPermissions(user.role as RoleName);
  return { ...user, permissions };
}

const SYSTEM_ROLES = new Set(['ADMIN', 'DIRECTION', 'MEDECIN', 'SECRETAIRE']);

export async function listPermissions() {
  return getDb()('permissions').select('id', 'code', 'description').orderBy('code', 'asc');
}

export async function listRoles() {
  const roles = await getDb()('roles').select('id', 'name', 'created_at').orderBy('name', 'asc');
  const links = await getDb()
    .table('role_permissions as rp')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .select('rp.role_id', 'p.code');

  const byRole = new Map<string, string[]>();
  for (const row of links as Array<{ role_id: string; code: string }>) {
    const list = byRole.get(row.role_id) || [];
    list.push(row.code);
    byRole.set(row.role_id, list);
  }

  const counts = await getDb()('users')
    .select('role_id')
    .count('* as count')
    .groupBy('role_id');
  const countMap = new Map(
    (counts as Array<{ role_id: string; count: string }>).map((c) => [c.role_id, Number(c.count)])
  );

  return roles.map((r: { id: string; name: string; created_at: string }) => ({
    id: r.id,
    name: r.name,
    created_at: r.created_at,
    is_system: SYSTEM_ROLES.has(r.name),
    user_count: countMap.get(r.id) || 0,
    permissions: (byRole.get(r.id) || []).sort(),
  }));
}

export async function createRole(input: {
  name: string;
  permissions: string[];
}): Promise<{ id: string }> {
  const name = input.name.trim().toUpperCase().replace(/\s+/g, '_');
  if (!name || name.length < 2) throw new AppError('Invalid role name', 400);
  if (SYSTEM_ROLES.has(name)) throw new AppError('Cannot recreate a system role', 409);

  const existing = await getDb()('roles').where({ name }).first();
  if (existing) throw new AppError('Role already exists', 409);

  const [role] = await getDb()('roles').insert({ name }).returning(['id']);
  await setRolePermissions(role.id, input.permissions);
  return { id: role.id };
}

export async function updateRolePermissions(roleId: string, permissionCodes: string[]): Promise<void> {
  const role = await getDb()('roles').where({ id: roleId }).first();
  if (!role) throw new AppError('Role not found', 404);
  await setRolePermissions(roleId, permissionCodes);
}

async function setRolePermissions(roleId: string, permissionCodes: string[]): Promise<void> {
  const unique = [...new Set(permissionCodes)];
  const perms = await getDb()('permissions').whereIn('code', unique).select('id', 'code');
  if (perms.length !== unique.length) {
    throw new AppError('One or more permissions are invalid', 400);
  }

  await getDb().transaction(async (trx) => {
    await trx('role_permissions').where({ role_id: roleId }).del();
    if (perms.length) {
      await trx('role_permissions').insert(
        perms.map((p: { id: string }) => ({ role_id: roleId, permission_id: p.id }))
      );
    }
  });
}

export async function deleteRole(roleId: string): Promise<void> {
  const role = await getDb()('roles').where({ id: roleId }).first();
  if (!role) throw new AppError('Role not found', 404);
  if (SYSTEM_ROLES.has(role.name)) {
    throw new AppError('System roles cannot be deleted', 400);
  }
  const users = await getDb()('users').where({ role_id: roleId }).count<{ count: string }>('* as count').first();
  if (Number(users?.count || 0) > 0) {
    throw new AppError('Role is assigned to users', 409);
  }
  await getDb()('roles').where({ id: roleId }).del();
}

// ensure db module is available
createDb();
