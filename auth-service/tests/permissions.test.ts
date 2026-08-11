import {
  hasPermission,
  assertPermission,
  isValidServiceToken,
  ROLE_PERMISSIONS,
  type InternalUser,
} from '@centaur/shared';

// Mock process env
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

describe('RBAC permissions', () => {
  const admin: InternalUser = {
    id: '1',
    email: 'a@test.com',
    role: 'ADMIN',
    permissions: ROLE_PERMISSIONS.ADMIN,
    firstName: 'A',
    lastName: 'Dmin',
  };

  const secretary: InternalUser = {
    id: '2',
    email: 's@test.com',
    role: 'SECRETAIRE',
    permissions: ROLE_PERMISSIONS.SECRETAIRE,
    firstName: 'S',
    lastName: 'Ec',
  };

  it('admin can delete patients', () => {
    expect(hasPermission(admin, 'patients:delete')).toBe(true);
    expect(() => assertPermission(admin, 'patients:delete')).not.toThrow();
  });

  it('secretary cannot delete patients', () => {
    expect(hasPermission(secretary, 'patients:delete')).toBe(false);
    expect(() => assertPermission(secretary, 'patients:delete')).toThrow(/Forbidden/);
  });

  it('medecin can update but not delete', () => {
    const med: InternalUser = {
      id: '3',
      email: 'm@test.com',
      role: 'MEDECIN',
      permissions: ROLE_PERMISSIONS.MEDECIN,
      firstName: 'M',
      lastName: 'Ed',
    };
    expect(hasPermission(med, 'patients:update')).toBe(true);
    expect(hasPermission(med, 'patients:delete')).toBe(false);
  });

  it('direction can read audit', () => {
    const dir: InternalUser = {
      id: '4',
      email: 'd@test.com',
      role: 'DIRECTION',
      permissions: ROLE_PERMISSIONS.DIRECTION,
      firstName: 'D',
      lastName: 'Ir',
    };
    expect(hasPermission(dir, 'audit:read')).toBe(true);
    expect(hasPermission(dir, 'patients:create')).toBe(false);
  });
});

describe('Service token', () => {
  it('accepts valid token', () => {
    expect(isValidServiceToken('test-service-token')).toBe(true);
  });

  it('rejects invalid token', () => {
    expect(isValidServiceToken('wrong')).toBe(false);
    expect(isValidServiceToken(null)).toBe(false);
  });
});
