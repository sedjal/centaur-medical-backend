/**
 * UNIT — prescription.service (RBAC, isolation, audit, transaction)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { AppError, type InternalUser, type Permission } from '@centaur/shared';
import {
  createPrescription,
  getPrescription,
  listPrescriptions,
  listPatientPrescriptions,
  cancelPrescription,
  validateMedications,
  validatePrescribedAt,
} from '../../src/prescription.service';
import { deletePatient } from '../../src/patient.service';
import {
  defaultPatientSeed,
  installPatientDbMock,
  restorePatientDbMock,
} from '../helpers/patient-db-mock';

const ALL_SVC: Permission[] = [
  'service:general',
  'service:urgence',
  'service:oncologie',
  'service:cardiologie',
];

function mkUser(permissions: Permission[], id = 'u-test'): InternalUser {
  return {
    id,
    email: 'doc@test.com',
    role: 'MEDECIN',
    permissions,
    firstName: 'Test',
    lastName: 'Doc',
  };
}

const rxPerms: Permission[] = [
  'prescriptions:read',
  'prescriptions:create',
  'prescriptions:cancel',
  'patients:read',
  'patients:delete',
  ...ALL_SVC,
];

const urgRx = (): InternalUser =>
  mkUser(['prescriptions:read', 'prescriptions:create', 'prescriptions:cancel', 'service:urgence'], 'u-urg');

function validMeds() {
  return [
    {
      name: 'Paracétamol',
      dosage: '1g',
      frequency: '3x/jour',
      duration: '5 jours',
      instructions: 'Après repas',
    },
  ];
}

test('prescription validate: medications vide → 400', (t) => {
  try {
    validateMedications([]);
    t.fail('should throw');
  } catch (e) {
    t.ok(e instanceof AppError);
    t.equal((e as AppError).statusCode, 400);
  }
  t.end();
});

test('prescription validate: prescribedAt invalide → 400', (t) => {
  try {
    validatePrescribedAt('not-a-date');
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  }
  t.end();
});

test('prescription create: médecin autorisé + doctorId depuis JWT', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  try {
    const user = urgRx();
    const created = await createPrescription(user, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      notes: 'Douleur',
      medications: validMeds(),
      // @ts-expect-error doctorId must be ignored if somehow passed
      doctorId: 'hacker-id',
    } as never);

    t.equal(created.doctorId, 'u-urg');
    t.equal(created.status, 'ACTIVE');
    t.equal(created.patientId, 'p-urg-1');
    t.equal(created.medications.length, 1);
    t.equal(created.medications[0].name, 'Paracétamol');
    t.equal(state.prescriptions.length, 1);
    t.equal(state.prescription_items.length, 1);
    t.equal(state.audit_logs.some((a) => a.action === 'PRESCRIPTION_CREATED'), true);
    t.equal(String(state.prescriptions[0].doctor_id), 'u-urg');
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription create: patient inexistant → 404', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createPrescription(urgRx(), {
      patientId: 'missing',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 404);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription create: sans prescriptions:create → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createPrescription(mkUser(['prescriptions:read', 'service:urgence']), {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription create: isolation service A → patient B → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createPrescription(urgRx(), {
      patientId: 'p-onco-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription create: medications vide → 400', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createPrescription(urgRx(), {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: [],
    });
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription create: transaction rollback si item échoue', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed(), {
    failInsertOn: 'prescription_items',
  });
  try {
    await createPrescription(urgRx(), {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });
    t.fail('should throw');
  } catch {
    t.equal(state.prescriptions.length, 0);
    t.equal(state.prescription_items.length, 0);
    t.equal(state.audit_logs.length, 0);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription read: get + list patient + filtres', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    const user = urgRx();
    const created = await createPrescription(user, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });

    const one = await getPrescription(user, created.id);
    t.equal(one.id, created.id);
    t.match(String(one.doctorName), /Léa|Urg/);

    const list = await listPatientPrescriptions(user, 'p-urg-1');
    t.equal(list.length, 1);

    const filtered = await listPrescriptions(user, { status: 'ACTIVE', service: 'URGENCE' });
    t.equal(filtered.length, 1);

    try {
      await getPrescription(user, 'missing-rx');
      t.fail('should 404');
    } catch (e) {
      t.equal((e as AppError).statusCode, 404);
    }
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription cancel: ACTIVE → CANCELLED + audit; double → 409', async (t) => {
  const { state } = installPatientDbMock(defaultPatientSeed());
  try {
    const user = urgRx();
    const created = await createPrescription(user, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });

    const cancelled = await cancelPrescription(user, created.id, '127.0.0.1');
    t.equal(cancelled.status, 'CANCELLED');
    t.ok(state.audit_logs.some((a) => a.action === 'PRESCRIPTION_CANCELLED'));

    try {
      await cancelPrescription(user, created.id);
      t.fail('should 409');
    } catch (e) {
      t.equal((e as AppError).statusCode, 409);
    }
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription cancel: sans permission → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    const creator = urgRx();
    const created = await createPrescription(creator, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });
    await cancelPrescription(mkUser(['prescriptions:read', 'service:urgence']), created.id);
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription: delete patient avec ordonnance → 409', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    const user = mkUser(rxPerms, 'u-urg');
    await createPrescription(user, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });
    await deletePatient(user, 'p-urg-1');
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 409);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription list: sans service:* → 403', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await listPrescriptions(mkUser(['prescriptions:read']));
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription create: patientId vide → 400', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    await createPrescription(urgRx(), {
      patientId: '  ',
      prescribedAt: '2026-08-12T14:30:00.000Z',
      medications: validMeds(),
    });
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});

test('prescription list: filtres from/to + patientId', async (t) => {
  installPatientDbMock(defaultPatientSeed());
  try {
    const user = urgRx();
    await createPrescription(user, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-01T10:00:00.000Z',
      medications: validMeds(),
    });
    await createPrescription(user, {
      patientId: 'p-urg-1',
      prescribedAt: '2026-08-20T10:00:00.000Z',
      medications: validMeds(),
    });

    const ranged = await listPrescriptions(user, {
      from: '2026-08-10T00:00:00.000Z',
      to: '2026-08-31T00:00:00.000Z',
    });
    t.equal(ranged.length, 1);
    t.equal(ranged[0].prescribedAt.startsWith('2026-08-20'), true);

    const byPatient = await listPrescriptions(user, { patientId: 'p-urg-1' });
    t.equal(byPatient.length, 2);

    const empty = await listPrescriptions(user, { patientId: 'missing-patient' });
    t.equal(empty.length, 0);
  } finally {
    restorePatientDbMock();
    t.end();
  }
});
