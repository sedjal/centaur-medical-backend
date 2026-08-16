import jwt from 'jsonwebtoken';
import type { JwtPayload } from './types';
import { timingSafeEqualStr } from './security';

const DEV_JWT_FALLBACK = 'centaur-medical-jwt-dev-secret-key-32chars';
const DEV_SERVICE_FALLBACK = 'centaur-internal-service-token-dev';

function assertSecretOrDev(name: string, value: string | undefined, fallback: string): string {
  if (value && value.length >= 32 && !value.startsWith('change-me')) {
    return value;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set to a strong secret in production (>= 32 chars)`);
  }
  if (!value || value.startsWith('change-me')) {
    console.warn(`[security] Using DEV fallback for ${name}. Set it in .env before production.`);
  }
  return value && value.length >= 16 ? value : fallback;
}

export function getJwtSecret(): string {
  return assertSecretOrDev('JWT_SECRET', process.env.JWT_SECRET, DEV_JWT_FALLBACK);
}

export function getServiceToken(): string {
  return assertSecretOrDev('SERVICE_TOKEN', process.env.SERVICE_TOKEN, DEV_SERVICE_FALLBACK);
}

export function signToken(payload: JwtPayload, expiresIn?: string): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, {
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '15m',
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  return decoded as JwtPayload;
}

export function isValidServiceToken(headerValue: string | undefined | null): boolean {
  if (!headerValue) return false;
  return timingSafeEqualStr(headerValue, getServiceToken());
}

export const INTERNAL_HEADERS = {
  SERVICE_TOKEN: 'x-service-token',
  USER_ID: 'x-user-id',
  USER_EMAIL: 'x-user-email',
  USER_ROLE: 'x-user-role',
  USER_PERMISSIONS: 'x-user-permissions',
  USER_FIRST_NAME: 'x-user-first-name',
  USER_LAST_NAME: 'x-user-last-name',
  SESSION_VER: 'x-session-ver',
} as const;
