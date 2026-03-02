# Agendex

Agendex indexes and explores plans/sessions produced by coding agents across your local machine, with optional cloud sync and collaboration features.

## Monorepo Layout

Agendex is a Bun workspaces monorepo:

- `packages/shared` - shared domain logic (types, adapter catalog/registry, config, scanning, watcher, setup helpers)
- `packages/app` - OSS local app (`@agendex/app`) with Hono API + React client
- `packages/ee` - cloud/pro package (`@agendex/ee`) with Convex, auth, billing, sharing, comments
- `packages/cli` - CLI (`@agendex/cli`) for login/sync/daemon/status flows

## Feature Split

### Free (Self-Hosted OSS)

- Local plan indexing and full-text search
- Live file watching + WebSocket updates
- Agent/workspace filtering and plan viewing
- Local API with token-based auth
- Adapter selection and rescanning
- No Convex/Stripe required for local-only usage

### Cloud Pro (EE + CLI)

- Cloud sync (one-shot and daemon)
- Shareable plan links
- Comment threads
- Cloud authoring/collaboration flows (including dashboard plan creation)
- Billing/subscription flows and workspace features

## Adapter Status

Agendex currently has **5 implemented adapters**:

- `claude-code`
- `codex`
- `continue`
- `cursor`
- `opencode`

The adapter catalog also includes additional non-implemented/stub entries for broader ecosystem coverage.

## Quick Start (Local OSS)

### 1) Install

```bash
bun install
```

### 2) Start server + client

Run these in separate terminals:

```bash
# Hono server (http://localhost:4890)
bun run dev

# Vite client (http://localhost:5173)
bun run dev:client
```

### 3) Sign in locally with your token

On server startup, Agendex prints a local auth token. Paste that token into the login modal in the web app.

## Adapter Selection

On first server startup, Agendex prompts for enabled adapters and stores the result in:

`~/.agendex/config.json`

In non-interactive environments, Agendex auto-enables default adapters.

Re-open adapter selection:

```bash
bun run dev -- --configure-adapters
bun run --cwd ./packages/app start -- --configure-adapters
```

## Useful Commands

From repo root:

```bash
bun run dev                 # run OSS server (@agendex/app)
bun run dev:client          # run OSS client (Vite)
bun run dev:client:oss      # run OSS client (explicit)
bun run dev:client:ee       # run EE client (Vite)
bun run build               # build OSS client bundle
bun run build:cloud         # build EE client

bun run cli:start           # start cloud sync daemon
bun run cli:login           # browser login (defaults to agendex.dev)
bun run cli:sync            # one-shot cloud sync
bun run cli:status          # print current local/cloud config state

bun run format              # biome format
bun run format:check
bun run lint
bun run lint:fix
bun run check
bun run check:fix
```

## Local API (OSS)

Server routes are under `/api/v1` and require `Authorization: Bearer <token>`.

Key endpoints:

- `GET /api/v1/health`
- `GET /api/v1/plans`
- `GET /api/v1/plans/:id`
- `GET /api/v1/plans/:id/raw`
- `GET /api/v1/agents`
- `POST /api/v1/rescan`
- `PUT /api/v1/plans/:id` -> returns `403` in OSS (Cloud Pro only)
- `POST /api/v1/plans` -> returns `403` in OSS (Cloud Pro only)

WebSocket updates:

- `GET /api/v1/ws?token=<token>`

## Configuration & Environment

Local config file:

- `~/.agendex/config.json`
  - `token` (local API auth token)
  - `cloudToken` and `convexUrl` (after CLI login)
  - `enabledAdapters`

Common environment variables:

- OSS app:
  - `PORT` (default: `4890`)
  - `AGENDEX_TOKEN` (override generated local token)
  - `VITE_ALLOWED_HOSTS` (comma-separated extra Vite allowed hosts)
- EE/cloud:
  - Client: `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, optional `VITE_APP_URL`
  - Convex/auth/billing: `SITE_URL`, `CONVEX_SITE_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_YEARLY_PRICE_ID`

## EE / Cloud Development

When working on `packages/ee`:

```bash
# terminal 1 (from packages/ee)
npx convex dev

# terminal 2 (from repo root)
bun run dev:client:ee
```

The EE Vite client runs on `http://localhost:5174` and proxies `/api` to the OSS server (`http://localhost:4890`).

## License

- All code except `packages/ee/` is licensed under [AGPL-3.0](./LICENSE).
- Code in `packages/ee/` is licensed under the [Agendex Enterprise License](./packages/ee/LICENSE) (source-available for evaluation/development; production use requires Cloud Pro).
