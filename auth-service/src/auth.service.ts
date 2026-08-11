import crypto from 'crypto';
import * as argon2 from 'argon2';
import axios from 'axios';
import {
  AppError,
  ROLE_PERMISSIONS,
  createDb,
  getDb,
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

function hashOtp(code: string): string {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'otp-secret').update(code).digest('hex');
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
  if (rows.length === 0) return ROLE_PERMISSIONS[roleName] || [];
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
      },
      '15m'
    );
    return { status: 'CHANGE_PASSWORD', tempToken };
  }

  const needsMfa =
    user.mfa_required ||
    user.role_name === 'ADMIN' ||
    user.role_name === 'DIRECTION';

  if (needsMfa) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
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

    const notifUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:3003';
    const serviceToken = process.env.SERVICE_TOKEN || 'centaur-internal-service-token-dev';
    try {
      await axios.post(
        `${notifUrl}/internal/emails/mfa`,
        {
          userId: user.id,
          email: user.email,
          code,
          firstName: user.first_name,
        },
        { headers: { 'x-service-token': serviceToken }, timeout: 5000 }
      );
    } catch (err) {
      console.warn('[auth] MFA email failed, code logged for dev:', code);
      console.warn(err instanceof Error ? err.message : err);
    }

    console.log(`[auth] MFA code for ${user.email}: ${code}`);

    const mfaToken = signToken(
      {
        sub: user.id,
        email: user.email,
        role: user.role_name,
        permissions: [],
        firstName: user.first_name,
        lastName: user.last_name,
      },
      '10m'
    );
    return { status: 'REQUIRES_MFA', mfaToken, email: user.email };
  }

  const permissions = await getUserPermissions(user.role_name);
  const payload = buildJwtPayload(user, permissions);
  const token = signToken(payload);
  return { status: 'OK', token, user: payload };
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

  const permissions = await getUserPermissions(user.role_name);
  const payload = buildJwtPayload(user, permissions);
  return { token: signToken(payload), user: payload };
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
  if (newPassword.length < 8) throw new AppError('Password must be at least 8 characters', 400);
  const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await getDb()('users').where({ id: userId }).update({
    password_hash: hash,
    must_change_password: false,
    updated_at: getDb().fn.now(),
  });
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
  role: RoleName;
}): Promise<{ id: string }> {
  const role = await getDb()('roles').where({ name: input.role }).first();
  if (!role) throw new AppError('Invalid role', 400);
  const existing = await findUserByEmail(input.email);
  if (existing) throw new AppError('Email already in use', 409);

  const password_hash = await argon2.hash(input.password, { type: argon2.argon2id });
  const mfaRequired = input.role === 'ADMIN' || input.role === 'DIRECTION';
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
    role: RoleName;
  }>
): Promise<void> {
  const updates: Record<string, unknown> = { updated_at: getDb().fn.now() };
  if (input.firstName !== undefined) updates.first_name = input.firstName;
  if (input.lastName !== undefined) updates.last_name = input.lastName;
  if (input.isActive !== undefined) updates.is_active = input.isActive;
  if (input.role !== undefined) {
    const role = await getDb()('roles').where({ name: input.role }).first();
    if (!role) throw new AppError('Invalid role', 400);
    updates.role_id = role.id;
    updates.mfa_required = input.role === 'ADMIN' || input.role === 'DIRECTION';
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

// ensure db module is available
createDb();
