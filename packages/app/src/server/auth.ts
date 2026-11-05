import { createHash, timingSafeEqual } from 'node:crypto';
import { loadOrCreateToken } from '@agendex/shared';
import { createMiddleware } from 'hono/factory';

const AUTH_TOKEN = loadOrCreateToken();
const AUTH_TOKEN_DIGEST = createHash('sha256').update(AUTH_TOKEN).digest();

export { AUTH_TOKEN };

/**
 * Constant-time token check. Hashing first gives both sides the same length, so
 * neither the comparison nor a length mismatch leaks how much of a guess matched.
 */
export function isAuthToken(candidate: string | null | undefined): boolean {
  if (typeof candidate !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(candidate).digest(), AUTH_TOKEN_DIGEST);
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!isAuthToken(token)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});
