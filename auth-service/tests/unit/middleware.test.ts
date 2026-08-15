/**
 * UNIT — shared middleware auth (requireServiceToken, readInternalUser)
 */
import test from 'tape';
import {
  requireServiceToken,
  readInternalUser,
  INTERNAL_HEADERS,
} from '@centaur/shared';

process.env.SERVICE_TOKEN = 'test-service-token';
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

test('requireServiceToken: valide / absent / invalide', (t) => {
  t.doesNotThrow(() =>
    requireServiceToken({ [INTERNAL_HEADERS.SERVICE_TOKEN]: 'test-service-token' })
  );
  t.throws(() => requireServiceToken({}), /Invalid or missing service token/);
  t.throws(
    () => requireServiceToken({ [INTERNAL_HEADERS.SERVICE_TOKEN]: 'wrong' }),
    /Invalid or missing service token/
  );
  t.end();
});

test('readInternalUser: headers complets', (t) => {
  const user = readInternalUser({
    [INTERNAL_HEADERS.SERVICE_TOKEN]: 'test-service-token',
    [INTERNAL_HEADERS.USER_ID]: 'u1',
    [INTERNAL_HEADERS.USER_EMAIL]: 'a@test.com',
    [INTERNAL_HEADERS.USER_ROLE]: 'MEDECIN',
    [INTERNAL_HEADERS.USER_PERMISSIONS]: JSON.stringify(['patients:read']),
    [INTERNAL_HEADERS.USER_FIRST_NAME]: 'A',
    [INTERNAL_HEADERS.USER_LAST_NAME]: 'B',
  });
  t.equal(user.id, 'u1');
  t.equal(user.permissions[0], 'patients:read');
  t.end();
});

test('readInternalUser: identity manquante → 401', (t) => {
  t.throws(
    () =>
      readInternalUser({
        [INTERNAL_HEADERS.SERVICE_TOKEN]: 'test-service-token',
      }),
    /Missing internal user identity/
  );
  t.end();
});
