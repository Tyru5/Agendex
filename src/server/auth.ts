import { createMiddleware } from 'hono/factory';
import { loadOrCreateToken } from './config.ts';

const AUTH_TOKEN = loadOrCreateToken();

export { AUTH_TOKEN };

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  if (header !== `Bearer ${AUTH_TOKEN}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});
