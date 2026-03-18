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
agendex login
agendex login --url https://agendex.yourdomain.com
agendex configure
agendex start
agendex stop
agendex sync
agendex status
agendex logout
```

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
