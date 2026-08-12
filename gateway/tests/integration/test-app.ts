/**
 * Mini gateway HTTP pour tests d’intégration.
 * Utilise le VRAI requireAuth (purpose ACCESS) + permissions,
 * et un proxy injectable (sinon stub).
 */
import http from 'http';
import restana from 'restana';
import { z } from 'zod';
import {
  AppError,
  type JwtPayload,
  type Permission,
  reply,
} from '@centaur/shared';
import { requireAuth } from '../../src/auth-guard';
import { hasPermission } from '../../src/proxy';

export type ProxyFn = (
  baseUrl: string,
  method: string,
  path: string,
  options?: { user?: JwtPayload; body?: unknown }
) => Promise<{ status: number; data: unknown }>;

function requirePerm(user: JwtPayload, perm: Permission): void {
  if (!hasPermission(user, perm)) throw new AppError(`Forbidden: ${perm}`, 403);
}

function handleError(
  res: { statusCode?: number; setHeader: (k: string, v: string) => void; end: (c?: string) => void },
  err: unknown
): void {
  if (err instanceof AppError) {
    reply(res, err.statusCode, { error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    reply(res, 400, { error: 'Validation failed' });
    return;
  }
  reply(res, 500, { error: 'Internal gateway error' });
}

export function createTestGateway(proxyFn: ProxyFn) {
  const service = restana();

  service.use(async (req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const chunks: Buffer[] = [];
      for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        (req as { body?: unknown }).body = raw ? JSON.parse(raw) : {};
      } catch {
        reply(res, 400, { error: 'Invalid JSON' });
        return;
      }
    }
    next();
  });

  service.post('/api/auth/login', async (req, res) => {
    try {
      const body = z
        .object({ email: z.string().email(), password: z.string().min(1) })
        .parse((req as { body?: unknown }).body || {});
      const result = await proxyFn('auth', 'POST', '/auth/login', { body });
      reply(res, result.status, result.data);
    } catch (err) {
      handleError(res, err);
    }
  });

  service.get('/api/auth/me', async (req, res) => {
    try {
      const user = requireAuth(req);
      const result = await proxyFn('auth', 'GET', '/auth/me', { user });
      reply(res, result.status, result.data);
    } catch (err) {
      handleError(res, err);
    }
  });

  service.get('/api/patients', async (req, res) => {
    try {
      const user = requireAuth(req);
      requirePerm(user, 'patients:read');
      const result = await proxyFn('patient', 'GET', '/patients', { user });
      reply(res, result.status, result.data);
    } catch (err) {
      handleError(res, err);
    }
  });

  return service;
}

export async function listen(app: ReturnType<typeof createTestGateway>): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = await app.start(0);
  const address = (server as http.Server).address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    close: async () => {
      await app.close();
    },
  };
}

export async function httpJson(
  port: number,
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {}
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
