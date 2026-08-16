import axios, { type AxiosRequestConfig, type Method } from 'axios';
import {
  getServiceToken,
  INTERNAL_HEADERS,
  type JwtPayload,
  type Permission,
} from '@centaur/shared';

const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:3001';
const PATIENT_URL = process.env.PATIENT_SERVICE_URL || 'http://127.0.0.1:3002';
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:3003';

export function buildIdentityHeaders(user?: JwtPayload): Record<string, string> {
  const headers: Record<string, string> = {
    [INTERNAL_HEADERS.SERVICE_TOKEN]: getServiceToken(),
    'content-type': 'application/json',
  };
  if (user) {
    headers[INTERNAL_HEADERS.USER_ID] = user.sub;
    headers[INTERNAL_HEADERS.USER_EMAIL] = user.email;
    headers[INTERNAL_HEADERS.USER_ROLE] = user.role;
    headers[INTERNAL_HEADERS.USER_PERMISSIONS] = JSON.stringify(user.permissions || []);
    headers[INTERNAL_HEADERS.USER_FIRST_NAME] = user.firstName || '';
    headers[INTERNAL_HEADERS.USER_LAST_NAME] = user.lastName || '';
    headers[INTERNAL_HEADERS.SESSION_VER] = String(Number(user.sv) || 0);
  }
  return headers;
}

export async function proxy(
  baseUrl: string,
  method: Method,
  path: string,
  options: {
    user?: JwtPayload;
    body?: unknown;
    query?: Record<string, string | undefined>;
    ip?: string;
  } = {}
) {
  const url = new URL(path, baseUrl);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }

  const config: AxiosRequestConfig = {
    method,
    url: url.toString(),
    headers: {
      ...buildIdentityHeaders(options.user),
      ...(options.ip ? { 'x-forwarded-for': options.ip } : {}),
    },
    data: options.body,
    validateStatus: () => true,
    timeout: 15000,
  };

  const response = await axios.request(config);
  return { status: response.status, data: response.data };
}

export function hasPermission(user: JwtPayload, permission: Permission): boolean {
  return (user.permissions || []).includes(permission);
}

export { AUTH_URL, PATIENT_URL, NOTIFICATION_URL };
