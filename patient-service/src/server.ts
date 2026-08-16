import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import restana from 'restana';
import { z } from 'zod';
import {
  createDb,
  parseBody,
  readInternalUserWithSession,
  assertPermission,
  getClientIp,
  reply,
  handleRouteError,
  getListenHost,
} from '@centaur/shared';
import * as patientService from './patient.service';
import * as prescriptionService from './prescription.service';
import * as medicalHistoryService from './medical-history.service';

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
  hospitalizationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid hospitalization date'),
  service: z.enum(['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE']),
  status: z.enum(['STABLE', 'CRITICAL']).optional(),
  specialty: specialtySchema,
});

service.get('/health', async (_req, res) => {
  reply(res, 200, { status: 'ok', service: 'patient' });
});

service.get('/patients', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'patients:read');
    const query = (req as { query?: Record<string, string> }).query || {};
    const list = await patientService.listPatients(user, {
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
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'patients:read');
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await patientService.getPatient(id, user, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/patients', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const body = patientSchema.parse(parseBody(req));
    reply(res, 201, await patientService.createPatient(user, body, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.put('/patients/:id', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    const body = patientSchema.parse(parseBody(req));
    reply(res, 200, await patientService.updatePatient(user, id, body, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.delete('/patients/:id', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await patientService.deletePatient(user, id, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/dashboard/stats', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'patients:read');
    reply(res, 200, await patientService.getDashboardStats(user));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/audit-logs', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    assertPermission(user, 'audit:read');
    reply(res, 200, await patientService.listAuditLogs());
  } catch (err) {
    handleRouteError(res, err);
  }
});

const medicationSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().min(1),
  frequency: z.string().min(1),
  duration: z.string().min(1),
  instructions: z.string().optional().nullable(),
});

const createPrescriptionSchema = z.object({
  patientId: z.string().min(1),
  prescribedAt: z.string().min(1),
  notes: z.string().optional().nullable(),
  medications: z.array(medicationSchema).min(1),
});

service.get('/prescriptions', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const query = (req as { query?: Record<string, string> }).query || {};
    reply(
      res,
      200,
      await prescriptionService.listPrescriptions(user, {
        patientId: query.patientId,
        service: query.service as 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE' | undefined,
        status: query.status as 'ACTIVE' | 'CANCELLED' | undefined,
        from: query.from,
        to: query.to,
      })
    );
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/prescriptions/:id', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await prescriptionService.getPrescription(user, id));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/patients/:id/prescriptions', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await prescriptionService.listPatientPrescriptions(user, id));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.post('/prescriptions', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const body = createPrescriptionSchema.parse(parseBody(req));
    reply(res, 201, await prescriptionService.createPrescription(user, body, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.patch('/prescriptions/:id/cancel', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await prescriptionService.cancelPrescription(user, id, getClientIp(req)));
  } catch (err) {
    handleRouteError(res, err);
  }
});

const historyQuerySchema = z.object({
  patientId: z.string().min(1).optional(),
  service: z.enum(['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE']).optional(),
  type: z
    .enum(['HOSPITALIZATION', 'CONSULTATION', 'DIAGNOSIS', 'PRESCRIPTION', 'RECORD_UPDATE'])
    .optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

service.get('/medical-history', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const query = (req as { query?: Record<string, string> }).query || {};
    const filters = historyQuerySchema.parse({
      patientId: query.patientId,
      service: query.service,
      type: query.type,
      from: query.from,
      to: query.to,
    });
    reply(res, 200, await medicalHistoryService.getMedicalHistory(user, filters));
  } catch (err) {
    handleRouteError(res, err);
  }
});

service.get('/patients/:id/medical-history', async (req, res) => {
  try {
    const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
    const id = (req as unknown as { params: { id: string } }).params.id;
    reply(res, 200, await medicalHistoryService.getPatientMedicalHistory(user, id));
  } catch (err) {
    handleRouteError(res, err);
  }
});

const port = Number(process.env.PATIENT_PORT || 3002);
const host = getListenHost('internal');
createDb();
service.start(port, host).then(() => {
  console.log(`[patient-service] listening on ${host}:${port}`);
});
