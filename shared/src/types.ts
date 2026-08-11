export type RoleName = 'ADMIN' | 'DIRECTION' | 'MEDECIN' | 'SECRETAIRE';

export type ServiceType = 'GENERAL' | 'URGENCE' | 'ONCOLOGIE' | 'CARDIOLOGIE';

export type Permission =
  | 'patients:read'
  | 'patients:create'
  | 'patients:update'
  | 'patients:delete'
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

export interface JwtPayload {
  sub: string;
  email: string;
  role: RoleName;
  permissions: Permission[];
  firstName: string;
  lastName: string;
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

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  ADMIN: [
    'patients:read',
    'patients:create',
    'patients:update',
    'patients:delete',
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
    ...ALL_SERVICE_PERMISSIONS,
    'reports:read',
    'audit:read',
  ],
  MEDECIN: [
    'patients:read',
    'patients:create',
    'patients:update',
    ...ALL_SERVICE_PERMISSIONS,
  ],
  SECRETAIRE: [
    'patients:read',
    'patients:create',
    ...ALL_SERVICE_PERMISSIONS,
  ],
};

export const SERVICE_PERMISSION_MAP: Record<ServiceType, Permission> = {
  GENERAL: 'service:general',
  URGENCE: 'service:urgence',
  ONCOLOGIE: 'service:oncologie',
  CARDIOLOGIE: 'service:cardiologie',
};
