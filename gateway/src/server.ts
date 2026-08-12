import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import restana from 'restana';
import { z } from 'zod';
import {
  AppError,
  type JwtPayload,
  type Permission,
  getClientIp,
  reply,
  createRateLimiter,
} from '@centaur/shared';
import { requireAuth } from './auth-guard';
import { AUTH_URL, PATIENT_URL, hasPermission, proxy } from './proxy';

const service = restana({
  errorHandler: (err, _req, res) => {
    console.error(err);
    reply(res, 500, { error: 'Gateway error' });
  },
});

// Global + auth-sensitive rate limits (in-memory; use Redis in production)
const globalLimiter = createRateLimiter({ limit: 200, windowMs: 60_000 });
const authLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

const AUTH_SENSITIVE = new Set([
  '/api/auth/login',
  '/api/auth/password/forgot',
  '/api/auth/password/verify-reset-code',
  '/api/auth/password/reset',
  '/api/auth/mfa/verify',
]);

function applySecurityHeaders(res: {
  setHeader: (k: string, v: string) => void;
}): void {
  // Helmet-equivalent baselines for Restana (helmet is Express-oriented)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function getCorsOrigin(): string {
  const raw = process.env.CORS_ORIGIN;
  if (process.env.NODE_ENV === 'production') {
    if (!raw || raw === '*') {
      throw new Error(
        'CORS_ORIGIN must be set to an explicit origin in production (e.g. https://app.centaur-medical.com). Refusing to start with wildcard CORS.'
      );
    }
  }
  return raw || '*';
}

// Validate CORS config eagerly at boot time so misconfiguration fails fast.
const CORS_ORIGIN = getCorsOrigin();

service.use(async (req, res, next) => {
  const origin = CORS_ORIGIN;
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

  applySecurityHeaders(res);

  const ip = getClientIp(req);
  const pathName = (req as { url?: string }).url?.split('?')[0] || '';

  if (!globalLimiter.allow(ip)) {
    reply(res, 429, { error: 'Trop de requêtes' });
    return;
  }
  if (AUTH_SENSITIVE.has(pathName) && !authLimiter.allow(`auth:${ip}`)) {
    reply(res, 429, { error: 'Trop de tentatives d’authentification' });
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

service.get('/api/health', async (_req, res) => {
  reply(res, 200, { status: 'ok', service: 'gateway' });
});

// Public auth routes
service.post('/api/auth/login', async (req, res) => {
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

service.post('/api/auth/mfa/verify', async (req, res) => {
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

service.post('/api/auth/password/change', async (req, res) => {
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

service.post('/api/auth/password/change-required', async (req, res) => {
  try {
    const body = z
      .object({
        tempToken: z.string().min(1),
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8),
      })
      .parse((req as { body?: unknown }).body || {});
    const result = await proxy(AUTH_URL, 'POST', '/auth/password/change-required', { body });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.post('/api/auth/password/forgot', async (req, res) => {
  try {
    const body = z
      .object({ email: z.string().email() })
      .parse((req as { body?: unknown }).body || {});
    const result = await proxy(AUTH_URL, 'POST', '/auth/password/forgot', { body });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.post('/api/auth/password/verify-reset-code', async (req, res) => {
  try {
    const body = z
      .object({
        email: z.string().email(),
        code: z.string().length(6),
      })
      .parse((req as { body?: unknown }).body || {});
    const result = await proxy(AUTH_URL, 'POST', '/auth/password/verify-reset-code', { body });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.post('/api/auth/password/reset', async (req, res) => {
  try {
    const body = z
      .object({
        resetToken: z.string().min(1),
        newPassword: z.string().min(8),
      })
      .parse((req as { body?: unknown }).body || {});
    const result = await proxy(AUTH_URL, 'POST', '/auth/password/reset', { body });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.get('/api/auth/me', async (req, res) => {
  try {
    const user = requireAuth(req);
    const result = await proxy(AUTH_URL, 'GET', '/auth/me', { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

// Users
service.get('/api/users', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'users:read');
    const result = await proxy(AUTH_URL, 'GET', '/users', { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.post('/api/users', async (req, res) => {
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

service.patch('/api/users/:id', async (req, res) => {
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

service.delete('/api/users/:id', async (req, res) => {
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

// Roles & permissions
service.get('/api/roles', async (req, res) => {
  try {
    const user = requireAuth(req);
    if (!hasPermission(user, 'roles:manage') && !hasPermission(user, 'users:read')) {
      throw new AppError('Forbidden: users:read or roles:manage', 403);
    }
    const result = await proxy(AUTH_URL, 'GET', '/roles', { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.get('/api/permissions', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'roles:manage');
    const result = await proxy(AUTH_URL, 'GET', '/permissions', { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.post('/api/roles', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'roles:manage');
    const result = await proxy(AUTH_URL, 'POST', '/roles', {
      user,
      body: (req as { body?: unknown }).body,
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.put('/api/roles/:id/permissions', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'roles:manage');
    const id = (req as { params: { id: string } }).params.id;
    const result = await proxy(AUTH_URL, 'PUT', `/roles/${id}/permissions`, {
      user,
      body: (req as { body?: unknown }).body,
    });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.delete('/api/roles/:id', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'roles:manage');
    const id = (req as { params: { id: string } }).params.id;
    const result = await proxy(AUTH_URL, 'DELETE', `/roles/${id}`, { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

// Patients
service.get('/api/patients', async (req, res) => {
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

service.get('/api/patients/:id', async (req, res) => {
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

service.post('/api/patients', async (req, res) => {
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

service.put('/api/patients/:id', async (req, res) => {
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

service.delete('/api/patients/:id', async (req, res) => {
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

service.get('/api/dashboard/stats', async (req, res) => {
  try {
    const user = requireAuth(req);
    requirePerm(user, 'patients:read');
    const result = await proxy(PATIENT_URL, 'GET', '/dashboard/stats', { user });
    reply(res, result.status, result.data);
  } catch (err) {
    handleError(res, err);
  }
});

service.get('/api/audit-logs', async (req, res) => {
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

service.start(port).then(() => {
  console.log(`[gateway] listening on ${port}`);
});
