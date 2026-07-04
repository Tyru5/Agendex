# `agendex-cli`

Node-compatible Agendex CLI for browser login, opening the web app, one-shot sync, daemon supervision, status checks, and daemon cleanup.

## Install

Recommended one-line installer:

```bash
# macOS / Linux
curl -fsSL https://agendex.dev/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://agendex.dev/install.ps1 | iex
```

Or install directly with your package manager:

```bash
npm install -g agendex-cli
pnpm add -g agendex-cli
yarn global add agendex-cli
bun install -g agendex-cli
```

Installer options:

```bash
curl -fsSL https://agendex.dev/install.sh | bash -s -- --version 1.2.3
curl -fsSL https://agendex.dev/install.sh | bash -s -- --pm pnpm
```

```powershell
& ([scriptblock]::Create((irm https://agendex.dev/install.ps1))) -Version 1.2.3
& ([scriptblock]::Create((irm https://agendex.dev/install.ps1))) -Pm pnpm
```

## Commands

```bash
agendex login                  # Authenticate via browser OAuth (agendex.dev)
agendex login --url <url>      # Login to a self-hosted instance
agendex open                   # Open the Agendex web app in your default browser
agendex open --url <url>       # Open a self-hosted deployment
agendex logout                 # Clear stored cloud token
agendex configure              # Select which agents/adapters to index
agendex start                  # Start daemon (backgrounds itself)
agendex stop                   # Stop the running daemon
agendex sync                   # One-shot scan + sync to cloud
agendex sync --force           # Re-sync all plans, ignoring the local hash cache
agendex upload <path>          # Upload a single Markdown plan file to the cloud
agendex upload <path> --agent <name>  # Override the uploaded plan's agent label
agendex upload <path> --open   # Open the uploaded plan in the browser after upload
agendex cleanup                # Interactively remove cloud daemons
agendex cleanup --stale        # Auto-remove all stale daemons
agendex status                 # Show config state, daemon status, uptime & hostname
agendex help                   # Show help message
agendex --version / -v         # Print CLI version
```

## Dev vs prod (config directory)

By default the CLI uses **`~/.agendex/`** for all on-disk state:

- `config.json` — local token, cloud token, Convex URL, device id, enabled adapters
- `daemon.pid` — supervisor PID and metadata
- `sync-cache.json` — hashes used to skip unchanged plans on sync

To use a **separate dev environment** (so local cloud / dev login does not overwrite prod credentials), use either:

- **`--dev`** on any command (recommended), or
- **`AGENDEX_DEV=1`** in the environment

That switches the directory to **`~/.agendex-dev/`** with the same filenames inside it.

`--dev` takes precedence when set programmatically; otherwise `AGENDEX_DEV=1` is read. When you start the daemon with `agendex start --dev`, the background supervisor and worker inherit `AGENDEX_DEV=1` so they stay on the dev config.

Examples:

```bash
agendex --dev login
agendex --dev status
AGENDEX_DEV=1 agendex sync
```

In dev mode the default OAuth site (when you do not pass `--url` and do not set `AGENDEX_SITE_URL`) points at the local EE app URL used for development.

## Plan Value Filtering

Agendex uses a shared plan-value classifier (`@agendex/shared`) to keep non-plans out of your library and cloud account. The same rules apply to local OSS indexing, `agendex sync`, and the background daemon.

**Locally indexed but hidden** (tagged `lowValue` in plan metadata, excluded from search and list views):

- Empty or whitespace-only content
- Heading-only markdown with no body
- Prompt-like one-liners, system context dumps, tool logs, conversation artifacts
- Execution reports, review output, wrapper titles
- Code-only or code-dominated markdown without plan structure
- Content with no recognizable planning signals (unstructured one-liners, generic session dumps)

**Cloud sync behavior:**

- Indexable plans upload normally.
- Low-value plans are still sent on sync so the cloud can **prune** them: existing cloud copies are deleted and new low-value uploads are skipped.
- Sync output includes counts such as `N low-value skipped/pruned (M deleted)` when pruning runs.

Low-value tagging happens during scan/rescan. If you edit a file into a real plan, the next scan clears the tag and sync uploads it again. Version restore in the cloud rejects low-value snapshots; browse history on a hidden plan to find and restore a good snapshot.

## Sync Provenance

`agendex sync` and the daemon include sync provenance in cloud payload metadata so the web app can show where a plan was synced from. This includes the device ID, hostname, and the host machine's local IP address when one is available.

