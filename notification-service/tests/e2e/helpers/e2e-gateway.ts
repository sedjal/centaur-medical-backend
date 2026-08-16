import http from 'http';
import restana from 'restana';
import { z } from 'zod';
import { AppError, getClientIp, reply, type JwtPayload, type Permission } from '@centaur/shared';
import { requireAuth, requireAuthSse } from '../../../../gateway/src/auth-guard';
import { hasPermission, proxy } from '../../../../gateway/src/proxy';
import { proxySse } from '../../../../gateway/src/sse-proxy';

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

export function createE2eGateway(urls: { patient: string; notification: string }) {
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

  service.post('/api/patients', async (req, res) => {
    try {
      const user = requireAuth(req);
      requirePerm(user, 'patients:create');
      const result = await proxy(urls.patient, 'POST', '/patients', {
        user,
        body: (req as { body?: unknown }).body,
        ip: getClientIp(req),
      });
      reply(res, result.status, result.data);
    } catch (err) {
      handleError(res, err);
    }
  });

  service.put('/api/patients/:id', async (req, res) => {
    try {
      const user = requireAuth(req);
      requirePerm(user, 'patients:update');
      const id = (req as unknown as { params: { id: string } }).params.id;
      const result = await proxy(urls.patient, 'PUT', `/patients/${id}`, {
        user,
        body: (req as { body?: unknown }).body,
        ip: getClientIp(req),
      });
      reply(res, result.status, result.data);
    } catch (err) {
      handleError(res, err);
    }
  });

  service.post('/api/prescriptions', async (req, res) => {
    try {
      const user = requireAuth(req);
      requirePerm(user, 'prescriptions:create');
      const result = await proxy(urls.patient, 'POST', '/prescriptions', {
        user,
        body: (req as { body?: unknown }).body,
        ip: getClientIp(req),
      });
      reply(res, result.status, result.data);
    } catch (err) {
      handleError(res, err);
    }
  });

  service.patch('/api/prescriptions/:id/cancel', async (req, res) => {
    try {
      const user = requireAuth(req);
      requirePerm(user, 'prescriptions:cancel');
      const id = (req as unknown as { params: { id: string } }).params.id;
      const result = await proxy(urls.patient, 'PATCH', `/prescriptions/${id}/cancel`, {
        user,
        ip: getClientIp(req),
      });
      reply(res, result.status, result.data);
    } catch (err) {
      handleError(res, err);
    }
  });

  service.get('/api/notifications', async (req, res) => {
    try {
      const user = requireAuth(req);
      requirePerm(user, 'notifications:read');
      const q = (req as { query?: Record<string, string> }).query || {};
      const result = await proxy(urls.notification, 'GET', '/notifications', {
        user,
        query: { read: q.read, status: q.status, type: q.type, patientId: q.patientId },
      });
      reply(res, result.status, result.data);
    } catch (err) {
      handleError(res, err);
    }
  });

  service.get('/api/notifications/stream', async (req, res) => {
    try {
      const user = requireAuthSse(req);
      requirePerm(user, 'notifications:read');
      proxySse({
        targetBase: urls.notification,
        path: '/notifications/stream',
        user,
        incoming: req as unknown as import('http').IncomingMessage,
        outgoing: res as unknown as import('http').ServerResponse,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  service.patch('/api/notifications/:id/read', async (req, res) => {
    try {
      const user = requireAuth(req);
      requirePerm(user, 'notifications:read');
      const id = (req as unknown as { params: { id: string } }).params.id;
      const result = await proxy(urls.notification, 'PATCH', `/notifications/${id}/read`, {
        user,
        ip: getClientIp(req),
      });
      reply(res, result.status, result.data);
    } catch (err) {
      handleError(res, err);
    }
  });

  return service;
}

export async function listenGateway(app: ReturnType<typeof createE2eGateway>) {
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

export async function gwHttp(
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
