import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import restana from 'restana';
import { z } from 'zod';
import {
  createDb,
  parseBody,
  requireServiceToken,
  readInternalUser,
  getClientIp,
  reply,
  handleRouteError,
} from '@centaur/shared';
import * as mailer from './mailer';
import * as notificationService from './notification.service';

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

service.get('/notifications/:id', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await notificationService.getNotification(user, id));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/notifications', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    const body = createNotificationSchema.parse(parseBody(req));
    reply(res, 201, await notificationService.createNotification(user, body, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.patch('/notifications/:id/read', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await notificationService.markNotificationRead(user, id, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.patch('/notifications/:id/cancel', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await notificationService.cancelNotification(user, id, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

const port = Number(process.env.NOTIFICATION_PORT || 3003);
createDb();
service.start(port).then(() => {
  console.log(`[notification-service] listening on ${port}`);
});
