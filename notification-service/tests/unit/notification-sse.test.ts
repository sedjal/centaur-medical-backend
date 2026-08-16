/**
 * UNIT — SSE manager
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';
process.env.NOTIFICATION_SSE_HEARTBEAT_MS = '40';

import { EventEmitter } from 'events';
import test from 'tape';
import {
  addSseConnection,
  closeAllSseConnections,
  emitNotificationCreated,
  emitToUser,
  removeSseConnection,
  resolveSseHeartbeatMs,
  sseConnectionCount,
  __resetSseConnections,
  SSE_EVENT_CREATED,
} from '../../src/notification-sse';

class FakeSink extends EventEmitter {
  chunks: string[] = [];
  writable = true;
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.emit('close');
  }
  text() {
    return this.chunks.join('');
  }
}

function afterReset(fn: (t: test.Test) => Promise<void> | void) {
  return async (t: test.Test) => {
    __resetSseConnections();
    try {
      await fn(t);
    } finally {
      __resetSseConnections();
      t.end();
    }
  };
}

test('sse: heartbeat env', (t) => {
  t.equal(resolveSseHeartbeatMs({} as NodeJS.ProcessEnv), 20_000);
  t.equal(resolveSseHeartbeatMs({ NOTIFICATION_SSE_HEARTBEAT_MS: '5' } as NodeJS.ProcessEnv), 20_000);
  t.equal(resolveSseHeartbeatMs({ NOTIFICATION_SSE_HEARTBEAT_MS: '15000' } as NodeJS.ProcessEnv), 15_000);
  t.end();
});

test(
  'sse: add + emit to user ; pas à un autre',
  afterReset(async (t) => {
    const a = new FakeSink();
    const b = new FakeSink();
    addSseConnection('u-a', a);
    addSseConnection('u-b', b);
    t.equal(sseConnectionCount(), 2);
    const sent = emitNotificationCreated({
      recipientId: 'u-a',
      notificationId: 'n1',
      type: 'PRESCRIPTION',
      unreadCount: 3,
    });
    t.equal(sent, 1);
    t.match(a.text(), /notification\.created/);
    t.match(a.text(), /"notificationId":"n1"/);
    t.equal(a.text().includes('World'), false);
    t.equal(b.text().includes(SSE_EVENT_CREATED), false);
  })
);

test(
  'sse: plusieurs connexions du même utilisateur',
  afterReset(async (t) => {
    const c1 = new FakeSink();
    const c2 = new FakeSink();
    addSseConnection('u-a', c1);
    addSseConnection('u-a', c2);
    t.equal(sseConnectionCount('u-a'), 2);
    emitToUser('u-a', SSE_EVENT_CREATED, {
      notificationId: 'n2',
      type: 'PATIENT',
      unreadCount: 1,
    });
    t.match(c1.text(), /n2/);
    t.match(c2.text(), /n2/);
  })
);

test(
  'sse: cleanup close + closeAll',
  afterReset(async (t) => {
    const s = new FakeSink();
    const conn = addSseConnection('u-a', s);
    t.equal(sseConnectionCount('u-a'), 1);
    s.emit('close');
    t.equal(sseConnectionCount('u-a'), 0);
    addSseConnection('u-a', new FakeSink());
    addSseConnection('u-b', new FakeSink());
    await closeAllSseConnections();
    t.equal(sseConnectionCount(), 0);
    removeSseConnection(conn);
    t.equal(sseConnectionCount(), 0);
  })
);

test(
  'sse: heartbeat comment',
  afterReset(async (t) => {
    const s = new FakeSink();
    addSseConnection('u-a', s);
    await new Promise((r) => setTimeout(r, 90));
    t.match(s.text(), /heartbeat/);
  })
);
