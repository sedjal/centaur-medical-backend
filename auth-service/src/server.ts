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
  assertAnyPermission,
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
    requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
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
    requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
    const body = z
      .object({ mfaToken: z.string().min(1), code: z.string().length(6) })
      .parse(parseBody(req));
    const payload = verifyToken(body.mfaToken);
    if (payload.purpose !== 'MFA') {
      reply(res, 401, { error: 'Invalid MFA token' });
      return;
    }
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

service.post('/auth/password/change-required', async (req, res) => {
  try {
    requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
    const body = z
      .object({
        tempToken: z.string().min(1),
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8),
      })
      .parse(parseBody(req));
    const payload = verifyToken(body.tempToken);
    if (payload.purpose !== 'CHANGE_PASSWORD') {
      reply(res, 401, { error: 'Invalid password-change token' });
      return;
    }
    const result = await authService.completeForcedPasswordChange(
      payload.sub,
      body.currentPassword,
      body.newPassword
    );
    reply(res, 200, result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/auth/password/forgot', async (req, res) => {
  try {
    requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
    const body = z.object({ email: z.string().email() }).parse(parseBody(req));
    reply(res, 200, await authService.requestPasswordReset(body.email));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/auth/password/verify-reset-code', async (req, res) => {
  try {
    requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
    const body = z
      .object({
        email: z.string().email(),
        code: z.string().length(6),
      })
      .parse(parseBody(req));
    reply(res, 200, await authService.verifyPasswordResetCode(body.email, body.code));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/auth/password/reset', async (req, res) => {
  try {
    requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
    const body = z
      .object({
        resetToken: z.string().min(1),
        newPassword: z.string().min(8),
      })
      .parse(parseBody(req));
    const payload = verifyToken(body.resetToken);
    if (payload.purpose !== 'PASSWORD_RESET') {
      reply(res, 401, { error: 'Session de réinitialisation invalide' });
      return;
    }
    reply(res, 200, await authService.resetPasswordWithSession(payload.sub, body.newPassword));
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
        role: z.string().min(2),
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
    const id = (req as unknown as { params: { id: string } }).params.id;
    const body = z
      .object({
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
        role: z.string().min(2).optional(),
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
    const id = (req as unknown as { params: { id: string } }).params.id;
    await authService.deleteUser(id, user.id);
    reply(res, 200, { ok: true });
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/roles', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertAnyPermission(user, ['roles:manage', 'users:read']);
    reply(res, 200, await authService.listRoles());
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/permissions', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'roles:manage');
    reply(res, 200, await authService.listPermissions());
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/roles', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'roles:manage');
    const body = z
      .object({
        name: z.string().min(2),
        permissions: z.array(z.string()).default([]),
      })
      .parse(parseBody(req));
    reply(res, 201, await authService.createRole(body));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.put('/roles/:id/permissions', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'roles:manage');
    const id = (req as unknown as { params: { id: string } }).params.id;
    const body = z
      .object({
        permissions: z.array(z.string()),
      })
      .parse(parseBody(req));
    await authService.updateRolePermissions(id, body.permissions);
    reply(res, 200, { ok: true });
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.delete('/roles/:id', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'roles:manage');
    const id = (req as unknown as { params: { id: string } }).params.id;
    await authService.deleteRole(id);
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
