import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import restana from 'restana';
import helmet from 'helmet';
import { z } from 'zod';
import {
  AppError,
  verifyToken,
  type JwtPayload,
  type Permission,
  getClientIp,
  reply,
} from '@centaur/shared';
import { AUTH_URL, PATIENT_URL, hasPermission, proxy } from './proxy';

const service = restana({
  errorHandler: (err, req, res) => {
    console.error(err);
    reply(res, 500, { error: 'Gateway error' });
  },
});

// Simple rate limit (in-memory)
const hits = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 200;
const RATE_WINDOW_MS = 60_000;

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}

service.use(async (req, res, next) => {
  // CORS
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Helmet-like headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');

  const ip = getClientIp(req);
  if (!rateLimit(ip)) {
    reply(res, 429, { error: 'Too many requests' });
    return;
  }

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const chunks: Buffer[] = [];
    for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    try {
      (req as { body?: unknown }).body = raw ? JSON.parse(raw) : {};
    } catch {
      (req as { body?: unknown }).body = {};
    }
  }
  next();
});

function extractBearer(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const auth = req.headers.authorization || req.headers.Authorization;
  const value = Array.isArray(auth) ? auth[0] : auth;
  if (!value || !value.startsWith('Bearer ')) return null;
  return value.slice(7);
}

function requireAuth(req: { headers: Record<string, string | string[] | undefined> }): JwtPayload {
  const token = extractBearer(req);
  if (!token) throw new AppError('Unauthorized', 401);
  try {
    return verifyToken(token);
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }
}

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
    reply(res, 400, { error: 'Validation failed', details: err.flatten() });
    return;
  }
  console.error(err);
  reply(res, 500, { error: 'Internal gateway error' });
}

service.get('/health', async (_req, res) => {
  reply(res, 200, { status: 'ok', service: 'gateway' });
});

service.get('/api/v1/health', async (_req, res) => {
  reply(res, 200, { status: 'ok', service: 'gateway' });
});

// Public auth routes
service.post('/api/v1/auth/login', async (req, res) => {
  try {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse((req as { body?: unknown }).body || {});
    const result = await proxy(AUTH_URL, 'POST', '/auth/login', {
      body,
      ip: getClientIp(req),
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.post('/api/v1/auth/mfa/verify', async (req, res) => {
  try {
    const body = z
      .object({ mfaToken: z.string(), code: z.string().length(6) })
      .parse((req as { body?: unknown }).body || {});
    const result = await proxy(AUTH_URL, 'POST', '/auth/mfa/verify', { body });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.post('/api/v1/auth/password/change', async (req, res) => {
  try {
    const user = requireAuth(req);
    const result = await proxy(AUTH_URL, 'POST', '/auth/password/change', {
      user,
      body: (req as { body?: unknown }).body,
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.get('/api/v1/auth/me', async (req, res) => {
  try {
    const user = requireAuth(req);
    const result = await proxy(AUTH_URL, 'GET', '/auth/me', { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

// Users
service.get('/api/v1/users', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'users:read');
    const result = await proxy(AUTH_URL, 'GET', '/users', { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.post('/api/v1/users', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'users:create');
    const result = await proxy(AUTH_URL, 'POST', '/users', {
      user,
      body: (req as { body?: unknown }).body,
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.patch('/api/v1/users/:id', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'users:update');
    const id = (req as { params: { id: string } }).params.id;
    const result = await proxy(AUTH_URL, 'PATCH', `/users/${id}`, {
      user,
      body: (req as { body?: unknown }).body,
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.delete('/api/v1/users/:id', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'users:delete');
    const id = (req as { params: { id: string } }).params.id;
    const result = await proxy(AUTH_URL, 'DELETE', `/users/${id}`, { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

// Patients
service.get('/api/v1/patients', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'patients:read');
    const q = (req as { query?: Record<string, string> }).query || {};
    const result = await proxy(PATIENT_URL, 'GET', '/patients', {
      user,
      query: { service: q.service, search: q.search },
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.get('/api/v1/patients/:id', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'patients:read');
    const id = (req as { params: { id: string } }).params.id;
    const result = await proxy(PATIENT_URL, 'GET', `/patients/${id}`, { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.post('/api/v1/patients', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'patients:create');
    const result = await proxy(PATIENT_URL, 'POST', '/patients', {
      user,
      body: (req as { body?: unknown }).body,
      ip: getClientIp(req),
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.put('/api/v1/patients/:id', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'patients:update');
    const id = (req as { params: { id: string } }).params.id;
    const result = await proxy(PATIENT_URL, 'PUT', `/patients/${id}`, {
      user,
      body: (req as { body?: unknown }).body,
      ip: getClientIp(req),
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.delete('/api/v1/patients/:id', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'patients:delete');
    const id = (req as { params: { id: string } }).params.id;
    const result = await proxy(PATIENT_URL, 'DELETE', `/patients/${id}`, {
      user,
      ip: getClientIp(req),
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.get('/api/v1/dashboard/stats', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'patients:read');
    const result = await proxy(PATIENT_URL, 'GET', '/dashboard/stats', { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.get('/api/v1/audit-logs', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'audit:read');
    const result = await proxy(PATIENT_URL, 'GET', '/audit-logs', { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

const port = Number(process.env.GATEWAY_PORT || 3000);
// silence unused helmet if types complain
void helmet;

service.start(port).then(() => {
  console.log(`[gateway] listening on ${port}`);
});
