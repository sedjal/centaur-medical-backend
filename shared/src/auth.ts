import jwt from 'jsonwebtoken';
import type { JwtPayload } from './types';

export function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'centaur-medical-jwt-dev-secret-key-32chars';
}

export function getServiceToken(): string {
  return process.env.SERVICE_TOKEN || 'centaur-internal-service-token-dev';
}

export function signToken(payload: JwtPayload, expiresIn?: string): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, {
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '8h',
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  return decoded as JwtPayload;
}

export function isValidServiceToken(headerValue: string | undefined | null): boolean {
  if (!headerValue) return false;
  return headerValue === getServiceToken();
}

export const INTERNAL_HEADERS = {
  SERVICE_TOKEN: 'x-service-token',
  USER_ID: 'x-user-id',
  USER_EMAIL: 'x-user-email',
  USER_ROLE: 'x-user-role',
  USER_PERMISSIONS: 'x-user-permissions',
  USER_FIRST_NAME: 'x-user-first-name',
  USER_LAST_NAME: 'x-user-last-name',
} as const;
