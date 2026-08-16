export async function readUntil(res: Response, needle: string, ms = 2500): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const slice = await Promise.race([
      reader.read(),
      new Promise<{ value?: Uint8Array; done: boolean }>((resolve) =>
        setTimeout(() => resolve({ done: false }), remaining)
      ),
    ]);
    if (slice.value) buf += decoder.decode(slice.value, { stream: true });
    if (buf.includes(needle)) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return buf;
    }
    if (slice.done) break;
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  throw new Error(`SSE timeout waiting for ${needle}, got: ${buf.slice(0, 280)}`);
}

export async function readAvailable(res: Response, ms = 200): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const slice = await Promise.race([
      reader.read(),
      new Promise<{ value?: Uint8Array; done: boolean }>((resolve) =>
        setTimeout(() => resolve({ done: false }), remaining)
      ),
    ]);
    if (slice.value) buf += decoder.decode(slice.value, { stream: true });
    if (slice.done) break;
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  return buf;
}

export async function waitUntil(predicate: () => boolean, ms = 2500): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitUntil timeout');
}

export function notifStreamUrl(port: number): string {
  return `http://127.0.0.1:${port}/notifications/stream`;
}

export function gatewayStreamUrl(port: number, query: Record<string, string> = {}): string {
  const qs = new URLSearchParams(query);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return `http://127.0.0.1:${port}/api/notifications/stream${suffix}`;
}

export function parseSseCreatedPayloads(buf: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const blocks = buf.split('\n\n');
  for (const block of blocks) {
    if (!block.includes('event: notification.created')) continue;
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
    if (!dataLine) continue;
    try {
      out.push(JSON.parse(dataLine.slice(6)) as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  }
  return out;
}
