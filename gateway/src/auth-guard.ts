import { AppError, verifyToken, type JwtPayload } from '@centaur/shared';

export function extractBearer(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const auth = req.headers.authorization || req.headers.Authorization;
  const value = Array.isArray(auth) ? auth[0] : auth;
  if (!value || !value.startsWith('Bearer ')) return null;
  return value.slice(7);
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
 * Protected routes and SSE require a real session JWT (`purpose === 'ACCESS'`).
 * MFA / CHANGE_PASSWORD / PASSWORD_RESET tokens must not unlock resources.
 * The JWT must be sent as Authorization Bearer — never as ?access_token=.
 */
export function requireAuth(req: {
  headers: Record<string, string | string[] | undefined>;
}): JwtPayload {
  const token = extractBearer(req);
  if (!token) throw new AppError('Unauthorized', 401);
  return verifyAccessJwt(token);
}

export const requireAuthSse = requireAuth;
