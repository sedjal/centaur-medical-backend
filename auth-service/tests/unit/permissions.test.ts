/**
 * UNIT — RBAC + service token (tape)
 */
import test from 'tape';
import {
  hasPermission,
  assertPermission,
  isValidServiceToken,
  ROLE_PERMISSIONS,
  type InternalUser,
} from '@centaur/shared';

process.env.SERVICE_TOKEN = 'test-service-token';
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

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

test('RBAC: admin peut supprimer patients', (t) => {
  t.equal(hasPermission(admin, 'patients:delete'), true);
  t.doesNotThrow(() => assertPermission(admin, 'patients:delete'));
  t.end();
});

test('RBAC: secrétaire ne peut pas supprimer', (t) => {
  t.equal(hasPermission(secretary, 'patients:delete'), false);
  t.throws(() => assertPermission(secretary, 'patients:delete'), /Forbidden/);
  t.end();
});

test('RBAC: médecin update sans delete', (t) => {
  const med: InternalUser = {
    id: '3',
    email: 'm@test.com',
    role: 'MEDECIN',
    permissions: ROLE_PERMISSIONS.MEDECIN,
    firstName: 'M',
    lastName: 'Ed',
  };
  t.equal(hasPermission(med, 'patients:update'), true);
  t.equal(hasPermission(med, 'patients:delete'), false);
  t.end();
});

test('Service token: valide / invalide', (t) => {
  t.equal(isValidServiceToken('test-service-token'), true);
  t.equal(isValidServiceToken('wrong'), false);
  t.equal(isValidServiceToken(null), false);
  t.end();
});
