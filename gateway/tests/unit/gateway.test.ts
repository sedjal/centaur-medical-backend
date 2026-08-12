/**
 * UNIT — gateway headers (tape)
 */
process.env.SERVICE_TOKEN = 'gw-test-token';
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

import test from 'tape';
import { hasPermission, type JwtPayload } from '@centaur/shared';
import { buildIdentityHeaders } from '../../src/proxy';

test('gateway: injecte toujours x-service-token', (t) => {
  const headers = buildIdentityHeaders();
  t.equal(headers['x-service-token'], 'gw-test-service-token-16+');
  t.end();
});

test('gateway: injecte l’identité JWT', (t) => {
  const user: JwtPayload = {
    sub: 'uid-1',
    email: 'sedjalkhouloud@gmail.com',
    role: 'ADMIN',
    permissions: ['patients:read', 'patients:delete'],
    firstName: 'Khouloud',
    lastName: 'Sedjal',
  };
  const headers = buildIdentityHeaders(user);
  t.equal(headers['x-user-id'], 'uid-1');
  t.equal(headers['x-user-role'], 'ADMIN');
  t.ok(JSON.parse(headers['x-user-permissions']).includes('patients:delete'));
  t.end();
});

test('gateway: RBAC secrétaire sans delete', (t) => {
  const user: JwtPayload = {
    sub: 'u',
    email: 'x@y.com',
    role: 'SECRETAIRE',
    permissions: ['patients:read', 'patients:create'],
    firstName: 'A',
    lastName: 'B',
  };
  t.equal(hasPermission(user, 'patients:delete'), false);
  t.end();
});
