# `agendex-cli`

Node-compatible Agendex CLI for browser login, one-shot sync, daemon supervision, status checks, and daemon cleanup.

## Install

```bash
npm install -g agendex-cli
pnpm add -g agendex-cli
yarn global add agendex-cli
bun install -g agendex-cli
```

## Commands

```bash
agendex login                  # Authenticate via browser OAuth (agendex.dev)
agendex login --url <url>      # Login to a self-hosted instance
agendex logout                 # Clear stored cloud token
agendex configure              # Select which agents/adapters to index
agendex start                  # Start daemon (backgrounds itself)
agendex stop                   # Stop the running daemon
agendex sync                   # One-shot scan + sync to cloud
agendex cleanup                # Interactively remove cloud daemons
agendex cleanup --stale        # Auto-remove all stale daemons
agendex status                 # Show config state, daemon status, uptime & hostname
agendex help                   # Show help message
agendex --version / -v         # Print CLI version
```

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

The check is skipped for `stop`, `status`, `login`, `logout`, `cleanup`, and `help`.

## Supported Runtime

- Runtime: Node.js 20+
- Installers: `npm`, `pnpm`, `yarn`, and `bun`

## Self-Hosted Login

The default login target is `https://app.agendex.dev`.

For self-hosted deployments, pass your site URL explicitly:

```bash
agendex login --url https://agendex.yourdomain.com
```

This opens your deployment's OAuth flow and stores the returned `cloudToken` and `convexUrl` in `~/.agendex/config.json`.

The target can also be set via `AGENDEX_SITE_URL` env var. For local development, set `AGENDEX_DEV=1` to use the local dev server.
