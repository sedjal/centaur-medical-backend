/**
 * UNIT — notification scheduler (interval + graceful stop)
 */
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars';
process.env.SERVICE_TOKEN = 'test-service-token';
process.env.NODE_ENV = 'test';

import test from 'tape';
import {
  createNotificationScheduler,
  resolveNotificationWorkerIntervalMs,
  DEFAULT_NOTIFICATION_WORKER_INTERVAL_MS,
} from '../../src/notification.scheduler';

test('scheduler: intervalle configurable via NOTIFICATION_WORKER_INTERVAL_MS', (t) => {
  const prev = process.env.NOTIFICATION_WORKER_INTERVAL_MS;
  try {
    process.env.NOTIFICATION_WORKER_INTERVAL_MS = '8000';
    t.equal(resolveNotificationWorkerIntervalMs(), 8000);

    process.env.NOTIFICATION_WORKER_INTERVAL_MS = 'not-a-number';
    t.equal(resolveNotificationWorkerIntervalMs(), DEFAULT_NOTIFICATION_WORKER_INTERVAL_MS);

    process.env.NOTIFICATION_WORKER_INTERVAL_MS = '50';
    t.equal(resolveNotificationWorkerIntervalMs(), DEFAULT_NOTIFICATION_WORKER_INTERVAL_MS);

    delete process.env.NOTIFICATION_WORKER_INTERVAL_MS;
    t.equal(resolveNotificationWorkerIntervalMs(), DEFAULT_NOTIFICATION_WORKER_INTERVAL_MS);

    const scheduler = createNotificationScheduler({
      intervalMs: resolveNotificationWorkerIntervalMs({
        NOTIFICATION_WORKER_INTERVAL_MS: '12000',
      }),
      run: async () => ({ found: 0, processed: 0, failed: 0 }),
    });
    t.equal(scheduler.intervalMs, 12000);
  } finally {
    if (prev === undefined) delete process.env.NOTIFICATION_WORKER_INTERVAL_MS;
    else process.env.NOTIFICATION_WORKER_INTERVAL_MS = prev;
    t.end();
  }
});

test('scheduler: premier tick immédiat puis périodique ; stop arrête proprement', async (t) => {
  let ticks = 0;
  const scheduler = createNotificationScheduler({
    intervalMs: 40,
    run: async () => {
      ticks += 1;
      return { found: 0, processed: 0, failed: 0 };
    },
  });
  try {
    await scheduler.start();
    t.equal(ticks, 1);
    t.equal(scheduler.isStopped(), false);
    await new Promise((r) => setTimeout(r, 95));
    t.ok(ticks >= 2, `expected at least 2 ticks, got ${ticks}`);
    await scheduler.stop();
    t.equal(scheduler.isStopped(), true);
    const afterStop = ticks;
    await new Promise((r) => setTimeout(r, 90));
    t.equal(ticks, afterStop, 'no ticks after stop');
  } finally {
    await scheduler.stop();
    t.end();
  }
});

test('scheduler: ticks concurrents non empilés', async (t) => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const scheduler = createNotificationScheduler({
    intervalMs: 20,
    run: async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 55));
      concurrent -= 1;
      return { found: 0, processed: 0, failed: 0 };
    },
  });
  try {
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 70));
    await scheduler.stop();
    t.equal(maxConcurrent, 1);
  } finally {
    await scheduler.stop();
    t.end();
  }
});

test('scheduler: stop laisse terminer le tick en cours', async (t) => {
  let finished = false;
  const scheduler = createNotificationScheduler({
    intervalMs: 10_000,
    run: async () => {
      await new Promise((r) => setTimeout(r, 60));
      finished = true;
      return { found: 1, processed: 1, failed: 0 };
    },
  });
  try {
    const started = scheduler.start();
    await new Promise((r) => setTimeout(r, 15));
    await scheduler.stop();
    await started;
    t.equal(finished, true);
    t.equal(scheduler.isStopped(), true);
  } finally {
    await scheduler.stop();
    t.end();
  }
});
