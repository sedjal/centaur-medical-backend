/**
 * Real HTTP proxy from gateway tests → patient test app.
 */
import { type JwtPayload } from '@centaur/shared';
import { buildIdentityHeaders } from '../../src/proxy';
import type { ProxyFn } from './test-app';

export function createPatientServiceProxy(patientPort: number): ProxyFn {
  return async (_base, method, path, options = {}) => {
    const url = new URL(path, `http://127.0.0.1:${patientPort}`);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), {
      method,
      headers: {
        ...buildIdentityHeaders(options.user as JwtPayload | undefined),
        ...(options.ip ? { 'x-forwarded-for': options.ip } : {}),
        'content-type': 'application/json',
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}
