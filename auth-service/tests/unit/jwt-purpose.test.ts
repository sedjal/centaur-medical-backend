/**
 * UNIT — JWT purpose (tape)
 */
import test from 'tape';
import { signToken, verifyToken, type JwtPayload } from '@centaur/shared';

process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.NODE_ENV = 'test';

function basePayload(purpose: JwtPayload['purpose']): JwtPayload {
  return {
    sub: 'b0000001-0000-0000-0000-000000000001',
    email: 'sedjalkhouloud@gmail.com',
    role: 'ADMIN',
    permissions: [],
    firstName: 'Khouloud',
    lastName: 'Sedjal',
    purpose,
  };
}

test('JWT: signe et vérifie ACCESS', (t) => {
  const decoded = verifyToken(signToken(basePayload('ACCESS'), '5m'));
  t.equal(decoded.purpose, 'ACCESS');
  t.equal(decoded.email, 'sedjalkhouloud@gmail.com');
  t.end();
});

test('JWT: distingue MFA / CHANGE_PASSWORD / PASSWORD_RESET', (t) => {
  t.equal(verifyToken(signToken(basePayload('MFA'), '10m')).purpose, 'MFA');
  t.equal(verifyToken(signToken(basePayload('CHANGE_PASSWORD'), '15m')).purpose, 'CHANGE_PASSWORD');
  t.equal(verifyToken(signToken(basePayload('PASSWORD_RESET'), '15m')).purpose, 'PASSWORD_RESET');
  t.end();
});

test('JWT: rejette un token invalide', (t) => {
  t.throws(() => verifyToken('not.a.jwt'));
  t.end();
});
