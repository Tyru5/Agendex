# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # install all workspace deps
bun run dev              # web server w/ hot reload (port 4890)
bun run dev:client       # vite dev server (port 5173, proxies /api -> 4890)
bun run build            # build client to packages/web/src/client/dist
```

Run both `dev` and `dev:client` simultaneously during development.

## Monorepo Structure

Bun workspaces monorepo with three packages:

```
packages/
  shared/    → types, adapters, config, plan-service, watcher (used by CLI + web)
  cli/       → @agendex/cli — daemon + one-shot sync to cloud
  web/       → @agendex/web — React client + Hono server + Convex backend
```

### `@agendex/shared` (`packages/shared/`)

Core abstractions shared between CLI and web server.

- `src/types.ts` — `Plan` + `AgentAdapter` interfaces
- `src/hash.ts` — centralized `hashPath()` (SHA-256, first 16 hex chars)
- `src/config.ts` — `~/.agendex/config.json` schema (v3: token, cloudToken, convexUrl, enabledAdapters)
- `src/adapters/` — adapter catalog, registry, all agent adapters (claude-code, cursor, codex-cli, continue-ide, oh-my-opencode, stubs)
- `src/services/plan-service.ts` — in-memory plan store with `onPlansChanged` callback (decoupled from Fuse.js)
- `src/services/watcher.ts` — fs.watch on adapter paths, debounced rescan
- `src/setup/adapter-selection.ts` — interactive TTY adapter picker

### `@agendex/web` (`packages/web/`)

- `src/server/` — Hono server (auth, routes, Fuse.js search wired via `setOnPlansChanged`)
- `src/client/` — React 19 + Vite + Tailwind v4 dashboard
- `convex/` — Convex backend (plans, comments, sharing, auth w/ better-auth bearer plugin, CLI sync HTTP actions)

### `@agendex/cli` (`packages/cli/`)

- `src/cli.ts` — entry point (`agendex start|login|logout|sync|status`)
- `src/daemon.ts` — persistent watcher + cloud sync
- `src/auth.ts` — browser OAuth flow (opens agendex.dev/auth/cli)
- `src/sync.ts` — one-shot scan + push
- `src/api.ts` — HTTP client for Convex actions

## Key Patterns

- Plan IDs are SHA-256 hashes of file paths (first 16 hex chars)
- Server port defaults to 4890 (`PORT` env)
- Vite proxies `/api` to server during dev
- Dashboard supports local + cloud mode toggle (auto-switches to cloud when backend offline)
- Adding a new agent: implement `AgentAdapter` in `packages/shared/src/adapters/`, register in `catalog.ts`
- CLI auth: `agendex login` opens browser OAuth, stores cloudToken + convexUrl in config
