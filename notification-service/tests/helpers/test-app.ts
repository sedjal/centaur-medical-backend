/**
 * Mini notification-service HTTP app for integration tests.
 */
import http from 'http';
import restana from 'restana';
import { z } from 'zod';
import {
  parseBody,
  readInternalUser,
  requireServiceToken,
  getClientIp,
  reply,
  handleRouteError,
  INTERNAL_HEADERS,
  assertPermission,
} from '@centaur/shared';
import * as notificationService from '../../src/notification.service';
import * as businessNotifications from '../../src/business-notifications';
import * as sse from '../../src/notification-sse';
import * as mailer from '../../src/mailer';

export function createNotifTestApp() {
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
    reply(res, 200, { status: 'ok', service: 'notification' });
  });

  service.post('/internal/emails/mfa', async (req, res) => {
    try {
      requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
      const body = z
        .object({
          userId: z.string().uuid(),
          email: z.string().email(),
          code: z.string().min(4),
          firstName: z.string(),
        })
        .parse(parseBody(req));
      reply(res, 200, await mailer.sendMfaCode(body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  const businessEventSchema = z.object({
    kind: z.enum([
      'PRESCRIPTION_CREATED',
      'PRESCRIPTION_CANCELLED',
      'PATIENT_CREATED',
      'PATIENT_UPDATED',
      'MEDICAL_HISTORY_RECORDED',
    ]),
    actorId: z.string().min(1),
    patientId: z.string().min(1),
    patientCode: z.string().min(1).optional(),
    patientName: z.string().min(1).optional(),
    service: z.enum(['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE']),
  });

  service.post('/internal/notifications/events', async (req, res) => {
    try {
      requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
      const body = businessEventSchema.parse(parseBody(req));
      reply(res, 200, await businessNotifications.dispatchBusinessNotification(body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  const createSchema = z.object({
    recipientId: z.string().min(1),
    patientId: z.string().min(1).optional().nullable(),
    type: z.enum(['GENERAL', 'PATIENT', 'PRESCRIPTION', 'MEDICAL_HISTORY', 'REMINDER']),
    title: z.string().min(1).max(255),
    message: z.string().min(1),
    scheduledAt: z.string().min(1),
  });

  const listQuerySchema = z.object({
    read: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    status: z.enum(['PENDING', 'SENT', 'READ', 'CANCELLED']).optional(),
    type: z.enum(['GENERAL', 'PATIENT', 'PRESCRIPTION', 'MEDICAL_HISTORY', 'REMINDER']).optional(),
    patientId: z.string().min(1).optional(),
  });

  service.get('/notifications', async (req, res) => {
    try {
      const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
      const query = (req as { query?: Record<string, string> }).query || {};
      const filters = listQuerySchema.parse({
        read: query.read,
        status: query.status,
        type: query.type,
        patientId: query.patientId,
      });
      reply(res, 200, await notificationService.listNotifications(user, filters));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  service.get('/notifications/stream', async (req, res) => {
    try {
      const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
      assertPermission(user, 'notifications:read');
      sse.addSseConnection(user.id, res as unknown as sse.SseSink, req);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  service.get('/notifications/:id', async (req, res) => {
    try {
      const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
      const id = (req as { params: { id: string } }).params.id;
      reply(res, 200, await notificationService.getNotification(user, id));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  service.post('/notifications', async (req, res) => {
    try {
      const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
      const body = createSchema.parse(parseBody(req));
      reply(res, 201, await notificationService.createNotification(user, body, getClientIp(req)));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  service.patch('/notifications/:id/read', async (req, res) => {
    try {
      const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
      const id = (req as { params: { id: string } }).params.id;
      reply(res, 200, await notificationService.markNotificationRead(user, id, getClientIp(req)));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  service.patch('/notifications/:id/cancel', async (req, res) => {
    try {
      const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
      const id = (req as { params: { id: string } }).params.id;
      reply(res, 200, await notificationService.cancelNotification(user, id, getClientIp(req)));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  return service;
}

export function listenNotifApp(app: ReturnType<typeof createNotifTestApp>): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app as unknown as http.RequestListener);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no port'));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

export function buildInternalHeaders(user: {
  id: string;
  email: string;
  role: string;
  permissions: string[];
  firstName: string;
  lastName: string;
}): Record<string, string> {
  return {
    [INTERNAL_HEADERS.SERVICE_TOKEN]: process.env.SERVICE_TOKEN || 'test-service-token',
    [INTERNAL_HEADERS.USER_ID]: user.id,
    [INTERNAL_HEADERS.USER_EMAIL]: user.email,
    [INTERNAL_HEADERS.USER_ROLE]: user.role,
    [INTERNAL_HEADERS.USER_PERMISSIONS]: JSON.stringify(user.permissions),
    [INTERNAL_HEADERS.USER_FIRST_NAME]: user.firstName,
    [INTERNAL_HEADERS.USER_LAST_NAME]: user.lastName,
    'content-type': 'application/json',
  };
}

export async function notifHttp(
  port: number,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {}
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: options.headers,
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
