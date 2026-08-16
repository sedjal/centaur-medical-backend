/**
 * UNIT — client notifications métier (fire-and-forget)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import {
  notifyBusinessEvent,
  patientStaffLabel,
  __setBusinessNotifyDispatcher,
  __resetBusinessNotifyDispatcher,
} from '../../src/business-notify';

test('patientStaffLabel', (t) => {
  t.deepEqual(patientStaffLabel({ first_name: 'Ahmed', last_name: 'Benali', patient_code: 'PT-1' }), {
    patientName: 'BENALI Ahmed',
    patientCode: 'PT-1',
  });
  t.end();
});

test('notifyBusinessEvent: n’explose pas si le dispatcher échoue', async (t) => {
  __setBusinessNotifyDispatcher(async () => {
    throw new Error('down');
  });
  try {
    notifyBusinessEvent({
      kind: 'PATIENT_UPDATED',
      actorId: 'u1',
      patientId: 'p1',
      service: 'URGENCE',
    });
    await new Promise((r) => setTimeout(r, 10));
    t.pass('caught');
  } finally {
    __resetBusinessNotifyDispatcher();
    t.end();
  }
});

test('notifyBusinessEvent: no-op en NODE_ENV=test', async (t) => {
  const orig = global.fetch;
  let called = false;
  global.fetch = (async () => {
    called = true;
    return { ok: true, text: async () => '' } as Response;
  }) as typeof fetch;
  try {
    __resetBusinessNotifyDispatcher();
    notifyBusinessEvent({
      kind: 'PRESCRIPTION_CREATED',
      actorId: 'u1',
      patientId: 'p1',
      service: 'URGENCE',
    });
    await new Promise((r) => setTimeout(r, 15));
    t.equal(called, false);
  } finally {
    global.fetch = orig;
    t.end();
  }
});

test('notifyBusinessEvent: HTTP interne si BUSINESS_NOTIFICATIONS=1', async (t) => {
  process.env.BUSINESS_NOTIFICATIONS = '1';
  const orig = global.fetch;
  const calls: Array<{ url: string; token?: string }> = [];
  global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      token: init?.headers ? String((init.headers as Record<string, string>)['x-service-token']) : '',
    });
    return { ok: true, text: async () => '{"created":1}' } as Response;
  }) as typeof fetch;
  try {
    __resetBusinessNotifyDispatcher();
    notifyBusinessEvent({
      kind: 'PATIENT_CREATED',
      actorId: 'u1',
      patientId: 'p1',
      service: 'GENERAL',
    });
    await new Promise((r) => setTimeout(r, 20));
    t.equal(calls.length, 1);
    t.match(calls[0].url, /\/internal\/notifications\/events/);
    t.ok(calls[0].token);
  } finally {
    delete process.env.BUSINESS_NOTIFICATIONS;
    global.fetch = orig;
    __resetBusinessNotifyDispatcher();
    t.end();
  }
});
