/**
 * UNIT — patient.service async + DB mock (RBAC, CRUD, dossiers, audit)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { AppError, type InternalUser, type Permission, type ServiceType } from '@centaur/shared';
import {
  allowedServices,
  resolveListScope,
  listPatients,
  getPatient,
  getDashboardStats,
  createPatient,
  updatePatient,
  deletePatient,
  validateSpecialty,
  validateHospitalizationDate,
  buildPatientAuditRow,
  assertMedicalRecordIntegrity,
  type PatientInput,
} from '../../src/patient.service';
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

function mkUser(permissions: Permission[], role = 'CUSTOM'): InternalUser {
  return {
    id: 'u-test',
    email: 'test@test.com',
    role,
    permissions,
    firstName: 'Test',
    lastName: 'User',
  };
}

const adminUser = () =>
  mkUser(
    ['patients:read', 'patients:create', 'patients:update', 'patients:delete', ...ALL_SVC],
    'ADMIN'
  );

const urgRead = () => mkUser(['patients:read', 'service:urgence'], 'MEDECIN_URGENCE');
const urgWrite = () =>
  mkUser(['patients:read', 'patients:create', 'patients:update', 'service:urgence'], 'MEDECIN_URGENCE');
const cardioRead = () => mkUser(['patients:read', 'service:cardiologie'], 'CARDIO_READER');
const urgCardioUpdate = () =>
  mkUser(['patients:read', 'patients:update', 'service:urgence', 'service:cardiologie']);

function urgSpec() {
  return { arrivalTime: '10:00', triageLevel: '1', initialSeverity: 'Critical' };
}
function oncoSpec() {
  return { tumorType: 'Type A', stage: 'II', currentTreatment: 'Chemo' };
}
function cardioSpec(hr = 72) {
  return { ecgResults: 'NSR', restingHeartRate: hr, bloodPressure: '120/80' };
}
function genSpec() {
  return { notes: 'Follow-up' };
}

function input(service: ServiceType, extra: Partial<PatientInput> = {}): PatientInput {
  const specialty =
    service === 'URGENCE'
      ? urgSpec()
      : service === 'ONCOLOGIE'
        ? oncoSpec()
        : service === 'CARDIOLOGIE'
          ? cardioSpec()
          : genSpec();
  return {
    firstName: 'Jean',
    lastName: 'Dupont',
    hospitalizationDate: '2026-08-12',
    service,
    specialty,
    ...extra,
  };
}

function setup(seed = defaultPatientSeed(), options = {}) {
  return installPatientDbMock(seed, options);
}

function teardown() {
  restorePatientDbMock();
}

test('RBAC: allowedServices — admin, URGENCE, CARDIO, multi, none', (t) => {
  t.deepEqual(allowedServices(adminUser()), ['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE']);
  t.deepEqual(allowedServices(urgRead()), ['URGENCE']);
  t.deepEqual(allowedServices(cardioRead()), ['CARDIOLOGIE']);
  t.deepEqual(allowedServices(urgCardioUpdate()), ['URGENCE', 'CARDIOLOGIE']);
  t.deepEqual(allowedServices(mkUser(['patients:read'])), []);
  t.end();
});

test('RBAC: resolveListScope sans service → 403', (t) => {
  try {
    resolveListScope(mkUser(['patients:read']));
    t.fail('expected 403');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  t.end();
});

test('READ: listPatients admin → 5 patients', async (t) => {
  setup();
  const list = await listPatients(adminUser());
  t.equal(list.length, 5);
  teardown();
  t.end();
});

test('READ: listPatients URGENCE-only → 1', async (t) => {
  setup();
  const list = await listPatients(urgRead());
  t.equal(list.length, 1);
  t.equal(list[0].service, 'URGENCE');
  teardown();
  t.end();
});

test('READ: listPatients multi-service URGENCE+CARDIO', async (t) => {
  setup();
  const list = await listPatients(urgCardioUpdate());
  t.equal(list.length, 3);
  t.ok(list.every((p: { service: string }) => ['URGENCE', 'CARDIOLOGIE'].includes(p.service)));
  teardown();
  t.end();
});

test('READ: search Ahmed URGENCE-only → Benali only', async (t) => {
  setup();
  const list = await listPatients(urgRead(), { search: 'Ahmed' });
  t.equal(list.length, 1);
  t.equal(list[0].last_name, 'Benali');
  teardown();
  t.end();
});

test('READ: ?service=CARDIO URGENCE-only → 403', async (t) => {
  setup();
  try {
    await listPatients(urgRead(), { service: 'CARDIOLOGIE' });
    t.fail('expected 403');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  teardown();
  t.end();
});

test('READ: ?service=URGENCE URGENCE-only → OK', async (t) => {
  setup();
  const list = await listPatients(urgRead(), { service: 'URGENCE' });
  t.equal(list.length, 1);
  teardown();
  t.end();
});

test('READ: getPatient URGENCE authorized + audit', async (t) => {
  const { state } = setup();
  const row = await getPatient('p-urg-1', urgRead(), '10.0.0.1');
  t.equal(row.service, 'URGENCE');
  t.ok(row.medicalRecord);
  t.ok(row.specialty);
  t.equal(state.audit_logs.length, 1);
  t.equal(state.audit_logs[0].action, 'PATIENT_READ');
  teardown();
  t.end();
});

test('READ: getPatient cross-service → 403, no audit', async (t) => {
  const { state } = setup();
  try {
    await getPatient('p-cardio-1', urgRead());
    t.fail('expected 403');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  t.equal(state.audit_logs.length, 0);
  teardown();
  t.end();
});

test('READ: getPatient 404, no audit', async (t) => {
  const { state } = setup();
  try {
    await getPatient('missing-id', adminUser());
    t.fail('expected 404');
  } catch (e) {
    t.equal((e as AppError).statusCode, 404);
  }
  t.equal(state.audit_logs.length, 0);
  teardown();
  t.end();
});

test('READ: dashboard admin global', async (t) => {
  setup();
  const stats = await getDashboardStats(adminUser());
  t.equal(stats.total, 5);
  teardown();
  t.end();
});

test('READ: dashboard URGENCE scoped', async (t) => {
  setup();
  const stats = await getDashboardStats(urgRead());
  t.equal(stats.total, 1);
  t.equal(stats.byService.URGENCE, 1);
  teardown();
  t.end();
});

test('READ: dashboard sans service → 403', async (t) => {
  setup();
  try {
    await getDashboardStats(mkUser(['patients:read']));
    t.fail('expected 403');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  teardown();
  t.end();
});

test('READ: sans patients:read → 403 list', async (t) => {
  setup();
  try {
    await listPatients(mkUser(['service:urgence']));
    t.fail('expected 403');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  teardown();
  t.end();
});

test('CREATE: admin all 4 services', async (t) => {
  setup();
  for (const svc of ['GENERAL', 'URGENCE', 'ONCOLOGIE', 'CARDIOLOGIE'] as ServiceType[]) {
    const p = await createPatient(adminUser(), input(svc), '1.2.3.4');
    t.equal(p.service, svc);
    t.ok(p.medicalRecord);
    t.ok(p.specialty);
  }
  teardown();
  t.end();
});

test('CREATE: URGENCE user creates URGENCE OK', async (t) => {
  const { state } = setup();
  const p = await createPatient(urgWrite(), input('URGENCE'), '9.9.9.9');
  t.equal(p.service, 'URGENCE');
  t.ok(state.audit_logs.some((a) => a.action === 'PATIENT_CREATE'));
  teardown();
  t.end();
});

test('CREATE: URGENCE user creates CARDIO → 403', async (t) => {
  setup();
  try {
    await createPatient(urgWrite(), input('CARDIOLOGIE'));
    t.fail('expected 403');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  teardown();
  t.end();
});

test('CREATE: sans patients:create → 403', async (t) => {
  setup();
  try {
    await createPatient(urgRead(), input('URGENCE'));
    t.fail('expected 403');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  teardown();
  t.end();
});

test('CREATE: invalid specialty URGENCE/ONCO/CARDIO → 400', (t) => {
  try {
    validateSpecialty('URGENCE', {});
    t.fail('urg');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  }
  try {
    validateSpecialty('ONCOLOGIE', {});
    t.fail('onco');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  }
  try {
    validateSpecialty('CARDIOLOGIE', { ecgResults: 'x', restingHeartRate: 0, bloodPressure: '1' });
    t.fail('cardio hr');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  }
  t.end();
});

test('CREATE: invalid hospitalizationDate → 400', (t) => {
  try {
    validateHospitalizationDate('not-a-date');
    t.fail('expected 400');
  } catch (e) {
    t.equal((e as AppError).statusCode, 400);
  }
  t.end();
});

test('CREATE: rollback when audit insert fails in transaction', async (t) => {
  const { state } = setup(defaultPatientSeed(), { failInsertOn: 'audit_logs' });
  const before = state.patients.length;
  try {
    await createPatient(adminUser(), input('URGENCE'));
    t.fail('expected throw');
  } catch {
    t.equal(state.patients.length, before);
    t.equal(state.audit_logs.length, 0);
  }
  teardown();
  t.end();
});

test('UPDATE: same service URGENCE OK + audit', async (t) => {
  const { state } = setup();
  const updated = await updatePatient(urgWrite(), 'p-urg-1', input('URGENCE', { lastName: 'Modifié' }), '8.8.8.8');
  t.equal(updated.last_name, 'Modifié');
  t.ok(state.audit_logs.some((a) => a.action === 'PATIENT_UPDATE'));
  teardown();
  t.end();
});

test('UPDATE: cross-service CARDIO by URGENCE-only → 403', async (t) => {
  setup();
  try {
    await updatePatient(urgWrite(), 'p-cardio-1', input('CARDIOLOGIE'));
    t.fail('expected 403');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  teardown();
  t.end();
});

test('UPDATE: URGENCE→CARDIO without CARDIO perm → 403', async (t) => {
  setup();
  try {
    await updatePatient(urgWrite(), 'p-urg-1', input('CARDIOLOGIE'));
    t.fail('expected 403');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }
  teardown();
  t.end();
});

test('UPDATE: URGENCE→CARDIO with both perms OK', async (t) => {
  setup();
  const updated = await updatePatient(urgCardioUpdate(), 'p-urg-1', input('CARDIOLOGIE'));
  t.equal(updated.service, 'CARDIOLOGIE');
  t.ok(updated.specialty);
  teardown();
  t.end();
});

test('UPDATE: patient inexistant → 404', async (t) => {
  setup();
  try {
    await updatePatient(adminUser(), 'nope', input('URGENCE'));
    t.fail('expected 404');
  } catch (e) {
    t.equal((e as AppError).statusCode, 404);
  }
  teardown();
  t.end();
});

test('UPDATE: rollback when audit insert fails in transaction', async (t) => {
  const { state } = setup(defaultPatientSeed(), { failInsertOn: 'audit_logs' });
  const beforeName = state.patients.find((p) => p.id === 'p-urg-1')!.last_name;
  try {
    await updatePatient(adminUser(), 'p-urg-1', input('URGENCE', { lastName: 'RollbackTest' }));
    t.fail('expected throw');
  } catch {
    const after = state.patients.find((p) => p.id === 'p-urg-1')!;
    t.equal(after.last_name, beforeName);
  }
  teardown();
  t.end();
});

test('DELETE: admin + scoped OK, cross 403, no perm 403, 404', async (t) => {
  const { state } = setup();
  await deletePatient(adminUser(), 'p-gen-1', '7.7.7.7');
  t.equal(
    state.patients.some((p) => p.id === 'p-gen-1'),
    false
  );
  t.ok(state.audit_logs.some((a) => a.action === 'PATIENT_DELETE'));

  restorePatientDbMock();
  setup();
  try {
    await deletePatient(urgWrite(), 'p-cardio-1');
    t.fail('cross delete');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }

  try {
    await deletePatient(mkUser(['service:urgence']), 'p-urg-1');
    t.fail('no delete perm');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  }

  try {
    await deletePatient(adminUser(), 'ghost');
    t.fail('404');
  } catch (e) {
    t.equal((e as AppError).statusCode, 404);
  }
  teardown();
  t.end();
});

test('DELETE: cascade medical_records in mock', async (t) => {
  const { state } = setup();
  await deletePatient(adminUser(), 'p-urg-1');
  t.equal(
    state.medical_records.some((mr) => mr.patient_id === 'p-urg-1'),
    false
  );
  t.equal(state.emergency_records.length, 0);
  teardown();
  t.end();
});

test('DOSSIERS: integrity missing MR → 500', (t) => {
  try {
    assertMedicalRecordIntegrity({ service: 'URGENCE' }, null, null);
    t.fail('expected 500');
  } catch (e) {
    t.equal((e as AppError).statusCode, 500);
  }
  t.end();
});

test('DOSSIERS: service mismatch → 500', (t) => {
  try {
    assertMedicalRecordIntegrity(
      { service: 'URGENCE' },
      { service: 'CARDIOLOGIE', id: 'mr-x' },
      { id: 'sp' }
    );
    t.fail('expected 500');
  } catch (e) {
    t.equal((e as AppError).statusCode, 500);
  }
  t.end();
});

test('DOSSIERS: getPatient missing specialty → 500', async (t) => {
  const seed = defaultPatientSeed();
  seed.emergency_records = [];
  setup(seed);
  try {
    await getPatient('p-urg-1', adminUser());
    t.fail('expected 500');
  } catch (e) {
    t.equal((e as AppError).statusCode, 500);
  }
  teardown();
  t.end();
});

test('DOSSIERS: load each service specialty via getPatient', async (t) => {
  setup();
  const urg = await getPatient('p-urg-1', adminUser());
  t.ok(urg.specialty);
  const onco = await getPatient('p-onco-1', adminUser());
  t.ok(onco.specialty);
  const cardio = await getPatient('p-cardio-1', adminUser());
  t.ok(cardio.specialty);
  const gen = await getPatient('p-gen-1', adminUser());
  t.ok(gen.specialty);
  teardown();
  t.end();
});

test('AUDIT: buildPatientAuditRow details object', (t) => {
  const row = buildPatientAuditRow(adminUser(), 'PATIENT_READ', 'id', 'Name', '1.1.1.1', {
    service: 'URGENCE',
  });
  t.deepEqual(row.details, { service: 'URGENCE' });
  t.equal(typeof row.details, 'object');
  t.end();
});

test('RBAC flexible: MEDECIN_URGENCE et CARDIO_READER roles (permissions only)', async (t) => {
  setup();
  const medUrg = mkUser(
    ['patients:read', 'patients:create', 'patients:update', 'service:urgence'],
    'MEDECIN_URGENCE'
  );
  const list = await listPatients(medUrg);
  t.equal(list.length, 1);
  const cardioOnly = mkUser(['patients:read', 'service:cardiologie'], 'CARDIO_READER');
  const cardioList = await listPatients(cardioOnly);
  t.equal(cardioList.length, 2);
  teardown();
  t.end();
});

test('UPDATE patient: émet PATIENT_UPDATED après succès', async (t) => {
  const events: unknown[] = [];
  const { __setBusinessNotifyDispatcher, __resetBusinessNotifyDispatcher } = await import(
    '../../src/business-notify'
  );
  __setBusinessNotifyDispatcher(async (e) => {
    events.push(e);
  });
  setup();
  try {
    await updatePatient(urgWrite(), 'p-urg-1', input('URGENCE', { lastName: 'Modifié' }), '8.8.8.8');
    t.equal(events.length, 1);
    t.equal((events[0] as { kind: string }).kind, 'PATIENT_UPDATED');
    t.equal((events[0] as { patientId: string }).patientId, 'p-urg-1');
  } finally {
    __resetBusinessNotifyDispatcher();
    teardown();
    t.end();
  }
});
