import { AppError, verifyToken, type JwtPayload } from '@centaur/shared';

export function extractBearer(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const auth = req.headers.authorization || req.headers.Authorization;
  const value = Array.isArray(auth) ? auth[0] : auth;
  if (!value || !value.startsWith('Bearer ')) return null;
  return value.slice(7);
}

export function extractQueryAccessToken(req: { url?: string }): string | null {
  const raw = req.url || '';
  const qIndex = raw.indexOf('?');
  if (qIndex < 0) return null;
  const params = new URLSearchParams(raw.slice(qIndex + 1));
  const token = params.get('access_token');
  return token && token.trim() ? token.trim() : null;
}

function verifyAccessJwt(token: string): JwtPayload {
  try {
    const payload = verifyToken(token);
    if (payload.purpose !== 'ACCESS') {
      throw new AppError('Invalid access token', 401);
    }
    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid or expired token', 401);
  }
}

/**
 * Protected routes require a real session JWT (`purpose === 'ACCESS'`).
 * MFA / CHANGE_PASSWORD / PASSWORD_RESET tokens must not unlock /me, /patients, etc.
 */
export function requireAuth(req: {
  headers: Record<string, string | string[] | undefined>;
}): JwtPayload {
  const token = extractBearer(req);
  if (!token) throw new AppError('Unauthorized', 401);
  return verifyAccessJwt(token);
}

/** SSE: ACCESS JWT via Authorization Bearer (préféré). Query access_token still accepted for legacy clients. */
export function requireAuthSse(req: {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
}): JwtPayload {
  const token = extractBearer(req) || extractQueryAccessToken(req);
  if (!token) throw new AppError('Unauthorized', 401);
  return verifyAccessJwt(token);
}
