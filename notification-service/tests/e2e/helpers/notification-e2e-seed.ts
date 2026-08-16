import type { Permission } from '@centaur/shared';
import type { NotifDbState } from '../../helpers/notif-db-mock';

/** Explicit service scoping — not the production MEDECIN seed with all service:*. */
export const PERMS_URGENCE: Permission[] = [
  'prescriptions:read',
  'prescriptions:create',
  'prescriptions:cancel',
  'patients:read',
  'patients:create',
  'patients:update',
  'medical_history:read',
  'notifications:read',
  'service:urgence',
];

export const PERMS_CARDIO: Permission[] = [
  'prescriptions:read',
  'prescriptions:create',
  'prescriptions:cancel',
  'patients:read',
  'patients:create',
  'patients:update',
  'medical_history:read',
  'notifications:read',
  'service:cardiologie',
];

export const PERMS_DIRECTION: Permission[] = [
  'notifications:read',
  'notifications:read_all',
  'prescriptions:read',
  'patients:read',
  'service:urgence',
  'service:cardiologie',
];

export const PERMS_NO_NOTIF: Permission[] = [
  'prescriptions:read',
  'prescriptions:create',
  'service:urgence',
];

export const USERS = {
  a: {
    id: 'u-med-a',
    email: 'a.urgence@test.com',
    role: 'MEDECIN',
    permissions: PERMS_URGENCE,
    firstName: 'Amine',
    lastName: 'Urgence',
  },
  b: {
    id: 'u-med-b',
    email: 'b.urgence@test.com',
    role: 'MEDECIN',
    permissions: PERMS_URGENCE,
    firstName: 'Bilel',
    lastName: 'Urgence',
  },
  c: {
    id: 'u-med-c',
    email: 'c.cardio@test.com',
    role: 'MEDECIN',
    permissions: PERMS_CARDIO,
    firstName: 'Chahine',
    lastName: 'Cardio',
  },
  dir: {
    id: 'u-dir',
    email: 'dir@test.com',
    role: 'DIRECTION',
    permissions: PERMS_DIRECTION,
    firstName: 'Dina',
    lastName: 'Dir',
  },
  noPerm: {
    id: 'u-noperm',
    email: 'noperm@test.com',
    role: 'MEDECIN',
    permissions: PERMS_NO_NOTIF,
    firstName: 'No',
    lastName: 'Perm',
  },
} as const;

export function notificationE2eSeed(): Partial<NotifDbState> {
  const permissions: Array<{ id: string; code: Permission }> = [
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
    users: [
      {
        id: USERS.a.id,
        email: USERS.a.email,
        first_name: USERS.a.firstName,
        last_name: USERS.a.lastName,
        is_active: true,
        role_id: 'r-urg',
      },
      {
        id: USERS.b.id,
        email: USERS.b.email,
        first_name: USERS.b.firstName,
        last_name: USERS.b.lastName,
        is_active: true,
        role_id: 'r-urg',
      },
      {
        id: USERS.c.id,
        email: USERS.c.email,
        first_name: USERS.c.firstName,
        last_name: USERS.c.lastName,
        is_active: true,
        role_id: 'r-card',
      },
      {
        id: USERS.dir.id,
        email: USERS.dir.email,
        first_name: USERS.dir.firstName,
        last_name: USERS.dir.lastName,
        is_active: true,
        role_id: 'r-dir',
      },
      {
        id: USERS.noPerm.id,
        email: USERS.noPerm.email,
        first_name: USERS.noPerm.firstName,
        last_name: USERS.noPerm.lastName,
        is_active: true,
        role_id: 'r-urg',
      },
      {
        id: 'u-inactive',
        email: 'inactive@test.com',
        first_name: 'Ina',
        last_name: 'Ctif',
        is_active: false,
        role_id: 'r-urg',
      },
    ],
    roles,
    permissions,
    role_permissions: [
      ...link('r-urg', ['p-nread', 'p-rx', 'p-pat', 'p-urg']),
      ...link('r-card', ['p-nread', 'p-rx', 'p-pat', 'p-card']),
      ...link('r-dir', ['p-nread', 'p-nall', 'p-rx', 'p-pat', 'p-urg', 'p-card']),
    ],
    patients: [
      {
        id: 'p-urg-1',
        patient_code: 'PT-000124',
        first_name: 'Ahmed',
        last_name: 'Benali',
        hospitalization_date: '2026-08-11',
        service: 'URGENCE',
        status: 'CRITICAL',
      },
      {
        id: 'p-cardio-1',
        patient_code: 'PT-000126',
        first_name: 'Karim',
        last_name: 'Haddad',
        hospitalization_date: '2026-08-09',
        service: 'CARDIOLOGIE',
        status: 'STABLE',
      },
    ],
    medical_records: [
      { id: 'mr-1', patient_id: 'p-urg-1', service: 'URGENCE' },
      { id: 'mr-3', patient_id: 'p-cardio-1', service: 'CARDIOLOGIE' },
    ],
    emergency_records: [
      {
        id: 'er-1',
        medical_record_id: 'mr-1',
        arrival_time: '14:30:00',
        triage_level: '1',
        initial_severity: 'Critical',
      },
    ],
    notifications: [],
    prescriptions: [],
    prescription_items: [],
    medical_history: [],
    audit_logs: [],
  };
}

export function prescriptionPayload(patientId = 'p-urg-1') {
  return {
    patientId,
    prescribedAt: '2026-08-16T09:00:00.000Z',
    notes: 'Antalgique',
    medications: [
      {
        name: 'Ibuprofène',
        dosage: '400mg',
        frequency: '2x/jour',
        duration: '3 jours',
      },
    ],
  };
}

export function urgencePatientPayload() {
  return {
    firstName: 'Nour',
    lastName: 'Khelifi',
    hospitalizationDate: '2026-08-16',
    service: 'URGENCE' as const,
    status: 'STABLE',
    specialty: {
      arrivalTime: '09:15',
      triageLevel: '3',
      initialSeverity: 'Stable',
    },
  };
}
