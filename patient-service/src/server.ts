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
  getClientIp,
  reply,
  handleRouteError,
} from '@centaur/shared';
import * as patientService from './patient.service';

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

const specialtySchema = z.object({
  notes: z.string().optional().nullable(),
  arrivalTime: z.string().optional(),
  triageLevel: z.string().optional(),
  initialSeverity: z.string().optional(),
  tumorType: z.string().optional(),
  stage: z.string().optional(),
  currentTreatment: z.string().optional(),
  ecgResults: z.string().optional(),
  restingHeartRate: z.number().int().positive().optional(),
  bloodPressure: z.string().optional(),
});

const patientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  hospitalizationDate: z.string().min(1),
  service: z.enum(['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE']),
  status: z.string().optional(),
  specialty: specialtySchema,
});

service.get('/health', async (_req, res) => {
  reply(res, 200, { status: 'ok', service: 'patient' });
});

service.get('/patients', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'patients:read');
    const query = (req as { query?: Record<string, string> }).query || {};
    const list = await patientService.listPatients({
      service: query.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE' | undefined,
      search: query.search,
    });
    reply(res, 200, list);
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/patients/:id', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'patients:read');
    const id = (req as { params: { id: string } }).params.id;
    reply(res, 200, await patientService.getPatient(id));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/patients', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    const body = patientSchema.parse(parseBody(req));
    reply(res, 201, await patientService.createPatient(user, body, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.put('/patients/:id', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as { params: { id: string } }).params.id;
    const body = patientSchema.parse(parseBody(req));
    reply(res, 200, await patientService.updatePatient(user, id, body, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.delete('/patients/:id', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as { params: { id: string } }).params.id;
    reply(res, 200, await patientService.deletePatient(user, id, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/dashboard/stats', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'patients:read');
    reply(res, 200, await patientService.getDashboardStats());
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/audit-logs', async (req, res) => {
  try {
    const user = readInternalUser(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'audit:read');
    reply(res, 200, await patientService.listAuditLogs());
  } catch (err) {
    handleRouteError(res, err);
  }
});

const port = Number(process.env.PATIENT_PORT || 3002);
createDb();
service.start(port).then(() => {
  console.log(`[patient-service] listening on ${port}`);
});
