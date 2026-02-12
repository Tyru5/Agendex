import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { createBunWebSocket } from "hono/bun";
import { authMiddleware, AUTH_TOKEN } from "./auth.ts";
import { plans } from "./routes/plans.ts";
import { scan } from "./services/plan-service.ts";
import { startWatching } from "./services/watcher.ts";

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket();

const clients = new Set<{ send: (data: string) => void }>();

app.use("/api/*", cors());
app.use("/api/*", authMiddleware);
app.route("/api/v1", plans);

app.get(
  "/api/v1/ws",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      clients.add(ws);
    },
    onClose(_event, ws) {
      clients.delete(ws);
    },
  }))
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

app.use("/*", serveStatic({ root: "./src/client/dist" }));
app.get("/*", serveStatic({ path: "./src/client/dist/index.html" }));

const PORT = parseInt(process.env.PORT ?? "4890");

await scan();
startWatching((plans) => broadcast("plan:updated", plans));

console.log(`[planfig] http://localhost:${PORT}`);
console.log(`[planfig] token: ${AUTH_TOKEN}`);

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};
