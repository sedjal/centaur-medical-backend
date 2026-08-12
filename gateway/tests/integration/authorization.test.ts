/**
 * INTÉGRATION HTTP — autorisation patients
 * 401 = pas authentifié | 403 = authentifié sans droit
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.NODE_ENV = 'test';
process.env.SERVICE_TOKEN = 'gw-test-service-token-16+';

import test from 'tape';
import { signToken, type JwtPayload } from '@centaur/shared';
import { createTestGateway, listen, httpJson } from './test-app';

function tokenFor(permissions: JwtPayload['permissions'], purpose: JwtPayload['purpose'] = 'ACCESS') {
  return signToken(
    {
      sub: 'u1',
      email: 'user@test.com',
      role: 'SECRETAIRE',
      permissions,
      firstName: 'A',
      lastName: 'B',
      purpose,
    },
    '5m'
  );
}

test('intégration GET /api/patients', async (t) => {
  const proxyFn = async () => ({ status: 200, data: [{ id: 'p1' }] });
  const app = createTestGateway(proxyFn);
  const { port, close } = await listen(app);

  t.test('ACCESS + patients:read → 200', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients', {
      token: tokenFor(['patients:read']),
    });
    st.equal(res.status, 200);
    st.end();
  });

  t.test('ACCESS sans permission → 403', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients', {
      token: tokenFor([]),
    });
    st.equal(res.status, 403);
    st.end();
  });

  t.test('sans token → 401', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients');
    st.equal(res.status, 401);
    st.end();
  });

  t.test('MFA token sur /patients → 401 (pas 403)', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients', {
      token: tokenFor(['patients:read'], 'MFA'),
    });
    st.equal(res.status, 401);
    st.end();
  });

  t.test('PASSWORD_RESET sur /patients → 401', async (st) => {
    const res = await httpJson(port, 'GET', '/api/patients', {
      token: tokenFor(['patients:read'], 'PASSWORD_RESET'),
    });
    st.equal(res.status, 401);
    st.end();
  });

  t.teardown(async () => {
    await close();
  });
  t.end();
});
