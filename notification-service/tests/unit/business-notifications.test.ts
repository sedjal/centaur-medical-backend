/**
 * UNIT — notifications métier (règles destinataires + fan-out)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import type { Permission, ServiceType } from '@centaur/shared';
import {
  businessNotificationContent,
  dispatchBusinessNotification,
  isEligibleRecipient,
  notificationTypeForEvent,
  requiredDomainPermission,
  resolveRecipientIds,
  type BusinessNotificationEvent,
} from '../../src/business-notifications';
import {
  defaultNotifSeed,
  installNotifDbMock,
  restoreNotifDbMock,
} from '../helpers/notif-db-mock';

function event(
  overrides: Partial<BusinessNotificationEvent> = {}
): BusinessNotificationEvent {
  return {
    kind: 'PRESCRIPTION_CREATED',
    actorId: 'u-med',
    patientId: 'p-urg-1',
    patientName: 'BENALI Ahmed',
    patientCode: 'PT-000124',
    service: 'URGENCE',
    ...overrides,
  };
}

const urgRx: Permission[] = [
  'notifications:read',
  'prescriptions:read',
  'service:urgence',
];

test('business: labels + permissions par événement', (t) => {
  t.equal(requiredDomainPermission('PRESCRIPTION_CREATED'), 'prescriptions:read');
  t.equal(requiredDomainPermission('PRESCRIPTION_CANCELLED'), 'prescriptions:read');
  t.equal(requiredDomainPermission('PATIENT_UPDATED'), 'patients:read');
  t.equal(requiredDomainPermission('MEDICAL_HISTORY_RECORDED'), 'medical_history:read');
  t.equal(notificationTypeForEvent('PRESCRIPTION_CREATED'), 'PRESCRIPTION');
  t.equal(notificationTypeForEvent('PATIENT_UPDATED'), 'PATIENT');
  t.equal(notificationTypeForEvent('MEDICAL_HISTORY_RECORDED'), 'MEDICAL_HISTORY');
  const created = businessNotificationContent(event());
  t.equal(created.title, 'Nouvelle ordonnance créée');
  t.match(created.message, /BENALI Ahmed/);
  t.equal(businessNotificationContent(event({ kind: 'PRESCRIPTION_CANCELLED' })).title, 'Ordonnance annulée');
  t.equal(businessNotificationContent(event({ kind: 'PATIENT_UPDATED' })).title, 'Dossier patient modifié');
  t.equal(businessNotificationContent(event({ kind: 'PATIENT_CREATED' })).title, 'Nouveau patient admis');
  t.end();
});

test('business: éligibilité RBAC + service:* + pas de read_all + pas d’acteur', (t) => {
  const e = event();
  t.equal(isEligibleRecipient(urgRx, e, 'u-peer'), true);
  t.equal(isEligibleRecipient(urgRx, e, 'u-med'), false, 'acteur exclu');
  t.equal(
    isEligibleRecipient([...urgRx, 'notifications:read_all'], e, 'u-dir'),
    false,
    'Direction/Admin non bombardés'
  );
  t.equal(
    isEligibleRecipient(['notifications:read', 'prescriptions:read', 'service:cardiologie'], e, 'u-cardio'),
    false,
    'isolation service'
  );
  t.equal(
    isEligibleRecipient(['notifications:read', 'service:urgence'], e, 'u-no-rx'),
    false,
    'sans prescriptions:read'
  );
  t.equal(isEligibleRecipient([], e, 'u-peer'), false);
  t.end();
});

test('business: resolveRecipientIds fallback ROLE_PERMISSIONS (sec oui, admin non)', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    const ids = await resolveRecipientIds(event());
    t.deepEqual(ids.sort(), ['u-sec']);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

function scopedStaffSeed() {
  const perms: Array<{ id: string; code: Permission }> = [
    { id: 'p-nread', code: 'notifications:read' },
    { id: 'p-nall', code: 'notifications:read_all' },
    { id: 'p-rx', code: 'prescriptions:read' },
    { id: 'p-pat', code: 'patients:read' },
    { id: 'p-urg', code: 'service:urgence' },
    { id: 'p-card', code: 'service:cardiologie' },
  ];
  const roles = [
    { id: 'r-urg', name: 'STAFF_URGENCE' },
    { id: 'r-card', name: 'STAFF_CARDIO' },
    { id: 'r-dir', name: 'STAFF_DIRECTION' },
  ];
  const link = (roleId: string, permIds: string[]) =>
    permIds.map((permission_id) => ({ role_id: roleId, permission_id }));
  return {
    ...defaultNotifSeed(),
    users: [
      { id: 'u-actor', is_active: true, role_id: 'r-urg' },
      { id: 'u-urg-peer', is_active: true, role_id: 'r-urg' },
      { id: 'u-cardio', is_active: true, role_id: 'r-card' },
      { id: 'u-cardio-peer', is_active: true, role_id: 'r-card' },
      { id: 'u-dir', is_active: true, role_id: 'r-dir' },
      { id: 'u-inactive', is_active: false, role_id: 'r-urg' },
    ],
    roles,
    permissions: perms,
    role_permissions: [
      ...link('r-urg', ['p-nread', 'p-rx', 'p-pat', 'p-urg']),
      ...link('r-card', ['p-nread', 'p-rx', 'p-pat', 'p-card']),
      ...link('r-dir', ['p-nread', 'p-nall', 'p-rx', 'p-pat', 'p-urg', 'p-card']),
    ],
  };
}

test('business: isolation service — seule l’équipe URGENCE est notifiée', async (t) => {
  installNotifDbMock(scopedStaffSeed());
  try {
    const ids = await resolveRecipientIds(
      event({ actorId: 'u-actor', service: 'URGENCE' as ServiceType })
    );
    t.deepEqual(ids, ['u-urg-peer']);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('business: dispatch PRESCRIPTION_CREATED → SENT pour destinataires éligibles', async (t) => {
  const { state } = installNotifDbMock(scopedStaffSeed());
  try {
    const result = await dispatchBusinessNotification(
      event({ actorId: 'u-actor', patientId: 'p-urg-1', service: 'URGENCE' })
    );
    t.equal(result.created, 1);
    t.deepEqual(result.recipientIds, ['u-urg-peer']);
    t.equal(state.notifications.length, 1);
    t.equal(state.notifications[0].status, 'SENT');
    t.equal(state.notifications[0].type, 'PRESCRIPTION');
    t.equal(state.notifications[0].recipient_id, 'u-urg-peer');
    t.equal(state.notifications[0].created_by, 'u-actor');
    t.equal(state.notifications[0].patient_id, 'p-urg-1');
    t.match(String(state.notifications[0].title), /Nouvelle ordonnance/);
    t.equal(JSON.stringify(state.audit_logs[0].details || {}).includes('BENALI'), false);
    t.equal((state.audit_logs[0].details as { source?: string })?.source, 'BUSINESS_EVENT');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('business: dispatch PATIENT_UPDATED — pair du service, pas l’autre service', async (t) => {
  const { state } = installNotifDbMock(scopedStaffSeed());
  try {
    const result = await dispatchBusinessNotification({
      kind: 'PATIENT_UPDATED',
      actorId: 'u-cardio',
      patientId: 'p-cardio-1',
      service: 'CARDIOLOGIE',
    });
    t.deepEqual(result.recipientIds, ['u-cardio-peer']);
    t.equal(state.notifications[0].type, 'PATIENT');
    t.match(String(state.notifications[0].title), /Dossier patient modifié/);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('business: patient introuvable → 404', async (t) => {
  installNotifDbMock(scopedStaffSeed());
  try {
    await dispatchBusinessNotification(event({ patientId: 'missing' }));
    t.fail('expected 404');
  } catch (err) {
    t.equal((err as { statusCode?: number }).statusCode, 404);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});
