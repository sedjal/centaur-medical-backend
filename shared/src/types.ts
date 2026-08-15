export type SystemRoleName = 'ADMIN' | 'DIRECTION' | 'MEDECIN' | 'SECRETAIRE';
/** Role name stored in DB / JWT (system roles + custom). */
export type RoleName = SystemRoleName | (string & {});

export const SYSTEM_ROLE_NAMES: SystemRoleName[] = [
  'ADMIN',
  'DIRECTION',
  'MEDECIN',
  'SECRETAIRE',
];

export type ServiceType = 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE';

export type Permission =
  | 'patients:read'
  | 'patients:create'
  | 'patients:update'
  | 'patients:delete'
  | 'prescriptions:read'
  | 'prescriptions:create'
  | 'prescriptions:cancel'
  | 'medical_history:read'
  | 'notifications:read'
  | 'notifications:create'
  | 'notifications:read_all'
  | 'notifications:cancel'
  | 'service:general'
  | 'service:urgence'
  | 'service:oncologie'
  | 'service:cardiologie'
  | 'users:read'
  | 'users:create'
  | 'users:update'
  | 'users:delete'
  | 'roles:manage'
  | 'audit:read'
  | 'reports:read';

export const ALL_PERMISSIONS: Permission[] = [
  'patients:read',
  'patients:create',
  'patients:update',
  'patients:delete',
  'prescriptions:read',
  'prescriptions:create',
  'prescriptions:cancel',
  'medical_history:read',
  'notifications:read',
  'notifications:create',
  'notifications:read_all',
  'notifications:cancel',
  'service:general',
  'service:urgence',
  'service:oncologie',
  'service:cardiologie',
  'users:read',
  'users:create',
  'users:update',
  'users:delete',
  'roles:manage',
  'audit:read',
  'reports:read',
];

export interface JwtPayload {
  sub: string;
  email: string;
  role: RoleName;
  permissions: Permission[];
  firstName: string;
  lastName: string;
  /** Restricts short-lived tokens to a single flow. */
  purpose?: 'ACCESS' | 'MFA' | 'CHANGE_PASSWORD' | 'PASSWORD_RESET';
}

export interface InternalUser {
  id: string;
  email: string;
  role: RoleName;
  permissions: Permission[];
  firstName: string;
  lastName: string;
}

export const ALL_SERVICE_PERMISSIONS: Permission[] = [
  'service:general',
  'service:urgence',
  'service:oncologie',
  'service:cardiologie',
];

export const ROLE_PERMISSIONS: Record<SystemRoleName, Permission[]> = {
  ADMIN: [
    'patients:read',
    'patients:create',
    'patients:update',
    'patients:delete',
    'prescriptions:read',
    'prescriptions:create',
    'prescriptions:cancel',
    'medical_history:read',
    'notifications:read',
    'notifications:create',
    'notifications:read_all',
    'notifications:cancel',
    ...ALL_SERVICE_PERMISSIONS,
    'users:read',
    'users:create',
    'users:update',
    'users:delete',
    'roles:manage',
    'audit:read',
    'reports:read',
  ],
  DIRECTION: [
    'patients:read',
    'prescriptions:read',
    'medical_history:read',
    'notifications:read',
    'notifications:create',
    'notifications:read_all',
    'notifications:cancel',
    ...ALL_SERVICE_PERMISSIONS,
    'reports:read',
    'audit:read',
  ],
  MEDECIN: [
    'patients:read',
    'patients:create',
    'patients:update',
    'prescriptions:read',
    'prescriptions:create',
    'prescriptions:cancel',
    'medical_history:read',
    'notifications:read',
    'notifications:create',
    'notifications:cancel',
    ...ALL_SERVICE_PERMISSIONS,
  ],
  SECRETAIRE: [
    'patients:read',
    'patients:create',
    'prescriptions:read',
    'medical_history:read',
    'notifications:read',
    'notifications:create',
    ...ALL_SERVICE_PERMISSIONS,
  ],
};

export const SERVICE_PERMISSION_MAP: Record<ServiceType, Permission> = {
  GENERAL: 'service:general',
  URGENCE: 'service:urgence',
  ONCOLOGIE: 'service:oncologie',
  CARDIOLOGIE: 'service:cardiologie',
};
