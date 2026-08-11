export class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'AppError';
  }
}

export function sendJson(
  res: { send: (status: number, body: unknown) => void },
  status: number,
  body: unknown
): void {
  res.send(status, body);
}

export function parseBody<T>(req: { body?: unknown }): T {
  return (req.body || {}) as T;
}

export function getClientIp(req: {
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
  ip?: string;
}): string {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return xf[0];
  return req.ip || req.connection?.remoteAddress || 'unknown';
}
