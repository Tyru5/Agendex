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

Deno (from [JSR](https://jsr.io/@agendex/cli)):

```bash
deno install -g -A -n agendex jsr:@agendex/cli
```

Under Deno, the OpenCode and T3 Code adapters can't read their databases: `better-sqlite3`'s native build doesn't run in a global Deno install.

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
agendex download <query>       # Download a cloud plan by id, name, or name + agent
agendex download <query> --agent <name> --format md|html --out <path> [--force]
agendex browse                 # Interactively select, view, save, or open a cloud plan
agendex browse --agent <name> --format md|html --out <path> [--force]
agendex mcp                    # Serve local plans + receipts to coding agents over MCP (stdio)
agendex mcp --workspace <dir>  # Same, scoped to <dir> when the client doesn't start it in the project
agendex why src/auth.ts        # Find local plans mentioning or changing a file
agendex why src/auth.ts --workspace /path/to/repo --limit 10 --json
agendex hooks status           # Inspect installed agent review hooks
agendex hooks install pi       # Install the manual Pi extension
agendex hooks install claude-code # Install the ExitPlanMode approval gate
agendex review-plan --file ./plan.md # Wait for approval in the local Reviews queue
agendex hooks uninstall all    # Remove Agendex-managed hooks
agendex capture-plan --agent antigravity < hook-payload.json  # Capture an explicit plan
agendex cleanup                # Interactively remove cloud daemons
agendex cleanup --stale        # Auto-remove all stale daemons
agendex status                 # Show config state, daemon status, uptime & hostname
agendex help                   # Show help message
agendex --version / -v         # Print CLI version
```

## Find plans for a file

`agendex why <file>` scans configured local plan sources and returns related plans across agents,
newest first. Each result distinguishes a plan mention from a change in an attributed commit and
includes receipt status and confidence. It needs no login, daemon, or running API server.
Use `--workspace <dir>` to resolve relative paths in another repository, `--limit <1-100>` to bound
results (default 20), and `--json` for machine-readable output. Quote paths containing spaces.

The dashboard also supports `file:src/auth.ts` and `file:"src/auth flow.ts"`. Combine these
with text or workspace filters; up to eight file filters require a plan to match every file.
Click the related-plan count beside a source link to search for that file in its workspace.
Cloud lookup finds synced text mentions only; commit attribution remains a local repository feature.

## Use Agendex from your agents (MCP)

`agendex mcp` runs a read-only [Model Context Protocol](https://modelcontextprotocol.io) server over
stdio, so any coding agent can check what other agents already planned on this machine and whether
that work landed. It reads the same local index as the dashboard (the adapters from
`agendex configure`); no login, cloud, or daemon needed.

Tools:

- `search_plans { query, workspace?, agent?, all_workspaces?, limit? }` — ranked plans with a snippet
  and a receipt summary.
- `get_plan { id, workspace?, all_workspaces?, max_chars? }` — full markdown (first 60,000 characters by default), metadata, and
  the full receipt: attributed commits, changed / untouched / missing files, and unplanned changes.
- `plans_for_file { path, workspace?, limit? }` — plans that mention a file or whose commits changed it.
- `recent_plans { workspace?, agent?, since?, limit? }` — newest plans first; `since` takes an ISO
  date or `24h`, `7d`, `2w`.

Receipt status is `planned`, `in-progress`, `landed`, `stalled`, or `unavailable`, worked out from
the plan's git repository without an LLM. A landed receipt means an attributed post-plan commit
is on the default branch; it does not prove every task was completed. Missing repository access
or trackable file mentions produces an unavailable receipt.

By default, tools use the git repository of the directory the server starts in. Pass `workspace`
to select another project, or start with `--workspace <dir>` to pin the default. `search_plans`
and `get_plan` also accept `all_workspaces: true`; `get_plan` otherwise refuses IDs outside the
selected workspace. For `plans_for_file`, an absolute path selects that file's repository;
relative paths use the selected workspace. `limit` defaults to 10 (max 50), and `max_chars`
defaults to 60,000 (max 200,000). The first tool call waits for the initial scan; retry a tool
call if a transient scan error occurs.

Search matches every term, with double quotes for phrases, and ranks results by relevance.
For example, ask your agent to call `search_plans` with
`{"query":"auth \"refresh token\"","limit":5}`, then pass one returned ID to `get_plan`.
Use `recent_plans` with `{"since":"7d"}` to catch up on the current repository, or
`plans_for_file` with `{"path":"src/auth.ts"}` before editing a file.

Claude Code:

```bash
claude mcp add agendex -- agendex mcp
claude mcp add --scope user agendex -- agendex mcp   # every project
```

Codex (`~/.codex/config.toml`, or `.codex/config.toml` in a trusted project):

```bash
codex mcp add agendex -- agendex mcp
```

```toml
[mcp_servers.agendex]
command = "agendex"
args = ["mcp"]
```

Cursor (`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "agendex": {
      "type": "stdio",
      "command": "agendex",
      "args": ["mcp", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

Any other stdio client: run `agendex mcp` as the command (add `--workspace <dir>` if the client
doesn't start servers in the project directory). Stdout carries only JSON-RPC; logs go to stderr.

## Agent hooks

Claude Code review hooks now wait for decisions in the authenticated local app’s **Reviews** queue. Approval is bound to the exact plan snapshot and disk revision. Request changes, rejection, cancellation, timeout and source edits return explicit denial. The installer uses Claude settings files and preserves unrelated settings/hooks.

Codex Stop remains an unsupported preview integration: it is a continuation hook rather than a plan-permission gate. Pi commands are manual. Use `agendex review-plan --file <plan.md>` for explicit review workflows. See [live plan approval documentation](../../docs/plan-approval-gates.md) for cross-device access and lifecycle limits.

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

To recover a locally hidden plan without editing its source, use **Hidden plans** in the local
dashboard sidebar or **Plan sources and recovery**. Inspect the classifier reasons, restore the
plan, then sync again from that device. The override is stored in the shared local config and
persists across scans; undoing it returns the plan to automatic classification.

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

The check is skipped for `stop`, `status`, `login`, `logout`, `open`, `cleanup`, `download`, `upload`, and `help`.

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

## Download a plan

`agendex download` fetches one of your cloud plans and writes it to disk. The query can be a cloud plan id, a local plan id, the plan title, or the title plus agent (`claude-code/Add auth`, `Add auth --agent claude-code`). Title matching is case-insensitive and accepts a unique prefix or substring.

If a name is missing or matches more than one plan, the CLI prints numbered quick-select options. In a TTY you can pick a number instead of retyping a long title; otherwise each option includes a short `agendex download <id>` command.

```bash
agendex download k57abc123
agendex download "Add auth"
agendex download "Add auth" --agent claude-code
agendex download claude-code/"Add auth" --format html --out ./exports
agendex download "Add auth" --out -
agendex download "Add auth" --force
```

`--format` accepts `md` (default) or `html`. If `--out` ends in `.html` or `.md` and `--format` is omitted, the extension selects the format. Use `--out -` to write the file contents to stdout. Existing files are left untouched unless you pass `--force`. PDF export remains a web-app action.

## Browse plans

`agendex browse` lists your cloud plans in an interactive picker, then lets you view the Markdown in the terminal, save it with the same destination rules as `download`, or open the written file on this machine. An optional filter or `--agent` narrows the list.

The command requires a TTY and a logged-in cloud session. In a non-interactive environment, use `agendex download <query>` instead.

```bash
agendex browse
agendex browse --agent claude-code
agendex browse "Add auth" --format md --out ./exports
```

`--format`, `--out`, and `--force` apply when you choose Save or Open. View always prints Markdown. Open uses the OS file handler (`open` / `xdg-open` / `start`) and honors `AGENDEX_DISABLE_BROWSER=1`.

## Open the web app

`agendex open` launches your default browser to the same base URL as the default login target (`https://app.agendex.dev` in prod, or the local EE dev URL when using `--dev` / `AGENDEX_DEV=1`). Override with `agendex open --url <url>` or `AGENDEX_SITE_URL`.

If launching the browser is undesirable (for example in CI), set `AGENDEX_DISABLE_BROWSER=1`; the CLI still prints the URL to visit.
