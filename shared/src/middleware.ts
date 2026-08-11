import type { InternalUser, Permission, RoleName } from './types';
import { INTERNAL_HEADERS, isValidServiceToken } from './auth';

export type HeaderBag = Record<string, string | string[] | undefined>;

function header(reqHeaders: HeaderBag, name: string): string | undefined {
  const key = Object.keys(reqHeaders).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const val = reqHeaders[key];
  return Array.isArray(val) ? val[0] : val;
}

export function requireServiceToken(reqHeaders: HeaderBag): void {
  const token = header(reqHeaders, INTERNAL_HEADERS.SERVICE_TOKEN);
  if (!isValidServiceToken(token)) {
    const err = new Error('Invalid or missing service token');
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }
}

export function readInternalUser(reqHeaders: HeaderBag): InternalUser {
  requireServiceToken(reqHeaders);
  const id = header(reqHeaders, INTERNAL_HEADERS.USER_ID);
  const email = header(reqHeaders, INTERNAL_HEADERS.USER_EMAIL);
  const role = header(reqHeaders, INTERNAL_HEADERS.USER_ROLE) as RoleName | undefined;
  const permissionsRaw = header(reqHeaders, INTERNAL_HEADERS.USER_PERMISSIONS) || '[]';
  const firstName = header(reqHeaders, INTERNAL_HEADERS.USER_FIRST_NAME) || '';
  const lastName = header(reqHeaders, INTERNAL_HEADERS.USER_LAST_NAME) || '';

  if (!id || !email || !role) {
    const err = new Error('Missing internal user identity headers');
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }

  let permissions: Permission[] = [];
  try {
    permissions = JSON.parse(permissionsRaw) as Permission[];
  } catch {
    permissions = [];
  }

  return { id, email, role, permissions, firstName, lastName };
}

export function hasPermission(
  user: Pick<InternalUser, 'permissions'> | { permissions: Permission[] },
  permission: Permission
): boolean {
  return user.permissions.includes(permission);
}

export function assertPermission(
  user: Pick<InternalUser, 'permissions'> | { permissions: Permission[] },
  permission: Permission
): void {
  if (!hasPermission(user, permission)) {
    const err = new Error(`Forbidden: missing permission ${permission}`);
    (err as Error & { statusCode: number }).statusCode = 403;
    throw err;
  }
}

export function assertAnyPermission(
  user: Pick<InternalUser, 'permissions'> | { permissions: Permission[] },
  permissions: Permission[]
): void {
  if (!permissions.some((p) => hasPermission(user, p))) {
    const err = new Error(`Forbidden: missing required permissions`);
    (err as Error & { statusCode: number }).statusCode = 403;
    throw err;
  }
}
