# Agendex

Agendex indexes and explores plans and sessions produced by coding agents across your local machine, with optional cloud sync and collaboration features.

## Monorepo Layout

Agendex is a Bun workspaces monorepo:

- `packages/shared` - shared domain logic, types, config, scanning, watcher, setup helpers, and daemon status helpers
- `packages/app` - OSS local app (`@agendex/app`) with the Hono API and OSS Vite client
- `packages/web` - shared React/web UI package consumed by the OSS and EE apps
- `packages/ee` - cloud/pro package (`@agendex/ee`) with Convex auth, subscriptions, sharing, comments, and EE dashboard flows
- `packages/cli` - CLI (`agendex-cli`) for login, sync, daemon, and status workflows

## Feature Split

### Free (Local OSS)

- Local plan indexing, full-text search, and automatic low-value plan hiding (empty files, code dumps, logs, prompt-only artifacts, and other non-plans)
- Live file watching, polling fallback, and WebSocket updates
- Offline-aware client that surfaces a backend-unreachable state and recovers automatically
- Agent and workspace filtering with read-only plan viewing
- Local API with token-based auth
- Adapter selection, rescanning, and custom plan source directories
- No Convex or Stripe required for local-only usage

### Cloud Pro / EE

- Convex-backed auth and cloud dashboard flows
- Cloud sync via CLI or daemon, with hash-based skip for unchanged plans, real-time upload queue with retries, and automatic low-value pruning on the cloud side
- Shareable plan links, comment threads, tags, collections, and plan history
- Workspace members, daemon status/cleanup, and collaboration features
- Dashboard plan creation, uploads, and editing
- Pro Plannotator sync and daemon-mediated request-changes write-back
- Trial and subscription flows

## Adapter Status

Agendex currently has **7 implemented adapters**:

- `claude-code`
- `codex`
- `continue`
- `cursor`
- `grok`
- `opencode`
- `plannotator`

`plannotator` is implemented but not default-enabled in the OSS local app. CLI sync and daemon workflows auto-enable it when a cloud login target is configured; set `AGENDEX_PLANNOTATOR_SYNC=0` to opt out or `AGENDEX_PLANNOTATOR_SYNC=1` to force it on.

The adapter catalog also includes additional non-implemented or stub entries for broader ecosystem coverage.

## Quick Start (Cloud CLI)

Install the published CLI with the one-line installer:

```bash
# macOS / Linux
curl -fsSL https://agendex.dev/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://agendex.dev/install.ps1 | iex
```

Then authenticate, choose which agents to index, and start syncing:

```bash
agendex login
agendex configure
agendex start
```

You can also install directly with `npm install -g agendex-cli`, `pnpm add -g agendex-cli`, `yarn global add agendex-cli`, or `bun install -g agendex-cli`. Installer flags are documented in [`packages/cli/README.md`](./packages/cli/README.md).

## Quick Start (Local OSS)

### 1. Install dependencies

```bash
bun install
```

### 2. Start server and client

Run these in separate terminals:

```bash
# OSS API server (http://localhost:4890)
bun run dev

# OSS Vite client (http://localhost:5173)
bun run dev:client:oss
```

### 3. Sign in locally with your token

On server startup, Agendex prints a local auth token. Paste that token into the login modal in the web app.

## Adapter Selection

