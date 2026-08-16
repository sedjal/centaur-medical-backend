import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import restana from 'restana';
import { z } from 'zod';
import {
  createDb,
  destroyDb,
  parseBody,
  requireServiceToken,
  readInternalUserWithSession,
  assertPermission,
  getClientIp,
  reply,
  handleRouteError,
  getListenHost,
} from '@centaur/shared';
import * as mailer from './mailer';
import * as notificationService from './notification.service';
import * as businessNotifications from './business-notifications';
import * as sse from './notification-sse';
import { createNotificationScheduler } from './notification.scheduler';

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

service.post('/internal/emails/welcome', async (req, res) => {
  try {
    requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
    const body = z
      .object({
        userId: z.string().uuid(),
        email: z.string().email(),
        firstName: z.string(),
        tempPassword: z.string(),
      })
      .parse(parseBody(req));
    reply(res, 200, await mailer.sendWelcomeEmail(body));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/internal/emails/password-reset', async (req, res) => {
  try {
    requireServiceToken(req.headers as Record<string, string | string[] | undefined>);
    const body = z
      .object({
        userId: z.string().uuid(),
        email: z.string().email(),
        firstName: z.string(),
        code: z.string().min(4),
      })
      .parse(parseBody(req));
    reply(res, 200, await mailer.sendPasswordResetEmail(body));
  } catch (err) {
    handleRouteError(res, err);
  }
});

const createNotificationSchema = z.object({
  recipientId: z.string().min(1),
  patientId: z.string().min(1).optional().nullable(),
  type: z.enum(['GENERAL', 'PATIENT', 'PRESCRIPTION', 'MEDICAL_HISTORY', 'REMINDER']),
  title: z.string().min(1).max(255),
  message: z.string().min(1).max(4000),
  scheduledAt: z.string().min(1),
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
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
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
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'notifications:read');
    sse.addSseConnection(user.id, res as unknown as sse.SseSink, req);
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/notifications/:id', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await notificationService.getNotification(user, id));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/notifications', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const body = createNotificationSchema.parse(parseBody(req));
    reply(res, 201, await notificationService.createNotification(user, body, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.patch('/notifications/:id/read', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await notificationService.markNotificationRead(user, id, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.patch('/notifications/:id/cancel', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await notificationService.cancelNotification(user, id, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

const port = Number(process.env.NOTIFICATION_PORT || 3003);
const host = getListenHost('internal');
const scheduler = createNotificationScheduler();

createDb();
service.start(port, host).then(async () => {
  console.log(`[notification-service] listening on ${host}:${port}`);
  if (process.env.NODE_ENV !== 'test') {
    await scheduler.start();
    console.log(
      `[notification-service] scheduler started intervalMs=${scheduler.intervalMs}`
    );
  }
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[notification-service] ${signal} received, shutting down`);
  await sse.closeAllSseConnections();
  await scheduler.stop();
  await service.close();
  await destroyDb();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
