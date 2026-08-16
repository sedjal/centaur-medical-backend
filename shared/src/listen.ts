export type ListenKind = 'public' | 'internal';

/**
 * Bind address for HTTP servers.
 *
 * DEV / TEST: 127.0.0.1 (gateway URLs already use loopback)
 * DOCKER:     set LISTEN_HOST=0.0.0.0 so containers can reach each other
 * PRODUCTION: internals 127.0.0.1 unless LISTEN_HOST is set; gateway 0.0.0.0
 */
export function getListenHost(kind: ListenKind): string {
  if (kind === 'internal' && process.env.LISTEN_HOST) return process.env.LISTEN_HOST;
  if (kind === 'public' && process.env.GATEWAY_LISTEN_HOST) return process.env.GATEWAY_LISTEN_HOST;
  if (kind === 'public' && process.env.LISTEN_HOST) return process.env.LISTEN_HOST;
  if (kind === 'public') return '0.0.0.0';
  return '127.0.0.1';
}
