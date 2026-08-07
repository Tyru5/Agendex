import {
  getAll,
  loadOrInitConfig,
  resolveAdapters,
  scan,
  setActiveAdapters,
  setOnPlansChanged,
  startWatching,
} from '@agendex/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { UpgradeWebSocket } from 'hono/ws';
import { AUTH_TOKEN, authMiddleware } from './auth.ts';
import { plans, setPlanSourcesWatcherCallback } from './routes/plans.ts';
import { rebuildIndex } from './services/search.ts';

export interface BuildAgendexAppOptions {
  /**
   * Pre-created Hono instance. Required for the Node runtime, where
   * `createNodeWebSocket({ app })` must reference the same app the routes are
   * registered on. Defaults to a fresh `Hono` instance (Bun runtime).
   */
  app?: Hono;
  /** Runtime-specific WebSocket upgrade helper (Bun or Node). */
  upgradeWebSocket: UpgradeWebSocket;
  /**
   * Registers static file serving for the built client. Called last so it acts
   * as the catch-all after API routes. Each runtime supplies its own strategy
   * (Bun's `hono/bun` serveStatic vs a Node fs-based handler).
   */
  mountStatic?: (app: Hono) => void;
  /** Open the interactive adapter selection prompt on startup (TTY only). */
  configureAdapters?: boolean;
}

export interface BuiltAgendexApp {
  app: Hono;
  /** Resolves once config is loaded, the initial scan completed, and watching started. */
  ready: Promise<void>;
  /** Broadcast an event to all connected WebSocket clients. */
  broadcast: (event: string, data: unknown) => void;
  token: string;
}

export function buildAgendexApp(options: BuildAgendexAppOptions): BuiltAgendexApp {
  const { upgradeWebSocket, mountStatic, configureAdapters = false } = options;

  const app = options.app ?? new Hono();
  const clients = new Set<{ send: (data: string) => void }>();

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

  function buildFingerprint(): string {
    return getAll()
      .map((p) => `${p.id}:${p.updatedAt.getTime()}`)
      .sort()
      .join('|');
  }

  setOnPlansChanged((plans) => rebuildIndex(plans));

  app.use('/api/*', cors());

  const ready = loadOrInitConfig({ configureAdapters })
    .then((config) => {
      const activeAdapters = resolveAdapters(config.enabledAdapters);
      setActiveAdapters(activeAdapters);
      console.log(
        `[agendex] enabled adapters (${config.enabledAdapters.length}): ${config.enabledAdapters.join(', ')}`,
      );
      return scan();
    })
    .then(() => {
      const watcherCallback = (plans: unknown[]) => broadcast('plan:updated', plans);
      setPlanSourcesWatcherCallback(watcherCallback);
      startWatching(watcherCallback);

      // Fallback polling for environments where fs.watch is unreliable (WSL, network mounts)
      let lastFingerprint = buildFingerprint();
      setInterval(() => {
        void (async () => {
          await scan({ queueIfBusy: false });
          const fp = buildFingerprint();
          if (fp !== lastFingerprint) {
            lastFingerprint = fp;
            broadcast('plan:updated', getAll());
          }
        })().catch((error) => {
          console.error('[agendex] fallback plan scan failed:', error);
        });
      }, 60_000);
    });

  app.use('/api/*', async (_c, next) => {
    await ready;
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

  app.get('/api/v1/health', (c) => c.json({ ok: true }));
  app.use('/api/*', authMiddleware);
  app.route('/api/v1', plans);

  if (mountStatic) mountStatic(app);

  return { app, ready: ready.then(() => undefined), broadcast, token: AUTH_TOKEN };
}
