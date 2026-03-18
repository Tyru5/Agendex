# Agendex

Agendex indexes and explores plans and sessions produced by coding agents across your local machine, with optional cloud sync and collaboration features.

## Monorepo Layout

Agendex is a Bun workspaces monorepo:

- `packages/shared` - shared domain logic, types, config, scanning, watcher, setup helpers, and daemon status helpers
- `packages/app` - OSS local app (`@agendex/app`) with the Hono API and OSS Vite client
- `packages/web` - shared React/web UI package consumed by the EE app
- `packages/ee` - cloud/pro package (`@agendex/ee`) with Convex auth, subscriptions, sharing, comments, and EE dashboard flows
- `packages/cli` - CLI (`agendex-cli`) for login, sync, daemon, and status workflows

## Feature Split

### Free (Local OSS)

- Local plan indexing and full-text search
- Live file watching and WebSocket updates
- Agent and workspace filtering with read-only plan viewing
- Local API with token-based auth
- Adapter selection and rescanning
- No Convex or Stripe required for local-only usage

### Cloud Pro / EE

- Convex-backed auth and cloud dashboard flows
- Shareable plan links
- Comment threads
- Trial and subscription flows
- Cloud sync via CLI
- Dashboard plan creation and collaboration features

## Adapter Status

Agendex currently has **5 implemented adapters**:

- `claude-code`
- `codex`
- `continue`
- `cursor`
- `opencode`

The adapter catalog also includes additional non-implemented or stub entries for broader ecosystem coverage.

## Quick Start (Local OSS)

### 1. Install

```bash
bun install
```

### 2. Start server and client

Run these in separate terminals:

```bash
# OSS API server (http://localhost:4890)
bun run dev

# OSS Vite client (http://localhost:5173)
bun run dev:client
```

### 3. Sign in locally with your token

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
bun run dev                 # run OSS API server (@agendex/app) on :4890
bun run dev:client          # run OSS client on :5173
bun run dev:client:oss      # run OSS client explicitly on :5173
bun run dev:client:ee       # run EE client on :5174
bun run build               # build OSS client bundle
bun run build:cloud         # build EE client bundle

bun run cli:start           # start cloud sync daemon
bun run cli:login           # browser login using https://agendex.dev
bun run cli:login -- --url https://example.com
bun run cli:configure       # select which agents/adapters to index
bun run cli:sync            # one-shot cloud sync
bun run cli:stop            # stop daemon
bun run cli:status          # print current local/cloud config state

bun run changeset           # create a release note for agendex-cli
bun run version-packages    # apply pending Changesets versions
bun run build:cli:release   # generate packages/cli/.release
bun run pack:cli:dry-run    # inspect the generated npm tarball
bun run smoke:cli:release   # smoke-test the packed CLI under Node

bun run format              # biome format
bun run format:check
bun run lint
bun run lint:fix
bun run check
bun run check:fix
```

The published CLI is Node-compatible and can be installed with `npm`, `pnpm`, `yarn`, or `bun`. The default `agendex login` target is `https://agendex.dev`. For self-hosted logins, use `agendex login --url <site>` or `bun run cli:login -- --url <site>`.

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

## Configuration and Environment

Local config file:

- `~/.agendex/config.json`
  - `token` (local API auth token)
  - `cloudToken` and `convexUrl` (after CLI login)
  - `enabledAdapters`

Common environment variables:

- OSS app:
  - `PORT` (default `4890`)
  - `AGENDEX_TOKEN` (override generated local token)
  - `VITE_ALLOWED_HOSTS` (comma-separated extra Vite allowed hosts)
- EE client:
  - `VITE_CONVEX_URL`
  - `VITE_CONVEX_SITE_URL`
  - optional `VITE_APP_URL`
- EE backend/auth:
  - `SITE_URL`
  - `CONVEX_SITE_URL`
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
  - `BETTER_AUTH_SECRET`
- EE billing:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_MONTHLY_PRICE_ID`
  - `STRIPE_YEARLY_PRICE_ID`

## EE / Cloud Development

The local EE stack uses three processes:

```bash
# terminal 1 (from packages/ee)
npx convex dev

# terminal 2 (from repo root)
bun run dev

# terminal 3 (from repo root)
bun run dev:client:ee
```

This gives you:

- OSS API on `http://localhost:4890`
- EE Vite client on `http://localhost:5174`
- `/api` requests from the EE client proxied to the OSS API on `:4890`

For self-hosting, auth setup, and maintainer-level EE billing notes, see [docs/self-hosting.md](./docs/self-hosting.md).

## License

- All code except `packages/ee/` is licensed under [AGPL-3.0](./LICENSE).
- Code in `packages/ee/` is licensed under the [Agendex Enterprise License](./packages/ee/LICENSE) (source-available for evaluation and development; production use requires Cloud Pro).
