export type RestanaRes = {
  statusCode?: number;
  setHeader: (k: string, v: string) => void;
  end: (chunk?: string) => void;
  /** Restana ResponseExtensions.send — signature differs from Express. */
  send?: (
    data?: unknown,
    code?: number,
    headers?: Record<string, string | number | string[]>,
    cb?: () => void
  ) => void;
};

export function reply(res: RestanaRes, status: number, body: unknown): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(payload);
}

export function handleRouteError(res: RestanaRes, err: unknown): void {
  const name = (err as { name?: string }).name;
  if (name === 'ZodError') {
    const details = (err as { flatten?: () => unknown }).flatten?.();
    reply(res, 400, details !== undefined ? { error: 'Validation failed', details } : { error: 'Validation failed' });
    return;
  }
  if (name === 'JsonWebTokenError' || name === 'TokenExpiredError' || name === 'NotBeforeError') {
    reply(res, 401, { error: 'Invalid or expired token' });
    return;
  }
  const status = (err as { statusCode?: number }).statusCode || 500;
  const message =
    status === 500
      ? 'Internal error'
      : err instanceof Error
        ? err.message
        : 'Internal error';
  const details = status === 500 ? undefined : (err as { details?: unknown }).details;
  reply(res, status, details !== undefined ? { error: message, details } : { error: message });
}
