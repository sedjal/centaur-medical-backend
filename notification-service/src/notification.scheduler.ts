import { processScheduledNotifications, type ProcessScheduledResult } from './notification.service';

export const DEFAULT_NOTIFICATION_WORKER_INTERVAL_MS = 5000;

export type NotificationSchedulerRun = () => Promise<ProcessScheduledResult>;

export interface NotificationScheduler {
  readonly intervalMs: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  isStopped(): boolean;
}

/**
 * Read NOTIFICATION_WORKER_INTERVAL_MS.
 * Invalid, NaN, or values below 1000 ms fall back to 5000 ms.
 */
export function resolveNotificationWorkerIntervalMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.NOTIFICATION_WORKER_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < 1000) {
    return DEFAULT_NOTIFICATION_WORKER_INTERVAL_MS;
  }
  return Math.floor(raw);
}

/**
 * Periodic worker: first tick immediately, then every intervalMs.
 * Overlapping ticks are skipped. stop() clears the timer and waits for the in-flight tick.
 */
export function createNotificationScheduler(options?: {
  intervalMs?: number;
  run?: NotificationSchedulerRun;
}): NotificationScheduler {
  const intervalMs = options?.intervalMs ?? resolveNotificationWorkerIntervalMs();
  const run = options?.run ?? processScheduledNotifications;

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = true;
  let running = false;
  let inFlight: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (stopped || running) return;
    running = true;
    const work = (async () => {
      try {
        await run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[notification-worker] tick failed error=${msg}`);
      }
    })();
    inFlight = work;
    try {
      await work;
    } finally {
      running = false;
      inFlight = null;
    }
  }

  async function start(): Promise<void> {
    if (!stopped && timer) return;
    stopped = false;
    await tick();
    if (stopped) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (inFlight) {
      await inFlight;
    }
  }

  return {
    intervalMs,
    start,
    stop,
    isStopped: () => stopped,
  };
}
