export const SSE_EVENT_CREATED = 'notification.created';

export const DEFAULT_NOTIFICATION_SSE_HEARTBEAT_MS = 20_000;

export interface NotificationSsePayload {
  notificationId: string;
  type: string;
  unreadCount: number;
}

export interface SseSink {
  writable?: boolean;
  headersSent?: boolean;
  setHeader?(name: string, value: string): void;
  write(chunk: string): unknown;
  end?(cb?: () => void): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface SseConnection {
  userId: string;
  sink: SseSink;
  heartbeat: ReturnType<typeof setInterval>;
}

const connections = new Map<string, Set<SseConnection>>();

export function resolveSseHeartbeatMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.NOTIFICATION_SSE_HEARTBEAT_MS);
  if (!Number.isFinite(raw) || raw < 20) {
    return DEFAULT_NOTIFICATION_SSE_HEARTBEAT_MS;
  }
  return Math.floor(raw);
}

export function sseConnectionCount(userId?: string): number {
  if (userId) return connections.get(userId)?.size || 0;
  let total = 0;
  for (const set of connections.values()) total += set.size;
  return total;
}

function writeChunk(sink: SseSink, chunk: string): boolean {
  try {
    if (sink.writable === false) return false;
    sink.write(chunk);
    return true;
  } catch {
    return false;
  }
}

function formatSseEvent(event: string, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join('\n')}\n\n`;
}

export function removeSseConnection(conn: SseConnection): void {
  clearInterval(conn.heartbeat);
  const set = connections.get(conn.userId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) connections.delete(conn.userId);
}

export function addSseConnection(
  userId: string,
  sink: SseSink,
  req?: { on?(event: string, listener: (...args: unknown[]) => void): void }
): SseConnection {
  if (!sink.headersSent) {
    sink.setHeader?.('Content-Type', 'text/event-stream; charset=utf-8');
    sink.setHeader?.('Cache-Control', 'no-cache, no-transform');
    sink.setHeader?.('Connection', 'keep-alive');
    sink.setHeader?.('X-Accel-Buffering', 'no');
  }
  writeChunk(sink, ': connected\n\n');

  const conn: SseConnection = {
    userId,
    sink,
    heartbeat: setInterval(() => {
      if (!writeChunk(sink, ': heartbeat\n\n')) {
        removeSseConnection(conn);
      }
    }, resolveSseHeartbeatMs()),
  };
  if (typeof conn.heartbeat.unref === 'function') conn.heartbeat.unref();

  const set = connections.get(userId) || new Set<SseConnection>();
  set.add(conn);
  connections.set(userId, set);

  const onClose = () => removeSseConnection(conn);
  sink.on?.('close', onClose);
  sink.on?.('error', onClose);
  req?.on?.('close', onClose);

  return conn;
}

export function emitToUser(userId: string, event: string, data: NotificationSsePayload): number {
  const set = connections.get(userId);
  if (!set || set.size === 0) return 0;
  const chunk = formatSseEvent(event, data, data.notificationId);
  let sent = 0;
  for (const conn of [...set]) {
    if (writeChunk(conn.sink, chunk)) sent += 1;
    else removeSseConnection(conn);
  }
  return sent;
}

export function emitNotificationCreated(payload: NotificationSsePayload & { recipientId: string }): number {
  const { recipientId, notificationId, type, unreadCount } = payload;
  return emitToUser(recipientId, SSE_EVENT_CREATED, { notificationId, type, unreadCount });
}

export async function closeAllSseConnections(): Promise<void> {
  const all: SseConnection[] = [];
  for (const set of connections.values()) all.push(...set);
  for (const conn of all) {
    removeSseConnection(conn);
    try {
      conn.sink.end?.();
    } catch {
      /* ignore */
    }
  }
  connections.clear();
}

/** Tests only. */
export function __resetSseConnections(): void {
  for (const set of connections.values()) {
    for (const conn of set) clearInterval(conn.heartbeat);
  }
  connections.clear();
}
