/**
 * INTÉGRATION HTTP — GET /api/auth/me
 * Démarre un mini-gateway + vrai requireAuth (purpose ACCESS).
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.NODE_ENV = 'test';
process.env.SERVICE_TOKEN = 'gw-test-service-token-16+';

import test from 'tape';
import { signToken, type JwtPayload } from '@centaur/shared';
import { createTestGateway, listen, httpJson } from './test-app';

function payload(purpose?: JwtPayload['purpose'], permissions: JwtPayload['permissions'] = ['patients:read']): JwtPayload {
  return {
    sub: 'u1',
    email: 'doctor@test.com',
    role: 'MEDECIN',
    permissions,
    firstName: 'John',
    lastName: 'Doe',
    purpose,
  };
}

test('intégration /api/auth/me', async (t) => {
  const proxyFn = async (_b: string, _m: string, _p: string, opts?: { user?: JwtPayload }) => ({
    status: 200,
    data: { id: opts?.user?.sub, email: opts?.user?.email, role: opts?.user?.role },
  });

  const app = createTestGateway(proxyFn);
  const { port, close } = await listen(app);

  t.test('ACCESS → 200', async (st) => {
    const token = signToken(payload('ACCESS'), '5m');
    const res = await httpJson(port, 'GET', '/api/auth/me', { token });
    st.equal(res.status, 200);
    st.equal((res.data as { email: string }).email, 'doctor@test.com');
    st.end();
  });

  t.test('sans token → 401', async (st) => {
    const res = await httpJson(port, 'GET', '/api/auth/me');
    st.equal(res.status, 401);
    st.end();
  });

  t.test('MFA token → 401', async (st) => {
    const token = signToken(payload('MFA'), '10m');
    const res = await httpJson(port, 'GET', '/api/auth/me', { token });
    st.equal(res.status, 401);
    st.end();
  });

  t.test('PASSWORD_RESET token → 401', async (st) => {
    const token = signToken(payload('PASSWORD_RESET'), '15m');
    const res = await httpJson(port, 'GET', '/api/auth/me', { token });
    st.equal(res.status, 401);
    st.end();
  });

  t.test('CHANGE_PASSWORD token → 401', async (st) => {
    const token = signToken(payload('CHANGE_PASSWORD'), '15m');
    const res = await httpJson(port, 'GET', '/api/auth/me', { token });
    st.equal(res.status, 401);
    st.end();
  });

  t.test('JWT sans purpose → 401', async (st) => {
    const p = payload(undefined);
    delete p.purpose;
    const token = signToken(p, '5m');
    const res = await httpJson(port, 'GET', '/api/auth/me', { token });
    st.equal(res.status, 401);
    st.end();
  });

  t.teardown(async () => {
    await close();
  });
  t.end();
});
