import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import restana from 'restana';
import { z } from 'zod';
import { createDb, parseBody, requireServiceToken, reply, handleRouteError } from '@centaur/shared';
import * as mailer from './mailer';

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

const port = Number(process.env.NOTIFICATION_PORT || 3003);
createDb();
service.start(port).then(() => {
  console.log(`[notification-service] listening on ${port}`);
});
