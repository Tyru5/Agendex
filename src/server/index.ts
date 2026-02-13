import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { createBunWebSocket } from 'hono/bun';
import { authMiddleware, AUTH_TOKEN } from './auth.ts';
import { plans } from './routes/plans.ts';
import { scan } from './services/plan-service.ts';
import { startWatching } from './services/watcher.ts';
import { loadOrInitConfig } from './config.ts';
import { resolveAdapters, setActiveAdapters } from './adapters/registry.ts';

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket();

const clients = new Set<{ send: (data: string) => void }>();
const configureAdapters = process.argv.includes('--configure-adapters');

if (configureAdapters && !(process.stdin.isTTY && process.stdout.isTTY)) {
  console.error(
    '[planfig] startup failed Error: Cannot run --configure-adapters without an interactive TTY. Run this command in a terminal.',
  );
  process.exit(1);
}

app.use('/api/*', cors());
const startup = loadOrInitConfig({ configureAdapters })
  .then((config) => {
    const activeAdapters = resolveAdapters(config.enabledAdapters);
    setActiveAdapters(activeAdapters);
    console.log(
      `[planfig] enabled adapters (${config.enabledAdapters.length}): ${config.enabledAdapters.join(', ')}`,
    );
    return scan();
  })
  .then(() => {
    startWatching((plans) => broadcast('plan:updated', plans));
  })
  .catch((err) => {
    console.error('[planfig] startup failed', err);
    process.exit(1);
  });

app.use('/api/*', async (_c, next) => {
  await startup;
  await next();
});
app.use('/api/*', authMiddleware);
app.route('/api/v1', plans);

app.get(
  '/api/v1/ws',
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      clients.add(ws);
    },
    onClose(_event, ws) {
      clients.delete(ws);
    },
  })),
);

function broadcast(event: string, data: unknown) {
  const msg = JSON.stringify({ event, data });
  for (const client of clients) {
    try {
      client.send(msg);
    } catch {
      clients.delete(client);
    }
  }
}

app.use('/*', serveStatic({ root: './src/client/dist' }));
app.get('/*', serveStatic({ path: './src/client/dist/index.html' }));

const PORT = parseInt(process.env.PORT ?? '4890');

console.log(`[planfig] http://localhost:${PORT}`);
console.log(`[planfig] token: ${AUTH_TOKEN}`);

Bun.serve({
  port: PORT,
  fetch: app.fetch,
  websocket,
});
