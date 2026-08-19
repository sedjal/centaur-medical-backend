import http from 'http';
import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
import axios, { type AxiosRequestConfig, type Method } from 'axios';
import {
  getServiceToken,
  INTERNAL_HEADERS,
  type JwtPayload,
  type Permission,
} from '@centaur/shared';
import { MAX_MULTIPART_BYTES } from './request-body';

const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:3001';
const PATIENT_URL = process.env.PATIENT_SERVICE_URL || 'http://127.0.0.1:3002';
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:3003';

export function buildIdentityHeaders(
  user?: JwtPayload,
  contentType: string | null = 'application/json'
): Record<string, string> {
  const headers: Record<string, string> = {
    [INTERNAL_HEADERS.SERVICE_TOKEN]: getServiceToken(),
  };
  if (contentType) {
    headers['content-type'] = contentType;
  }
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

export async function proxyMultipart(
  baseUrl: string,
  path: string,
  options: {
    user?: JwtPayload;
    body: Buffer;
    contentType: string;
    ip?: string;
  }
) {
  const url = new URL(path, baseUrl);
  const response = await axios.request({
    method: 'POST',
    url: url.toString(),
    headers: {
      ...buildIdentityHeaders(options.user, options.contentType),
      ...(options.ip ? { 'x-forwarded-for': options.ip } : {}),
    },
    data: options.body,
    maxBodyLength: MAX_MULTIPART_BYTES,
    maxContentLength: MAX_MULTIPART_BYTES,
    validateStatus: () => true,
    timeout: 30000,
    responseType: 'json',
    transformRequest: [(data) => data],
  });
  return { status: response.status, data: response.data };
}

function clientFor(url: URL) {
  return url.protocol === 'https:' ? https : http;
}

function sanitizeDisposition(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(value);
  const raw = match?.[1] ? decodeURIComponent(match[1]) : 'document';
  const ascii = raw.replace(/[\r\n"\\]/g, '_').replace(/[^\w.\- ()]/g, '_').slice(0, 180) || 'document';
  return `attachment; filename="${ascii}"`;
}

export function proxyBinary(options: {
  targetBase: string;
  path: string;
  user: JwtPayload;
  incoming: IncomingMessage;
  outgoing: ServerResponse;
}): http.ClientRequest {
  const url = new URL(options.path, options.targetBase);
  const lib = clientFor(url);
  const upReq = lib.request(
    url,
    {
      method: 'GET',
      headers: {
        ...buildIdentityHeaders(options.user, null),
        accept: '*/*',
      },
      timeout: 30000,
    },
    (upRes) => {
      const status = upRes.statusCode || 502;
      const headers: Record<string, string | number | string[] | undefined> = {
        'content-type': upRes.headers['content-type'] || 'application/octet-stream',
        'content-length': upRes.headers['content-length'],
        'x-content-type-options': 'nosniff',
        'access-control-expose-headers': 'Content-Disposition',
      };
      const disposition = sanitizeDisposition(
        Array.isArray(upRes.headers['content-disposition'])
          ? upRes.headers['content-disposition'][0]
          : upRes.headers['content-disposition']
      );
      if (disposition) headers['content-disposition'] = disposition;
      if (!options.outgoing.headersSent) {
        options.outgoing.writeHead(status, headers);
      }
      upRes.pipe(options.outgoing);
    }
  );

  upReq.on('error', () => {
    if (!options.outgoing.headersSent) {
      options.outgoing.statusCode = 502;
      options.outgoing.setHeader('Content-Type', 'application/json; charset=utf-8');
      options.outgoing.end(JSON.stringify({ error: 'Binary proxy failed' }));
      return;
    }
    options.outgoing.end();
  });

  options.incoming.on('close', () => {
    upReq.destroy();
  });
  options.outgoing.on('close', () => {
    upReq.destroy();
  });

  upReq.end();
  return upReq;
}

export function hasPermission(user: JwtPayload, permission: Permission): boolean {
  return (user.permissions || []).includes(permission);
}

export { AUTH_URL, PATIENT_URL, NOTIFICATION_URL };
