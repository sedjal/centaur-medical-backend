/**
 * UNIT — gateway headers (tape)
 */
process.env.SERVICE_TOKEN = 'gw-test-token';
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';

import test from 'tape';
import sinon from 'sinon';
import axios from 'axios';
import { type JwtPayload } from '@centaur/shared';
import { buildIdentityHeaders, hasPermission, proxy } from '../../src/proxy';

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
  t.equal(headers['x-session-ver'], '0');
  const withSv = buildIdentityHeaders({ ...user, sv: 3 });
  t.equal(withSv['x-session-ver'], '3');
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
  t.equal(hasPermission({ ...user, permissions: [] }, 'patients:read'), false);
  t.end();
});

test('proxy: transmet method, query, body, ip', async (t) => {
  const user: JwtPayload = {
    sub: 'uid-1',
    email: 'doc@test.com',
    role: 'MEDECIN',
    permissions: ['patients:read'],
    firstName: 'A',
    lastName: 'B',
  };
  const stub = sinon.stub(axios, 'request').resolves({
    status: 201,
    data: { id: 'rx-1' },
  } as never);

  try {
    const result = await proxy('http://127.0.0.1:3002', 'POST', '/prescriptions', {
      user,
      body: { patientId: 'p1' },
      query: { service: 'URGENCE', search: '', skip: undefined },
      ip: '127.0.0.1',
    });
    t.equal(result.status, 201);
    t.equal((result.data as { id: string }).id, 'rx-1');
    t.equal(stub.calledOnce, true);
    const cfg = stub.firstCall.args[0] as {
      method: string;
      url: string;
      headers: Record<string, string>;
      data: unknown;
    };
    t.equal(cfg.method, 'POST');
    t.match(cfg.url, /service=URGENCE/);
    t.equal(/search=/.test(cfg.url), false);
    t.equal(cfg.headers['x-forwarded-for'], '127.0.0.1');
    t.equal(cfg.headers['x-user-id'], 'uid-1');
    t.deepEqual(cfg.data, { patientId: 'p1' });
  } finally {
    stub.restore();
    t.end();
  }
});

test('proxy: sans query ni ip', async (t) => {
  const stub = sinon.stub(axios, 'request').resolves({ status: 200, data: [] } as never);
  try {
    const result = await proxy('http://127.0.0.1:3002', 'GET', '/patients');
    t.equal(result.status, 200);
    const cfg = stub.firstCall.args[0] as { headers: Record<string, string>; url: string };
    t.equal(cfg.headers['x-forwarded-for'], undefined);
    t.equal(cfg.url, 'http://127.0.0.1:3002/patients');
  } finally {
    stub.restore();
    t.end();
  }
});
