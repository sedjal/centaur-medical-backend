export const MAX_JSON_BYTES = 1_048_576;
export const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;

export function pathnameOf(url?: string): string {
  return String(url || '').split('?')[0];
}

export function isGatewayDocumentUploadPath(url?: string): boolean {
  return /^\/api\/patients\/[^/]+\/documents\/?$/.test(pathnameOf(url));
}

export function isGatewayDocumentFilePath(url?: string): boolean {
  return /^\/api\/patients\/[^/]+\/documents\/[^/]+\/file\/?$/.test(pathnameOf(url));
}

export async function readLimitedBody(
  req: AsyncIterable<Buffer>,
  maxBytes: number
): Promise<{ ok: true; body: Buffer } | { ok: false; tooLarge: true }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) {
      return { ok: false, tooLarge: true };
    }
    chunks.push(Buffer.from(chunk));
  }
  return { ok: true, body: Buffer.concat(chunks) };
}
