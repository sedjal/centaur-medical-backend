import http from 'http';
import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
import type { JwtPayload } from '@centaur/shared';
import { buildIdentityHeaders } from './proxy';

function clientFor(url: URL) {
  return url.protocol === 'https:' ? https : http;
}

/**
 * Pipe a long-lived SSE response. Must not use the JSON axios proxy (15s timeout).
 */
export function proxySse(options: {
  targetBase: string;
  path: string;
  user: JwtPayload;
  incoming: IncomingMessage;
  outgoing: ServerResponse;
}): http.ClientRequest {
  const url = new URL(options.path, options.targetBase);
  const lib = clientFor(url);
  const upReq = lib.request(
    url,
    {
      method: 'GET',
      headers: {
        ...buildIdentityHeaders(options.user),
        accept: 'text/event-stream',
      },
    },
    (upRes) => {
      const status = upRes.statusCode || 502;
      const headers: Record<string, string | number | string[] | undefined> = {
        ...upRes.headers,
        'content-type': upRes.headers['content-type'] || 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      };
      delete headers['content-length'];
      if (!options.outgoing.headersSent) {
        options.outgoing.writeHead(status, headers);
      }
      upRes.pipe(options.outgoing);
    }
  );

  upReq.on('error', () => {
    if (!options.outgoing.headersSent) {
      options.outgoing.statusCode = 502;
      options.outgoing.setHeader('Content-Type', 'application/json; charset=utf-8');
      options.outgoing.end(JSON.stringify({ error: 'SSE proxy failed' }));
      return;
    }
    options.outgoing.end();
  });

  options.incoming.on('close', () => {
    upReq.destroy();
  });
  options.outgoing.on('close', () => {
    upReq.destroy();
  });

  upReq.end();
  return upReq;
}
