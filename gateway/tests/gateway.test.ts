import { hasPermission, type JwtPayload } from '@centaur/shared';
import { buildIdentityHeaders } from '../src/proxy';

process.env.SERVICE_TOKEN = 'gw-test-token';
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

describe('Gateway proxy headers', () => {
  it('always injects service token', () => {
    const headers = buildIdentityHeaders();
    expect(headers['x-service-token']).toBe('gw-test-token');
  });

  it('injects user identity after JWT', () => {
    const user: JwtPayload = {
      sub: 'uid-1',
      email: 'sedjalkhouloud@gmail.com',
      role: 'ADMIN',
      permissions: ['patients:read', 'patients:delete'],
      firstName: 'Khouloud',
      lastName: 'Sedjal',
    };
    const headers = buildIdentityHeaders(user);
    expect(headers['x-user-id']).toBe('uid-1');
    expect(headers['x-user-role']).toBe('ADMIN');
    expect(JSON.parse(headers['x-user-permissions'])).toContain('patients:delete');
  });

  it('checks RBAC on gateway for delete', () => {
    const user: JwtPayload = {
      sub: 'u',
      email: 'x@y.com',
      role: 'SECRETAIRE',
      permissions: ['patients:read', 'patients:create'],
      firstName: 'A',
      lastName: 'B',
    };
    expect(hasPermission(user, 'patients:delete')).toBe(false);
  });
});
