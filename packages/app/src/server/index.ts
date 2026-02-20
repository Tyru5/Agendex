import {
  loadOrInitConfig,
  resolveAdapters,
  scan,
  setActiveAdapters,
  setOnPlansChanged,
  startWatching,
} from '@agendex/shared';
import { Hono } from 'hono';
import { createBunWebSocket, serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { AUTH_TOKEN, authMiddleware } from './auth.ts';
import { plans } from './routes/plans.ts';
import { rebuildIndex } from './services/search.ts';

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket();

const clients = new Set<{ send: (data: string) => void }>();
const configureAdapters = process.argv.includes('--configure-adapters');

if (configureAdapters && !(process.stdin.isTTY && process.stdout.isTTY)) {
  console.error(
    '[agendex] startup failed Error: Cannot run --configure-adapters without an interactive TTY. Run this command in a terminal.',
  );
  process.exit(1);
}

setOnPlansChanged((plans) => rebuildIndex(plans));

app.use('/api/*', cors());
const startup = loadOrInitConfig({ configureAdapters })
  .then((config) => {
    const activeAdapters = resolveAdapters(config.enabledAdapters);
    setActiveAdapters(activeAdapters);
    console.log(
      `[agendex] enabled adapters (${config.enabledAdapters.length}): ${config.enabledAdapters.join(', ')}`,
    );
    return scan();
  })
  .then(() => {
    startWatching((plans) => broadcast('plan:updated', plans));
  })
  .catch((err) => {
    console.error('[agendex] startup failed', err);
    process.exit(1);
  });

app.use('/api/*', async (_c, next) => {
  await startup;
  await next();
});

app.get(
  '/api/v1/ws',
  (c, next) => {
    const token = new URL(c.req.url).searchParams.get('token');
    if (token !== AUTH_TOKEN) return c.json({ error: 'unauthorized' }, 401);
    return next();
  },
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      clients.add(ws);
    },
    onClose(_event, ws) {
      clients.delete(ws);
    },
  })),
);

app.use('/api/*', authMiddleware);
app.route('/api/v1', plans);

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

const PORT = parseInt(process.env.PORT ?? '4890', 10);

console.log(`[agendex] http://localhost:${PORT}`);
console.log(`[agendex] token: ${AUTH_TOKEN}`);

Bun.serve({
  port: PORT,
  fetch: app.fetch,
  websocket,
});
