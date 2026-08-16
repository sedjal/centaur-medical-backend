/**
 * E2E — Médecin A URGENCE crée une ordonnance → notification SENT pour B,
 * transaction métier intacte, acteur exclu, panne notification ≠ rollback.
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import {
  createPatientTestApp,
  listenPatientApp,
  patientHttp,
  buildInternalHeaders,
} from '../../../patient-service/tests/helpers/test-app';
import {
  defaultPatientSeed,
  installPatientDbMock,
  restorePatientDbMock,
} from '../../../patient-service/tests/helpers/patient-db-mock';
import { startNotificationE2e, USERS, waitForRecipient, notificationsFor } from './helpers/harness';
import { prescriptionPayload, urgencePatientPayload } from './helpers/notification-e2e-seed';
import { gwHttp } from './helpers/e2e-gateway';

test('e2e métier: A URGENCE crée ordonnance → B notifié SENT, A/C exclus', async (t) => {
  const h = await startNotificationE2e();
  try {
    const created = await gwHttp(h.gatewayPort, 'POST', '/api/prescriptions', {
      token: h.tokens.a,
      body: { ...prescriptionPayload(), doctorId: 'should-be-ignored', recipientId: USERS.c.id },
    });
    t.equal(created.status, 201);
    const rx = created.data as { id: string; doctorId: string; status: string; patientId: string };
    t.equal(rx.doctorId, USERS.a.id, 'doctorId depuis le JWT, jamais le body');
    t.equal(rx.patientId, 'p-urg-1');
    t.equal(rx.status, 'ACTIVE');

    await waitForRecipient(h.state, USERS.b.id);
    const forB = notificationsFor(h.state, USERS.b.id);
    t.equal(forB.length, 1);
    t.equal(forB[0].type, 'PRESCRIPTION');
    t.equal(forB[0].status, 'SENT');
    t.equal(forB[0].title, 'Nouvelle ordonnance créée');
    t.equal(forB[0].recipient_id, USERS.b.id);
    t.match(String(forB[0].message), /BENALI/);

    t.equal(notificationsFor(h.state, USERS.a.id).length, 0, 'acteur exclu');
    t.equal(notificationsFor(h.state, USERS.c.id).length, 0, 'CARDIOLOGIE exclu');
    t.equal(notificationsFor(h.state, USERS.dir.id).length, 0, 'read_all ≠ destinataire auto');
    t.equal(notificationsFor(h.state, 'u-inactive').length, 0, 'inactif exclu');

    const rxRow = h.state.prescriptions.find((p) => String(p.id) === rx.id);
    t.ok(rxRow);
    t.equal(rxRow!.patient_id, 'p-urg-1');
    t.equal(rxRow!.doctor_id, USERS.a.id);

    t.ok(h.state.audit_logs.some((a) => a.action === 'PRESCRIPTION_CREATED'));
    const hist = h.state.medical_history.find((e) => e.event_type === 'PRESCRIPTION');
    t.ok(hist);
    t.equal((hist!.metadata as { action?: string } | null)?.action, 'CREATED');
  } finally {
    await h.close();
    t.end();
  }
});

test('e2e métier: PATIENT_CREATED / UPDATE / PRESCRIPTION_CANCEL', async (t) => {
  const h = await startNotificationE2e();
  try {
    const createdPatient = await gwHttp(h.gatewayPort, 'POST', '/api/patients', {
      token: h.tokens.a,
      body: urgencePatientPayload(),
    });
    t.equal(createdPatient.status, 201);
    const patient = createdPatient.data as { id: string; service: string };
    t.equal(patient.service, 'URGENCE');
    await waitForRecipient(h.state, USERS.b.id, 1);
    const admit = notificationsFor(h.state, USERS.b.id).find((n) => n.title === 'Nouveau patient admis');
    t.ok(admit);
    t.equal(admit!.type, 'PATIENT');
    t.equal(admit!.status, 'SENT');
    t.equal(notificationsFor(h.state, USERS.a.id).length, 0);
    t.equal(notificationsFor(h.state, USERS.c.id).length, 0);

    const updated = await gwHttp(h.gatewayPort, 'PUT', `/api/patients/${patient.id}`, {
      token: h.tokens.a,
      body: {
        ...urgencePatientPayload(),
        lastName: 'Khelifi',
        firstName: 'Nour',
      },
    });
    t.equal(updated.status, 200);
    await waitForRecipient(h.state, USERS.b.id, 2);
    const dossier = notificationsFor(h.state, USERS.b.id).filter((n) => n.title === 'Dossier patient modifié');
    t.equal(dossier.length, 1, 'une seule notification UPDATE');
    t.ok(
      h.state.medical_history.some((e) => e.event_type === 'RECORD_UPDATE'),
      'medical_history RECORD_UPDATE'
    );

    const rx = await gwHttp(h.gatewayPort, 'POST', '/api/prescriptions', {
      token: h.tokens.a,
      body: prescriptionPayload('p-urg-1'),
    });
    t.equal(rx.status, 201);
    const rxId = (rx.data as { id: string }).id;
    await waitForRecipient(h.state, USERS.b.id, 3);

    const cancelled = await gwHttp(h.gatewayPort, 'PATCH', `/api/prescriptions/${rxId}/cancel`, {
      token: h.tokens.a,
    });
    t.equal(cancelled.status, 200);
    await waitForRecipient(h.state, USERS.b.id, 4);
    const cancelNotif = notificationsFor(h.state, USERS.b.id).find((n) => n.title === 'Ordonnance annulée');
    t.ok(cancelNotif);
    t.equal(cancelNotif!.status, 'SENT');
    t.ok(h.state.audit_logs.some((a) => a.action === 'PRESCRIPTION_CANCELLED'));
    t.ok(
      h.state.medical_history.some(
        (e) =>
          e.event_type === 'PRESCRIPTION' && (e.metadata as { action?: string } | null)?.action === 'CANCELLED'
      )
    );
    t.equal(notificationsFor(h.state, USERS.a.id).length, 0);
  } finally {
    await h.close();
    t.end();
  }
});

test('e2e résilience: notification-service down ≠ rollback ordonnance', async (t) => {
  process.env.BUSINESS_NOTIFICATIONS = '1';
  process.env.NOTIFICATION_SERVICE_URL = 'http://127.0.0.1:9';
  const { state } = installPatientDbMock(defaultPatientSeed());
  const app = createPatientTestApp();
  const { port, close } = await listenPatientApp(app);
  try {
    const created = await patientHttp(port, 'POST', '/prescriptions', {
      headers: buildInternalHeaders({
        id: 'u-urg',
        email: 'urg@test.com',
        role: 'MEDECIN',
        permissions: [
          'prescriptions:read',
          'prescriptions:create',
          'service:urgence',
        ],
        firstName: 'Léa',
        lastName: 'Urg',
      }),
      body: prescriptionPayload(),
    });
    t.equal(created.status, 201);
    await new Promise((r) => setTimeout(r, 80));
    t.equal(state.prescriptions.length, 1);
    t.ok(state.audit_logs.some((a) => a.action === 'PRESCRIPTION_CREATED'));
    t.ok(
      state.medical_history.some(
        (e) =>
          e.event_type === 'PRESCRIPTION' && (e.metadata as { action?: string } | null)?.action === 'CREATED'
      )
    );
  } finally {
    await close();
    restorePatientDbMock();
    delete process.env.BUSINESS_NOTIFICATIONS;
    delete process.env.NOTIFICATION_SERVICE_URL;
    t.end();
  }
});
