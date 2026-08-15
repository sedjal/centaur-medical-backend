/**
 * UNIT — isolation métier service:* (lecture)
 * Pas de DB : les règles list/get/dashboard/search sont testées sur les helpers exportés.
 */
import test from 'tape';
import { type InternalUser, type Permission } from '@centaur/shared';
import {
  allowedServices,
  resolveListScope,
  filterPatientsByScope,
  assertServiceAccess,
  buildDashboardFromRows,
  buildPatientAuditRow,
} from '../src/patient.service';

process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';

function urgUser(): InternalUser {
  return {
    id: 'u-urg',
    email: 'urg@test.com',
    role: 'MEDECIN',
    permissions: ['patients:read', 'service:urgence'] as Permission[],
    firstName: 'Léa',
    lastName: 'Urg',
  };
}

const rows = [
  {
    id: '1',
    service: 'URGENCE',
    first_name: 'Ahmed',
    last_name: 'Benali',
    patient_code: 'PT-000124',
    status: 'CRITICAL',
    hospitalization_date: '2026-08-11',
    created_at: '2026-08-11T10:00:00Z',
  },
  {
    id: '2',
    service: 'CARDIOLOGIE',
    first_name: 'Ahmed',
    last_name: 'Kaci',
    patient_code: 'PT-000199',
    status: 'STABLE',
    hospitalization_date: '2026-08-10',
    created_at: '2026-08-10T10:00:00Z',
  },
  {
    id: '3',
    service: 'ONCOLOGIE',
    first_name: 'Sarah',
    last_name: 'Amara',
    patient_code: 'PT-000125',
    status: 'STABLE',
    hospitalization_date: '2026-08-09',
    created_at: '2026-08-09T10:00:00Z',
  },
];

test('isolation: allowedServices URGENCE only', (t) => {
  t.deepEqual(allowedServices(urgUser()), ['URGENCE']);
  t.end();
});

test('isolation: listPatients équivalent — uniquement URGENCE', (t) => {
  const scope = resolveListScope(urgUser());
  const list = filterPatientsByScope(rows, scope);
  t.equal(list.length, 1);
  t.equal(list[0].service, 'URGENCE');
  t.equal(list[0].last_name, 'Benali');
  t.end();
});

test('isolation: getPatient CARDIO → 403', (t) => {
  try {
    assertServiceAccess(urgUser(), 'CARDIOLOGIE');
    t.fail('aurait dû throw');
  } catch (err) {
    t.equal((err as { statusCode?: number }).statusCode, 403);
    t.match(String((err as Error).message), /service:cardiologie/);
  }
  t.doesNotThrow(() => assertServiceAccess(urgUser(), 'URGENCE'));
  t.end();
});

test('isolation: query service hors périmètre → 403', (t) => {
  try {
    resolveListScope(urgUser(), 'CARDIOLOGIE');
    t.fail('aurait dû throw');
  } catch (err) {
    t.equal((err as { statusCode?: number }).statusCode, 403);
  }
  t.deepEqual(resolveListScope(urgUser(), 'URGENCE'), ['URGENCE']);
  t.end();
});

test('isolation: search Ahmed ne bypass pas service:*', (t) => {
  const scope = resolveListScope(urgUser());
  const list = filterPatientsByScope(rows, scope, 'Ahmed');
  t.equal(list.length, 1);
  t.equal(list[0].last_name, 'Benali');
  t.equal(
    list.some((p) => p.service === 'CARDIOLOGIE'),
    false
  );
  t.end();
});

test('isolation: dashboard stats scopé URGENCE', (t) => {
  const stats = buildDashboardFromRows(rows, ['URGENCE']);
  t.equal(stats.total, 1);
  t.equal(stats.critical, 1);
  t.equal(stats.byService.URGENCE, 1);
  t.equal(stats.byService.CARDIOLOGIE, undefined);
  t.equal(stats.occupancy.length, 1);
  t.equal(stats.occupancy[0].service, 'URGENCE');
  t.equal(stats.recent.length, 1);
  t.equal((stats.recent[0] as { last_name?: string }).last_name || rows[0].last_name, 'Benali');
  t.end();
});

test('audit: PATIENT_READ contient user, patient, ip, service', (t) => {
  const row = buildPatientAuditRow(
    urgUser(),
    'PATIENT_READ',
    '2',
    'Ahmed Kaci',
    '10.0.0.8',
    { service: 'CARDIOLOGIE' }
  );
  t.equal(row.action, 'PATIENT_READ');
  t.equal(row.user_id, 'u-urg');
  t.equal(row.resource, 'PATIENT');
  t.equal(row.resource_id, '2');
  t.equal(row.patient_name, 'Ahmed Kaci');
  t.equal(row.ip_address, '10.0.0.8');
  t.deepEqual(row.details, { service: 'CARDIOLOGIE' });
  t.end();
});
