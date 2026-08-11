export type RestanaRes = {
  statusCode?: number;
  setHeader: (k: string, v: string) => void;
  end: (chunk?: string) => void;
  send?: (status: number | unknown, body?: unknown) => void;
};

export function reply(res: RestanaRes, status: number, body: unknown): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(payload);
}

export function handleRouteError(res: RestanaRes, err: unknown): void {
  const status =
    (err as { statusCode?: number }).statusCode ||
    ((err as { name?: string }).name === 'ZodError' ? 400 : 500);
  const message =
    (err as { name?: string }).name === 'ZodError'
      ? 'Validation failed'
      : err instanceof Error
        ? err.message
        : 'Internal error';
  const details =
    (err as { name?: string }).name === 'ZodError'
      ? (err as { flatten?: () => unknown }).flatten?.()
      : (err as { details?: unknown }).details;
  reply(res, status, details !== undefined ? { error: message, details } : { error: message });
}
