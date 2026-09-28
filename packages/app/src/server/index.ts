import { stopWatchingForShutdown } from '@agendex/shared';
import { createBunWebSocket, serveStatic } from 'hono/bun';
import { buildAgendexApp } from './app.ts';
import { cacheControlFor } from './static-cache.ts';

const { upgradeWebSocket, websocket } = createBunWebSocket();
const configureAdapters = process.argv.includes('--configure-adapters');

if (configureAdapters && !(process.stdin.isTTY && process.stdout.isTTY)) {
  console.error(
    '[agendex] startup failed Error: Cannot run --configure-adapters without an interactive TTY. Run this command in a terminal.',
  );
  process.exit(1);
}

const { app, ready, token } = buildAgendexApp({
  upgradeWebSocket,
  configureAdapters,
  mountStatic: (app) => {
    app.use(
      '/*',
      serveStatic({
        root: './src/client/dist',
        onFound: (path, c) => {
          // `/` resolves to index.html, which must never be cached.
          c.header(
            'Cache-Control',
            path.endsWith('.html') ? 'no-store' : cacheControlFor(c.req.path),
          );
        },
      }),
    );
    app.get(
      '/*',
      serveStatic({
        path: './src/client/dist/index.html',
        onFound: (_path, c) => {
          c.header('Cache-Control', 'no-store');
        },
      }),
    );
  },
});

ready.catch((err) => {
  console.error('[agendex] startup failed', err);
  process.exit(1);
});

const PORT = parseInt(process.env.PORT ?? '4890', 10);

function shutdown() {
  stopWatchingForShutdown();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

console.log(`[agendex] http://localhost:${PORT}`);
console.log(`[agendex] token: ${token}`);

Bun.serve({
  port: PORT,
  fetch: app.fetch,
  websocket,
});