You can disable local IP address collection from Account settings in the cloud app. Managed or non-interactive environments can also omit the local IP address from sync payloads by setting:

```bash
AGENDEX_DISABLE_LOCAL_IP=1 agendex sync
```

## Real-Time Cloud Sync (Daemon)

While `agendex start` is running, the daemon watches local plan sources and uploads changes to your cloud account. The cloud web app updates reactively once uploads land (no manual refresh).

**How uploads are scheduled:**

1. File watchers (plus periodic rescans) trigger a local rescan when plans change.
2. Each changed plan is converted to a sync payload and enqueued. The queue **deduplicates by plan id** (last write wins).
3. **`sync-cache.json`** stores content hashes so unchanged plans are skipped (same as one-shot sync). Use `agendex sync --force` to bypass the cache for a manual full upload.
4. Before each upload, the daemon re-checks that the queued payload is still the latest edit for that plan (so a slow retry cannot overwrite a newer change).
5. Failed uploads retry automatically with exponential backoff (**2s → 8s → 30s**, up to three attempts) before the daemon logs a permanent failure.

Low-value plans follow the same queue and pruning rules as [Plan Value Filtering](#plan-value-filtering).

| Variable                              | Default  | Purpose                                                                                                    |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `AGENDEX_LIVE_SESSION_POLL_MS`        | `2000`   | Poll active Plannotator live sessions (re-fetch loopback plan content). Set to `0` to disable.             |
| `AGENDEX_SYNC_RESCAN_INTERVAL_MS`     | `60000`  | Safety-net full rescan + hash-diff upload when `fs.watch` misses an event. Set to `0` to disable.          |
| `AGENDEX_WATCHER_REFRESH_INTERVAL_MS` | `300000` | Re-discover watch directories (new Cursor projects, `@plans` folders, custom dirs). Set to `0` to disable. |

Typical latency after a local edit: **~0.5–2s** for file-based agents (Cursor, Claude Code, markdown snapshots); **~2–3s** for Plannotator live-session-only edits (loopback poll).

## Daemon Cleanup

`agendex cleanup` manages registered daemon devices in the cloud.

**Interactive mode** (default) — presents a multiselect prompt listing all daemons with hostname, PID, and alive/stale status. Select which ones to remove.

**Auto mode** — `agendex cleanup --stale` removes all stale daemons without prompting. Useful for CI or non-TTY environments.

Requires login. In non-TTY environments without `--stale`, the command exits with an error.

## Status Output

`agendex status` prints a rich overview:

- Config version, local/cloud token state, Convex URL
- Enabled adapters
- Daemon running state with PID
- **Uptime** — how long the daemon has been running
- **Hostname** — machine the daemon is running on
- **All registered daemons** — hostname, PID, uptime, and alive/stale status for every device in the cloud
- CLI version

## Auto-Update Check

Before running `start`, `configure`, or `sync`, the CLI checks for a newer published version. If an update is required the command is blocked and you are prompted to upgrade:

```
[agendex] update required: v0.1.0 → v0.2.0
[agendex] run: npm i -g agendex-cli
```

The check is skipped for `stop`, `status`, `login`, `logout`, `open`, `cleanup`, and `help`.

## Supported Runtime

- Runtime: Node.js 20+
- Installers: `npm`, `pnpm`, `yarn`, and `bun`

## Self-Hosted Login

The default login target is `https://app.agendex.dev`.

For self-hosted deployments, pass your site URL explicitly:

```bash
agendex login --url https://agendex.yourdomain.com
```

This opens your deployment's OAuth flow and stores the returned `cloudToken` and `convexUrl` in your active config directory (`~/.agendex/config.json` for prod, `~/.agendex-dev/config.json` when using `--dev` or `AGENDEX_DEV=1`).

The target can also be set via `AGENDEX_SITE_URL` env var. For local development against the default dev app URL, use `agendex login --dev` or set `AGENDEX_DEV=1` (see [Dev vs prod](#dev-vs-prod-config-directory) above).

## Open the web app

`agendex open` launches your default browser to the same base URL as the default login target (`https://app.agendex.dev` in prod, or the local EE dev URL when using `--dev` / `AGENDEX_DEV=1`). Override with `agendex open --url <url>` or `AGENDEX_SITE_URL`.

If launching the browser is undesirable (for example in CI), set `AGENDEX_DISABLE_BROWSER=1`; the CLI still prints the URL to visit.
