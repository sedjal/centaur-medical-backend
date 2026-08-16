/**
 * UNIT — processScheduledNotifications (PENDING → SENT)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { processScheduledNotifications } from '../../src/notification.service';
import {
  defaultNotifSeed,
  installNotifDbMock,
  restoreNotifDbMock,
  type Row,
} from '../helpers/notif-db-mock';

function seedRow(overrides: Row): Row {
  const now = new Date().toISOString();
  return {
    recipient_id: 'u-sec',
    patient_id: null,
    type: 'REMINDER',
    title: 'Rappel',
    message: 'Échéance',
    sent_at: null,
    read_at: null,
    status: 'PENDING',
    created_by: 'u-med',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

test('worker: PENDING futur reste PENDING', async (t) => {
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({
        id: 'n-future',
        scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ],
  });
  try {
    const result = await processScheduledNotifications();
    t.equal(result.found, 0);
    t.equal(result.processed, 0);
    t.equal(state.notifications[0].status, 'PENDING');
    t.equal(state.notifications[0].sent_at, null);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('worker: PENDING à échéance → SENT + sent_at', async (t) => {
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({
        id: 'n-due',
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    ],
  });
  try {
    const result = await processScheduledNotifications();
    t.equal(result.found, 1);
    t.equal(result.processed, 1);
    t.equal(result.failed, 0);
    t.equal(state.notifications[0].status, 'SENT');
    t.ok(state.notifications[0].sent_at);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('worker: sans scheduled_at → non traité', async (t) => {
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({
        id: 'n-null',
        scheduled_at: null,
        status: 'PENDING',
      }),
    ],
  });
  try {
    const result = await processScheduledNotifications();
    t.equal(result.found, 0);
    t.equal(state.notifications[0].status, 'PENDING');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('worker: CANCELLED reste CANCELLED', async (t) => {
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({
        id: 'n-cancel',
        status: 'CANCELLED',
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    ],
  });
  try {
    const result = await processScheduledNotifications();
    t.equal(result.found, 0);
    t.equal(state.notifications[0].status, 'CANCELLED');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('worker: READ reste READ', async (t) => {
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({
        id: 'n-read',
        status: 'READ',
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
        sent_at: new Date(Date.now() - 50_000).toISOString(),
        read_at: new Date().toISOString(),
      }),
    ],
  });
  try {
    const result = await processScheduledNotifications();
    t.equal(result.found, 0);
    t.equal(state.notifications[0].status, 'READ');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('worker: déjà SENT → non retraité', async (t) => {
  const sentAt = new Date(Date.now() - 10_000).toISOString();
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({
        id: 'n-sent',
        status: 'SENT',
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
        sent_at: sentAt,
      }),
    ],
  });
  try {
    const result = await processScheduledNotifications();
    t.equal(result.found, 0);
    t.equal(result.processed, 0);
    t.equal(state.notifications[0].status, 'SENT');
    t.equal(state.notifications[0].sent_at, sentAt);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('worker: plusieurs PENDING dus sont tous traités', async (t) => {
  const past = new Date(Date.now() - 120_000).toISOString();
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({ id: 'n-a', scheduled_at: past }),
      seedRow({ id: 'n-b', scheduled_at: past, title: 'B' }),
      seedRow({
        id: 'n-future',
        scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ],
  });
  try {
    const result = await processScheduledNotifications();
    t.equal(result.found, 2);
    t.equal(result.processed, 2);
    t.equal(state.notifications.find((n) => n.id === 'n-a')?.status, 'SENT');
    t.equal(state.notifications.find((n) => n.id === 'n-b')?.status, 'SENT');
    t.equal(state.notifications.find((n) => n.id === 'n-future')?.status, 'PENDING');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test("worker: erreur sur une notification n'arrête pas les autres", async (t) => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const { state } = installNotifDbMock(
    {
      ...defaultNotifSeed(),
      notifications: [
        seedRow({ id: 'n-ok-1', scheduled_at: past, title: 'OK1' }),
        seedRow({ id: 'n-bad', scheduled_at: past, title: 'BAD' }),
        seedRow({ id: 'n-ok-2', scheduled_at: past, title: 'OK2' }),
      ],
    },
    { failUpdateOn: 'n-bad' }
  );
  try {
    const result = await processScheduledNotifications();
    t.equal(result.found, 3);
    t.equal(result.processed, 2);
    t.equal(result.failed, 1);
    t.equal(state.notifications.find((n) => n.id === 'n-ok-1')?.status, 'SENT');
    t.equal(state.notifications.find((n) => n.id === 'n-bad')?.status, 'PENDING');
    t.equal(state.notifications.find((n) => n.id === 'n-ok-2')?.status, 'SENT');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('worker: idempotence — second passage ne retraite pas', async (t) => {
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({
        id: 'n-once',
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    ],
  });
  try {
    const first = await processScheduledNotifications();
    t.equal(first.processed, 1);
    const second = await processScheduledNotifications();
    t.equal(second.found, 0);
    t.equal(second.processed, 0);
    t.equal(state.notifications[0].status, 'SENT');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('worker: concurrence — une seule claim SENT', async (t) => {
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({
        id: 'n-race',
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    ],
  });
  try {
    const [a, b] = await Promise.all([
      processScheduledNotifications(),
      processScheduledNotifications(),
    ]);
    t.equal(a.processed + b.processed, 1);
    t.equal(state.notifications[0].status, 'SENT');
    const sentAts = state.notifications.filter((n) => n.status === 'SENT');
    t.equal(sentAts.length, 1);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('worker: timezone ISO avec offset +01:00 déjà due', async (t) => {
  const now = new Date('2026-08-15T21:30:00.000Z');
  const { state } = installNotifDbMock({
    ...defaultNotifSeed(),
    notifications: [
      seedRow({
        id: 'n-tz',
        // 22:00 +01:00 = 21:00 UTC — due relative to 21:30 UTC
        scheduled_at: new Date('2026-08-15T22:00:00+01:00').toISOString(),
      }),
    ],
  });
  try {
    const result = await processScheduledNotifications({ now });
    t.equal(result.processed, 1);
    t.equal(state.notifications[0].status, 'SENT');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});
