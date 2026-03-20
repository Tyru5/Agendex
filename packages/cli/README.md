# `agendex-cli`

Node-compatible Agendex CLI for browser login, one-shot sync, daemon supervision, and status checks.

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
agendex status                 # Show config state, daemon status, uptime & hostname
agendex help                   # Show help message
agendex --version / -v         # Print CLI version
```

## Status Output

`agendex status` prints a rich overview:

- Config version, local/cloud token state, Convex URL
- Enabled adapters
- Daemon running state with PID
- **Uptime** — how long the daemon has been running
- **Hostname** — machine the daemon is running on
- CLI version

## Auto-Update Check

Before running `start`, `configure`, or `sync`, the CLI checks for a newer published version. If an update is required the command is blocked and you are prompted to upgrade:

```
[agendex] update required: v0.1.0 → v0.2.0
[agendex] run: npm i -g agendex-cli
```

The check is skipped for `stop`, `status`, `login`, `logout`, and `help`.

## Supported Runtime

- Runtime: Node.js 20+
- Installers: `npm`, `pnpm`, `yarn`, and `bun`

## Self-Hosted Login

The default login target is `https://agendex.dev`.

For self-hosted deployments, always pass your site URL explicitly:

```bash
agendex login --url https://agendex.yourdomain.com
```

This opens your deployment's OAuth flow and stores the returned `cloudToken` and `convexUrl` in `~/.agendex/config.json`.
