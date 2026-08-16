import { INTERNAL_HEADERS } from './auth';
import { getDb } from './db';
import { AppError } from './http';
import { readInternalUser, type HeaderBag } from './middleware';
import type { InternalUser } from './types';

function header(reqHeaders: HeaderBag, name: string): string | undefined {
  const key = Object.keys(reqHeaders).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const val = reqHeaders[key];
  return Array.isArray(val) ? val[0] : val;
}

export function claimedSessionVersion(reqHeaders: HeaderBag): number {
  const raw = header(reqHeaders, INTERNAL_HEADERS.SESSION_VER);
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Live session check: user exists, is_active, and JWT/header `sv` matches `users.session_version`.
 * Missing `sv` (legacy 8h tokens) is 0 and cannot match a row defaulting to 1.
 */
export async function assertLiveSession(user: InternalUser, reqHeaders: HeaderBag): Promise<void> {
  const claimed = claimedSessionVersion(reqHeaders);
  if (!Number.isFinite(claimed)) {
    throw new AppError('Unauthorized', 401);
  }

  const row = await getDb()('users').where({ id: user.id }).first();
  if (!row) {
    throw new AppError('Unauthorized', 401);
  }
  if (row.is_active === false) {
    throw new AppError('Unauthorized', 401);
  }

  const live = Number(row.session_version ?? 1);
  if (live !== claimed) {
    throw new AppError('Unauthorized', 401);
  }
}

export async function readInternalUserWithSession(reqHeaders: HeaderBag): Promise<InternalUser> {
  const user = readInternalUser(reqHeaders);
  await assertLiveSession(user, reqHeaders);
  return user;
}
