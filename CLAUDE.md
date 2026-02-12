# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # install deps
bun run dev              # server w/ hot reload (port 4890)
bun run dev:client       # vite dev server (port 5173, proxies /api -> 4890)
bun run build            # build client to src/client/dist
bun run start            # production server
```

Run both `dev` and `dev:client` simultaneously during development.

## Architecture

Planfig is a local dashboard that indexes and displays AI agent plans/sessions from multiple coding tools (Claude Code, Cursor, Codex CLI, Continue IDE, etc.).

**Server** (`src/server/`) — Bun + Hono

- `index.ts` — entry point, mounts routes, serves static build, WebSocket broadcast for live updates
- `auth.ts` — bearer token auth, auto-generates token to `~/.planfig/config.json` (override: `PLANFIG_TOKEN` env)
- `routes/plans.ts` — REST API under `/api/v1` (GET/PUT plans, GET agents, POST rescan)
- `services/plan-service.ts` — in-memory `Map<string, Plan>` store, scan/rescan/search/update
- `services/search.ts` — Fuse.js full-text search over plans
- `services/watcher.ts` — fs.watch on adapter paths, debounced rescan + WebSocket broadcast

**Adapter system** (`src/server/adapters/`)

Core abstraction: `AgentAdapter` interface (`types.ts`) — each adapter defines search/watch paths, file matching, parsing, and optional write support. Registry (`registry.ts`) exports the full adapter list.

Implemented adapters: `claude-code` (md, writable), `cursor` (sqlite via bun:sqlite, read-only), `codex-cli` (jsonl), `continue-ide` (json). Remaining agents are stubs (`stub.ts`) — `createStub()` factory returns no-op adapters ready for implementation.

**Client** (`src/client/`) — React 19 + Vite + Tailwind v4

- `App.tsx` — token-gated Login/Dashboard split
- `lib/api.ts` — fetch wrapper with auth, auto-logout on 401
- `hooks/usePlans.ts` — data fetching hooks
- Components: SearchBar, AgentFilter, PlanList, PlanViewer (react-markdown), PlanEditor (CodeMirror)

Vite root is `src/client`, built output goes to `src/client/dist` (served by Hono in prod).

## Key Patterns

- Plan IDs are SHA-256 hashes of file paths (first 16 hex chars)
- Server port defaults to 4890 (`PORT` env)
- Vite proxies `/api` to server during dev
- Adding a new agent: implement `AgentAdapter` in `src/server/adapters/`, register in `registry.ts`