On first server startup, Agendex prompts for enabled adapters and stores the result in the shared config file (see [Configuration and Environment](#configuration-and-environment) for prod vs dev paths).

In non-interactive environments, Agendex auto-enables default adapters.

Re-open adapter selection:

```bash
bun run dev -- --configure-adapters
bun run --cwd ./packages/app start -- --configure-adapters
```

## Custom Plan Sources

Agendex also scans:

- User-created fallback plans in `<config-dir>/plans/`
- Project-local plan directories discovered as `.sisyphus/plans` and `@plans`
- User-configured custom plan directories

Manage custom directories from the local app's plan sources dialog, the local API, or the CLI:

```bash
bun run cli -- add-dir ~/path/to/plans
bun run cli -- add-dir ~/path/to/plans --live
bun run cli -- list-dirs
bun run cli -- remove-dir ~/path/to/plans
```

`--live` notifies a running local server so it scans and watches the new directory immediately.

## Useful Commands

From repo root:

```bash
bun run dev                 # run OSS API server (@agendex/app) on :4890
bun run dev:client:oss      # run OSS client on :5173
bun run dev:client:ee       # run EE client on :5174
bun run build               # build OSS client bundle
bun run build:cloud         # build EE client bundle

bun run cli:start           # start cloud sync daemon
bun run cli:login           # browser login using https://app.agendex.dev
bun run cli:login --url https://example.com
bun run cli:login --dev     # login using dev config dir (~/.agendex-dev) + dev default site URL
bun run cli:open            # open the Agendex web app in your default browser
bun run cli:open --url https://example.com
bun run cli:view https://app.agendex.dev/shared/<token>
bun run cli:logout          # clear stored cloud token
bun run cli:configure       # select which agents/adapters to index
bun run cli:hooks -- status            # show Claude Code, Codex, and Pi hook status
bun run cli:hooks -- install <agent|all>   # install hook integration (claude-code requires --preview)
bun run cli:hooks -- uninstall <agent|all> # remove managed Agendex hook entries
bun run cli:review-plan --hook --agent <agent>  # hook-native plan review entrypoint
bun run cli:sync            # one-shot cloud sync
bun run cli:sync --force    # re-sync all plans, ignoring cache
bun run cli:upload ~/path/to/plan.md          # upload a single Markdown plan to the cloud
bun run cli:upload ~/path/to/plan.md --agent codex  # override the plan's agent label
bun run cli:upload ~/path/to/plan.md --open   # upload and open the plan in the browser
bun run cli:stop            # stop daemon
bun run cli:cleanup         # interactively remove cloud daemon records
bun run cli:cleanup --stale
bun run cli:status          # print current local/cloud config state
bun run cli:upgrade         # upgrade the globally installed CLI
# Append `--dev` to any `cli:*` script to use ~/.agendex-dev (see packages/cli README)

bun run changeset           # create a release note for agendex-cli
bun run version-packages    # apply pending Changesets versions
bun run build:cli:release   # generate packages/cli/.release
bun run pack:cli:dry-run    # inspect the generated npm tarball
bun run smoke:cli:release   # smoke-test the packed CLI under Node

bun run fmt                 # oxfmt
bun run fmt:check
bun run lint
bun run lint:fix
bun run check
bun run check:fix
```

The published CLI is Node-compatible and can be installed with `curl -fsSL https://agendex.dev/install.sh | bash` or directly with `npm`, `pnpm`, `yarn`, or `bun`. The default `agendex login` target is `https://app.agendex.dev`. For self-hosted logins, use `agendex login --url <site>` or `bun run cli:login -- --url <site>`. For a separate dev config directory and dev default login URL, use `agendex --dev ...` or `AGENDEX_DEV=1` (documented in [`packages/cli/README.md`](./packages/cli/README.md)).

## Local API (OSS)

Server routes are under `/api/v1` and require `Authorization: Bearer <token>`.

Key endpoints:

- `GET /api/v1/health`
- `GET /api/v1/plans`
- `GET /api/v1/plans/:id`
- `GET /api/v1/plans/:id/raw`
- `GET /api/v1/agents`
- `POST /api/v1/rescan`
- `GET /api/v1/plan-sources`
- `POST /api/v1/plan-sources` with `{ "path": "/path/to/plans" }`
- `DELETE /api/v1/plan-sources` with `{ "path": "/path/to/plans" }`
- `PUT /api/v1/plans/:id` -> returns `403` in OSS (Cloud Pro only)
- `POST /api/v1/plans` -> returns `403` in OSS (Cloud Pro only)

WebSocket updates:

- `GET /api/v1/ws?token=<token>`

## Configuration and Environment

Local config (from `@agendex/shared`, used by the OSS API and the CLI):

- **Prod (default):** `~/.agendex/config.json`
- **Dev:** `~/.agendex-dev/config.json` when `AGENDEX_DEV=1` is set in the process environment (the CLI also accepts a `--dev` flag; see [`packages/cli/README.md`](./packages/cli/README.md))
- **Override:** `AGENDEX_CONFIG_DIR=/custom/path`

The same config directory also contains CLI/runtime files such as `daemon.pid`, `sync-cache.json`, `plannotator-writebacks-delivered.json`, and the `plans/` fallback directory.

Config fields:

- `token` (local API auth token)
- `cloudToken` and `convexUrl` (after CLI login)
- `deviceId` (cloud daemon identity)
- `enabledAdapters`
- `customPlanDirs`

Common environment variables:

- OSS app:
  - `PORT` (default `4890`)
  - `AGENDEX_TOKEN` (override generated local token)
  - `AGENDEX_DEV=1` (use `~/.agendex-dev/` for shared config; align with `agendex --dev` when running both server and CLI)
  - `AGENDEX_CONFIG_DIR` (override the config directory)
  - `VITE_ALLOWED_HOSTS` (comma-separated extra Vite allowed hosts)
- CLI (see `packages/cli/README.md` for full list):
  - `AGENDEX_DEV=1` or `agendex --dev` - dev config directory and dev default login URL
  - `AGENDEX_CONFIG_DIR` - override the config directory
  - `AGENDEX_SITE_URL` - override login and `agendex open` site URL
  - `AGENDEX_DISABLE_BROWSER=1` - skip launching the browser for `login` and `open` (URL is still printed)
  - `AGENDEX_TOKEN` - override local token read from config
  - `AGENDEX_PLANNOTATOR_SYNC=0|1` - disable or force Plannotator sync/write-back polling
  - `AGENDEX_LIVE_SESSION_POLL_MS` - Plannotator live-session poll interval (daemon; `0` disables)
  - `AGENDEX_SYNC_RESCAN_INTERVAL_MS` - safety-net rescan interval (daemon; `0` disables)
  - `AGENDEX_WATCHER_REFRESH_INTERVAL_MS` - watch-path rediscovery interval (daemon; `0` disables)
  - `AGENDEX_DISABLE_LOCAL_IP=1` - omit local IP from sync provenance metadata
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
