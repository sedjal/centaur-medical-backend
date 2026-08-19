/**
 * Mini patient-service HTTP app for integration tests.
 */
import http from 'http';
import restana from 'restana';
import { z } from 'zod';
import {
  parseBody,
  readInternalUserWithSession,
  assertPermission,
  getClientIp,
  reply,
  handleRouteError,
} from '@centaur/shared';
import * as patientService from '../../src/patient.service';
import * as prescriptionService from '../../src/prescription.service';
import * as medicalHistoryService from '../../src/medical-history.service';
import { attachPatientRequestBody, registerDocumentRoutes } from '../../src/documents.routes';
import { registerClinicalNoteRoutes } from '../../src/clinical-notes.routes';

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
  hospitalizationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service: z.enum(['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE']),
  status: z.enum(['STABLE', 'CRITICAL']).optional(),
  specialty: specialtySchema,
});

export function createPatientTestApp() {
  const service = restana();

  service.use(async (req, res, next) => {
    await attachPatientRequestBody(
      req as {
        url?: string;
        method?: string;
        headers?: Record<string, string | string[] | undefined>;
        body?: unknown;
        rawBody?: Buffer;
      },
      res,
      next
    );
  });

  service.get('/patients', async (req, res) => {
    try {
      const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
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
      const id = (req as { params: { id: string } }).params.id;
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
      const id = (req as { params: { id: string } }).params.id;
      const body = patientSchema.parse(parseBody(req));
      reply(res, 200, await patientService.updatePatient(user, id, body, getClientIp(req)));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  service.delete('/patients/:id', async (req, res) => {
    try {
      const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
      const id = (req as { params: { id: string } }).params.id;
      reply(res, 200, await patientService.deletePatient(user, id, getClientIp(req)));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  registerDocumentRoutes(service);
  registerClinicalNoteRoutes(service);

  service.get('/dashboard/stats', async (req, res) => {
    try {
      const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
      assertPermission(user, 'patients:read');
      reply(res, 200, await patientService.getDashboardStats(user));
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
    patientAge: z.string().optional().nullable(),
    patientGender: z.string().optional().nullable(),
    doctorName: z.string().optional().nullable(),
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
      const id = (req as { params: { id: string } }).params.id;
      reply(res, 200, await prescriptionService.getPrescription(user, id));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  service.get('/patients/:id/prescriptions', async (req, res) => {
    try {
      const user = await readInternalUserWithSession(req.headers as Record<string, string | string[] | undefined>);
      const id = (req as { params: { id: string } }).params.id;
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
      const id = (req as { params: { id: string } }).params.id;
      reply(res, 200, await prescriptionService.cancelPrescription(user, id, getClientIp(req)));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  const historyQuerySchema = z.object({
    patientId: z.string().min(1).optional(),
    service: z.enum(['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE']).optional(),
    type: z
      .enum([
        'HOSPITALIZATION',
        'CONSULTATION',
        'DIAGNOSIS',
        'PRESCRIPTION',
        'RECORD_UPDATE',
        'DOCUMENT_ADDED',
        'CLINICAL_NOTE',
      ])
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
      const id = (req as { params: { id: string } }).params.id;
      reply(res, 200, await medicalHistoryService.getPatientMedicalHistory(user, id));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  return service;
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
    'x-service-token': process.env.SERVICE_TOKEN || 'test-service-token',
    'x-user-id': user.id,
    'x-user-email': user.email,
    'x-user-role': user.role,
    'x-user-permissions': JSON.stringify(user.permissions),
    'x-user-first-name': user.firstName,
    'x-user-last-name': user.lastName,
    'x-session-ver': '1',
  };
}

export async function listenPatientApp(app: ReturnType<typeof createPatientTestApp>) {
  const server = await app.start(0);
  const address = (server as http.Server).address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    close: async () => {
      await app.close();
    },
  };
}

export async function patientHttp(
  port: number,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {}
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
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

export async function patientHttpRaw(
  port: number,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: Buffer } = {}
): Promise<{ status: number; data: unknown; raw: Buffer; headers: Headers }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: options.headers || {},
    body: options.body,
  });
  const raw = Buffer.from(await res.arrayBuffer());
  let data: unknown = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      data = raw.length ? JSON.parse(raw.toString('utf8')) : null;
    } catch {
      data = raw.toString('utf8');
    }
  }
  return { status: res.status, data, raw, headers: res.headers };
}
