/**
 * UNIT — medical-history.service (RBAC, isolation, filters, immutability)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { AppError, type InternalUser, type Permission } from '@centaur/shared';
import {
  createMedicalHistoryEvent,
  getMedicalHistory,
  getPatientMedicalHistory,
} from '../../src/medical-history.service';
import * as historyService from '../../src/medical-history.service';
import { createPrescription, cancelPrescription } from '../../src/prescription.service';
import { updatePatient } from '../../src/patient.service';
import {
  defaultPatientSeed,
  installPatientDbMock,
  restorePatientDbMock,
} from '../helpers/patient-db-mock';

function mkUser(permissions: Permission[], id = 'u-urg'): InternalUser {
  return {
    id,
    email: 'doc@test.com',
    role: 'MEDECIN',
    permissions,
    firstName: 'Léa',
    lastName: 'Urg',
  };
}

const histUrg = (): InternalUser =>
  mkUser(['medical_history:read', 'service:urgence'], 'u-urg');

const rxUrg = (): InternalUser =>
  mkUser(
    [
      'prescriptions:read',
      'prescriptions:create',
      'prescriptions:cancel',
      'medical_history:read',
      'service:urgence',
    ],
    'u-urg'
  );

function validMeds() {
  return [
    {
      name: 'Paracétamol',
      dosage: '1g',
      frequency: '3x/jour',
      duration: '5 jours',
    },
  ];
}

test('medical history: patient inexistant → 404', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await getPatientMedicalHistory(histUrg(), 'missing');
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 404);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('medical history: sans permission → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await getPatientMedicalHistory(mkUser(['service:urgence']), 'p-urg-1');
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('medical history: service interdit → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await getPatientMedicalHistory(histUrg(), 'p-cardio-1');
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('medical history: prescription crée un événement PRESCRIPTION', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  try {
    const user = rxUrg();
    const created = await createPrescription(user, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });
    t.equal(state.medical_history.length, 1);
    t.equal(state.medical_history[0].event_type, 'PRESCRIPTION');
    t.equal((state.medical_history[0].metadata as { prescriptionId: string }).prescriptionId, created.id);
    t.equal(
      JSON.stringify(state.medical_history[0].metadata || {}).includes('Paracétamol'),
      false
    );

    const list = await getPatientMedicalHistory(user, 'p-urg-1');
    t.equal(list.total, 1);
    t.equal(list.items[0].eventType, 'PRESCRIPTION');
    t.equal(list.items[0].summary, 'Nouvelle ordonnance créée');
    t.equal(list.items[0].doctorId, 'u-urg');
    t.match(String(list.items[0].doctorName), /Léa|Urg/);
    t.equal(list.items[0].metadata?.prescriptionId, created.id);
    t.equal(list.items[0].metadata?.medications, undefined);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('medical history: cancel crée un nouvel événement, sans supprimer le précédent', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  try {
    const user = rxUrg();
    const created = await createPrescription(user, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });
    await cancelPrescription(user, created.id);
    t.equal(state.medical_history.length, 2);
    const types = state.medical_history.map((h) => h.summary);
    t.ok(types.includes('Nouvelle ordonnance créée'));
    t.ok(types.includes('Ordonnance annulée'));
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('medical history: tri DESC + filtres type / service / date', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    const user = rxUrg();
    await createMedicalHistoryEvent({
      patientId: 'p-urg-1',
      eventType: 'RECORD_UPDATE',
      occurredAt: '2026-08-01T10:00:00.000Z',
      service: 'URGENCE',
      summary: 'Ancien update',
      metadata: { source: 'PATIENT_UPDATE' },
    });
    await createPrescription(user, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-20T10:00:00.000Z',
      medications: validMeds(),
    });

    const all = await getPatientMedicalHistory(user, 'p-urg-1');
    t.equal(all.total, 2);
    t.equal(all.items[0].eventType, 'PRESCRIPTION');
    t.equal(all.items[1].eventType, 'RECORD_UPDATE');

    const typed = await getMedicalHistory(user, { type: 'PRESCRIPTION', service: 'URGENCE' });
    t.equal(typed.total, 1);
    t.equal(typed.items[0]?.eventType, 'PRESCRIPTION');

    const ranged = await getMedicalHistory(user, {
      from: '2026-08-10T00:00:00.000Z',
      to: '2026-08-31T00:00:00.000Z',
    });
    t.equal(ranged.total, 1);
    t.equal(ranged.items[0]?.eventType, 'PRESCRIPTION');
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('medical history: metadata limitée (pas de médicaments)', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createMedicalHistoryEvent({
      patientId: 'p-urg-1',
      eventType: 'PRESCRIPTION',
      occurredAt: '2026-08-12T10:00:00.000Z',
      service: 'URGENCE',
      summary: 'Nouvelle ordonnance créée',
      metadata: {
        prescriptionId: 'rx-1',
        medications: [{ name: 'Secret' }],
        oldStatus: 'CRITICAL',
      },
    });
    const list = await getPatientMedicalHistory(histUrg(), 'p-urg-1');
    t.equal(list.items[0].metadata?.prescriptionId, 'rx-1');
    t.equal(list.items[0].metadata?.medications, undefined);
    t.equal(list.items[0].metadata?.oldStatus, undefined);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('medical history: événements immuables (pas d’update/delete exportés)', (t) => {
  t.equal(typeof (historyService as { updateMedicalHistoryEvent?: unknown }).updateMedicalHistoryEvent, 'undefined');
  t.equal(typeof (historyService as { deleteMedicalHistoryEvent?: unknown }).deleteMedicalHistoryEvent, 'undefined');
  t.end();
});

test('medical history: list sans service:* → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await getMedicalHistory(mkUser(['medical_history:read']));
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('medical history: update dossier → RECORD_UPDATE, create patient ≠ HOSPITALIZATION', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  try {
    const user = mkUser(
      [
        'patients:update',
        'medical_history:read',
        'service:urgence',
      ],
      'u-urg'
    );
    const before = state.medical_history.length;
    await updatePatient(
      user,
      'p-urg-1',
      {
        firstName: 'Ahmed',
        lastName: 'Benali',
        hospitalizationDate: '2026-08-11',
        service: 'URGENCE',
        status: 'STABLE',
        specialty: {
          arrivalTime: '08:00',
          triageLevel: '2',
          initialSeverity: 'Modérée',
        },
      }
    );
    t.equal(state.medical_history.length, before + 1);
    t.equal(state.medical_history[state.medical_history.length - 1].event_type, 'RECORD_UPDATE');
    t.equal(
      JSON.stringify(state.medical_history[state.medical_history.length - 1].metadata || {}).includes(
        'Modérée'
      ),
      false
    );
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('medical history: from invalide → 400', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await getMedicalHistory(histUrg(), { from: 'not-a-date' });
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});
