import { createMiddleware } from 'hono/factory';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';

const configDir = join(homedir(), '.planfig');
const configPath = join(configDir, 'config.json');

function loadOrCreateToken(): string {
  if (process.env.PLANFIG_TOKEN) return process.env.PLANFIG_TOKEN;

  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.token) return config.token;
  }

  const token = randomBytes(32).toString('hex');
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({ token }, null, 2));
  console.log(`\n[planfig] generated auth token: ${token}`);
  console.log(`[planfig] saved to ${configPath}\n`);
  return token;
}

const AUTH_TOKEN = loadOrCreateToken();

export { AUTH_TOKEN };

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  if (header !== `Bearer ${AUTH_TOKEN}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});
