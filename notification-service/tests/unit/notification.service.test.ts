/**
 * UNIT — notification.service
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import { AppError, type InternalUser, type Permission } from '@centaur/shared';
import {
  createNotification,
  listNotifications,
  getNotification,
  markNotificationRead,
  cancelNotification,
} from '../../src/notification.service';
import {
  defaultNotifSeed,
  installNotifDbMock,
  restoreNotifDbMock,
} from '../helpers/notif-db-mock';

function mkUser(permissions: Permission[], id = 'u-med'): InternalUser {
  return {
    id,
    email: 'med@test.com',
    role: 'MEDECIN',
    permissions,
    firstName: 'Léa',
    lastName: 'Urg',
  };
}

const creator = (): InternalUser =>
  mkUser(
    [
      'notifications:read',
      'notifications:create',
      'notifications:cancel',
      'service:urgence',
    ],
    'u-med'
  );

const recipient = (): InternalUser =>
  mkUser(['notifications:read', 'service:urgence'], 'u-sec');

test('notifications: create immédiat → SENT + audit', async (t) => {
  const { state } = installNotifDbMock(defaultNotifSeed());
  try {
    const created = await createNotification(creator(), {
      recipientId: 'u-sec',
      type: 'GENERAL',
      title: 'Rappel staff',
      message: 'Réunion à 10h',
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    });
    t.equal(created.status, 'SENT');
    t.ok(created.sentAt);
    t.equal(state.notifications.length, 1);
    t.equal(state.audit_logs.length, 1);
    t.equal(state.audit_logs[0].action, 'NOTIFICATION_CREATED');
    t.equal(
      JSON.stringify(state.audit_logs[0].details || {}).includes('Réunion'),
      false
    );
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: scheduled futur → PENDING', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    const created = await createNotification(creator(), {
      recipientId: 'u-sec',
      type: 'REMINDER',
      title: 'Futur',
      message: 'Dans 1h',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    t.equal(created.status, 'PENDING');
    t.equal(created.sentAt, null);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: validation title/message/scheduledAt', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    try {
      await createNotification(creator(), {
        recipientId: 'u-sec',
        type: 'GENERAL',
        title: '  ',
        message: 'ok',
        scheduledAt: new Date().toISOString(),
      });
      t.fail('should throw');
    } catch (e) {
      t.equal((e as AppError).statusCode, 400);
    }
    try {
      await createNotification(creator(), {
        recipientId: 'u-sec',
        type: 'GENERAL',
        title: 'ok',
        message: 'ok',
        scheduledAt: 'not-a-date',
      });
      t.fail('should throw');
    } catch (e) {
      t.equal((e as AppError).statusCode, 400);
    }
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: sans permission create → 403', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    await createNotification(mkUser(['notifications:read']), {
      recipientId: 'u-sec',
      type: 'GENERAL',
      title: 'x',
      message: 'y',
      scheduledAt: new Date().toISOString(),
    });
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: recipient inexistant → 404', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    await createNotification(creator(), {
      recipientId: 'missing',
      type: 'GENERAL',
      title: 'x',
      message: 'y',
      scheduledAt: new Date().toISOString(),
    });
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 404);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: patient service interdit → 403', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    await createNotification(creator(), {
      recipientId: 'u-sec',
      patientId: 'p-cardio-1',
      type: 'PATIENT',
      title: 'Cardio',
      message: 'Note',
      scheduledAt: new Date().toISOString(),
    });
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 403);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: patient autorisé OK', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    const created = await createNotification(creator(), {
      recipientId: 'u-sec',
      patientId: 'p-urg-1',
      type: 'PATIENT',
      title: 'Urgence',
      message: 'Suivi',
      scheduledAt: new Date().toISOString(),
    });
    t.equal(created.patientId, 'p-urg-1');
    t.equal(created.type, 'PATIENT');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: isolation recipient — user ne voit que les siennes', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    await createNotification(creator(), {
      recipientId: 'u-sec',
      type: 'GENERAL',
      title: 'Pour sec',
      message: 'A',
      scheduledAt: new Date().toISOString(),
    });
    await createNotification(creator(), {
      recipientId: 'u-med',
      type: 'GENERAL',
      title: 'Pour med',
      message: 'B',
      scheduledAt: new Date().toISOString(),
    });

    const mine = await listNotifications(recipient());
    t.equal(mine.total, 1);
    t.equal(mine.items[0].title, 'Pour sec');

    const other = await getNotification(recipient(), mine.items[0].id);
    t.equal(other.id, mine.items[0].id);

    const medList = await listNotifications(creator());
    t.equal(medList.total, 1);
    t.equal(medList.items[0].title, 'Pour med');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: read_all voit toutes', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    await createNotification(creator(), {
      recipientId: 'u-sec',
      type: 'GENERAL',
      title: 'A',
      message: 'A',
      scheduledAt: new Date().toISOString(),
    });
    await createNotification(creator(), {
      recipientId: 'u-med',
      type: 'GENERAL',
      title: 'B',
      message: 'B',
      scheduledAt: new Date().toISOString(),
    });
    const admin = mkUser(
      ['notifications:read', 'notifications:read_all', 'service:urgence'],
      'u-admin'
    );
    const all = await listNotifications(admin);
    t.equal(all.total, 2);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: mark read + audit ; non-recipient → 403', async (t) => {
  const { state } = installNotifDbMock(defaultNotifSeed());
  try {
    const created = await createNotification(creator(), {
      recipientId: 'u-sec',
      type: 'GENERAL',
      title: 'Lire',
      message: 'Moi',
      scheduledAt: new Date().toISOString(),
    });
    try {
      await markNotificationRead(creator(), created.id);
      t.fail('should throw');
    } catch (e) {
      t.equal((e as AppError).statusCode, 403);
    }
    const read = await markNotificationRead(recipient(), created.id);
    t.equal(read.status, 'READ');
    t.ok(read.readAt);
    t.ok(state.audit_logs.some((a) => a.action === 'NOTIFICATION_READ'));
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: cancel PENDING OK ; SENT → 409', async (t) => {
  const { state } = installNotifDbMock(defaultNotifSeed());
  try {
    const pending = await createNotification(creator(), {
      recipientId: 'u-sec',
      type: 'REMINDER',
      title: 'Annuler',
      message: 'plus tard',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const cancelled = await cancelNotification(creator(), pending.id);
    t.equal(cancelled.status, 'CANCELLED');
    t.ok(state.audit_logs.some((a) => a.action === 'NOTIFICATION_CANCELLED'));

    const sent = await createNotification(creator(), {
      recipientId: 'u-sec',
      type: 'GENERAL',
      title: 'Déjà envoyée',
      message: 'x',
      scheduledAt: new Date().toISOString(),
    });
    try {
      await cancelNotification(creator(), sent.id);
      t.fail('should throw');
    } catch (e) {
      t.equal((e as AppError).statusCode, 409);
    }
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: get 404', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    await getNotification(creator(), 'missing');
    t.fail('should throw');
  } catch (e) {
    t.equal((e as AppError).statusCode, 404);
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});

test('notifications: filtres status / type / read', async (t) => {
  installNotifDbMock(defaultNotifSeed());
  try {
    await createNotification(creator(), {
      recipientId: 'u-sec',
      type: 'REMINDER',
      title: 'R1',
      message: 'm',
      scheduledAt: new Date().toISOString(),
    });
    const created = await createNotification(creator(), {
      recipientId: 'u-sec',
      type: 'GENERAL',
      title: 'G1',
      message: 'm',
      scheduledAt: new Date().toISOString(),
    });
    await markNotificationRead(recipient(), created.id);

    const byType = await listNotifications(recipient(), { type: 'REMINDER' });
    t.equal(byType.total, 1);
    const unread = await listNotifications(recipient(), { read: false });
    t.equal(unread.total, 1);
    const read = await listNotifications(recipient(), { read: true });
    t.equal(read.total, 1);
    t.equal(read.items[0].status, 'READ');
  } finally {
    restoreNotifDbMock();
    t.end();
  }
});
