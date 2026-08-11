import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import restana from 'restana';
import { z } from 'zod';
import {
  createDb,
  parseBody,
  readInternalUser,
  assertPermission,
  verifyToken,
  requireServiceToken,
  reply,
  handleRouteError,
} from '@centaur/shared';
import * as authService from './auth.service';

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
      (req as { body?: unknown }).body = {};
    }
  }
  next();
});

service.get('/health', async (_req, res) => {
  reply(res, 200, { status: 'ok', service: 'auth' });
});

service.post('/auth/login', async (req, res) => {
  try {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(parseBody(req));
    const result = await authService.login(body.email, body.password);
    reply(res, 200, result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/auth/mfa/verify', async (req, res) => {
  try {
    const body = z
      .object({ mfaToken: z.string().min(1), code: z.string().length(6) })
      .parse(parseBody(req));
    const payload = verifyToken(body.mfaToken);
    const result = await authService.verifyMfa(payload.sub, body.code);
    reply(res, 200, result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/auth/password/change', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    const body = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
      .parse(parseBody(req));
    await authService.changePassword(user.id, body.currentPassword, body.newPassword);
    reply(res, 200, { ok: true });
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/auth/me', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    const me = await authService.me(user.id);
    reply(res, 200, me);
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/users', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'users:read');
    reply(res, 200, await authService.listUsers());
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/users', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'users:create');
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        role: z.enum(['ADMIN', 'DIRECTION', 'MEDECIN', 'SECRETAIRE']),
      })
      .parse(parseBody(req));
    reply(res, 201, await authService.createUser(body));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.patch('/users/:id', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'users:update');
    const id = (req as { params: { id: string } }).params.id;
    const body = z
      .object({
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
        role: z.enum(['ADMIN', 'DIRECTION', 'MEDECIN', 'SECRETAIRE']).optional(),
      })
      .parse(parseBody(req));
    await authService.updateUser(id, body);
    reply(res, 200, { ok: true });
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.delete('/users/:id', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'users:delete');
    const id = (req as { params: { id: string } }).params.id;
    await authService.deleteUser(id);
    reply(res, 200, { ok: true });
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/internal/ping', async (req, res) => {
  try {
    requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
    reply(res, 200, { ok: true });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const port = Number(process.env.AUTH_PORT || 3001);
createDb();
service.start(port).then(() => {
  console.log(`[auth-service] listening on ${port}`);
});
