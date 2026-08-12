/**
 * INTÉGRATION HTTP — login (proxy mocké = auth-service)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.NODE_ENV = 'test';
process.env.SERVICE_TOKEN = 'gw-test-service-token-16+';

import test from 'tape';
import { createTestGateway, listen, httpJson, type ProxyFn } from './test-app';

test('intégration POST /api/auth/login', async (t) => {
  const proxyFn: ProxyFn = async (_b, _m, path, opts) => {
    const body = opts?.body as { email?: string; password?: string };
    if (path !== '/auth/login') return { status: 404, data: { error: 'not found' } };
    if (body?.email === 'doctor@test.com' && body?.password === 'CorrectPassword123') {
      return {
        status: 200,
        data: {
          status: 'OK',
          token: 'fake-access-jwt',
          user: { email: body.email, role: 'MEDECIN', permissions: ['patients:read'] },
        },
      };
    }
    // même message générique (anti-énumération)
    return { status: 401, data: { error: 'Invalid credentials' } };
  };

  const app = createTestGateway(proxyFn);
  const { port, close } = await listen(app);

  t.test('login valide → 200 + token', async (st) => {
    const res = await httpJson(port, 'POST', '/api/auth/login', {
      body: { email: 'doctor@test.com', password: 'CorrectPassword123' },
    });
    st.equal(res.status, 200);
    st.equal((res.data as { token: string }).token, 'fake-access-jwt');
    st.end();
  });

  t.test('mauvais password → 401', async (st) => {
    const res = await httpJson(port, 'POST', '/api/auth/login', {
      body: { email: 'doctor@test.com', password: 'WrongPassword' },
    });
    st.equal(res.status, 401);
    st.equal((res.data as { error: string }).error, 'Invalid credentials');
    st.end();
  });

  t.test('utilisateur inexistant → 401 (même message)', async (st) => {
    const res = await httpJson(port, 'POST', '/api/auth/login', {
      body: { email: 'unknown@test.com', password: 'whatever' },
    });
    st.equal(res.status, 401);
    st.equal((res.data as { error: string }).error, 'Invalid credentials');
    st.end();
  });

  t.test('body invalide → 400', async (st) => {
    const res = await httpJson(port, 'POST', '/api/auth/login', {
      body: { email: 'not-an-email', password: '' },
    });
    st.equal(res.status, 400);
    st.end();
  });

  t.teardown(async () => {
    await close();
  });
  t.end();
});
