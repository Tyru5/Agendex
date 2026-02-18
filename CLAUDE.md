# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # install all workspace deps
bun run dev              # web server w/ hot reload (port 4890)
bun run dev:client       # vite dev server (port 5173, proxies /api -> 4890)
bun run build            # build client to packages/web/src/client/dist
bun run format           # prettier format
bun run cli:start        # start CLI daemon
bun run cli:login        # CLI login flow
bun run cli:sync         # one-shot sync
bun run cli:status       # check CLI status
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
- `src/adapters/catalog.ts` — `AdapterId` union (44 agents), `AdapterCatalogEntry`, `AdapterGroup`, `getAdapterCatalog()`, `getCatalogDefaultAdapterIds()`, `resolveAdapterId()`
- `src/adapters/registry.ts` — `resolveAdapters()`, `setActiveAdapters()`, `getActiveAdapters()`, `sanitizeEnabledAdapterIds()`
- `src/adapters/` — implemented adapters: claude-code, cursor, codex-cli, continue-ide, oh-my-opencode; all others use `createStubAdapter()`
- `src/services/plan-service.ts` — in-memory plan store with `onPlansChanged` callback, `rescanFile()`, `getAgentStats()`
- `src/services/watcher.ts` — `fs.watch` on adapter paths, 300ms debounced rescan
- `src/setup/adapter-selection.ts` — interactive TTY adapter picker (`@clack/prompts`)
- `src/index.ts` — barrel re-export of all modules

### `@agendex/web` (`packages/web/`)

- `src/server/` — Hono server (auth, routes, Fuse.js search, WebSocket broadcast, `--configure-adapters` flag)
- `src/client/` — React 19 + Vite + Tailwind v4 dashboard
- `convex/` — Convex backend (plans, comments, sharing, subscriptions, auth w/ better-auth bearer plugin, CLI sync HTTP actions, Stripe webhooks)

#### Convex schema tables

- `plans` — ownerId, localPlanId, agent, title, content, format, filePath, workspace, metadata, version
- `shareLinks` — planId, token, createdBy, revokedAt
- `comments` — planId, authorId, authorName, body
- `subscriptions` — userId, stripeCustomerId, stripeSubscriptionId, status, plan (monthly/yearly), currentPeriodEnd, cancelAtPeriodEnd
- `workspaceMembers` — workspaceOwnerId, memberId, email, role (owner/member)

#### Convex modules

- `auth.ts` — better-auth w/ GitHub OAuth, bearer plugin
- `plans.ts` — `publishPlan` (requires active sub), `getMyPublishedPlans`, `getPlanByShareToken`
- `comments.ts` — `getComments`, `addComment`, `deleteComment`
- `sharing.ts` — `createShareLink`, `revokeShareLink`, `getShareLinks`
- `subscriptions.ts` — `getMySubscriptionQuery`, `createCheckoutSession`, `createPortalSession`, `reactivateSubscription`
- `stripe.ts` — `@convex-dev/stripe` integration
- `cli.ts` — HTTP actions for `/api/cli/sync` and `/api/cli/refresh`; CLI sync gated behind active subscription
- `http.ts` — auth routes, Stripe webhook handlers (`subscription.created/updated/deleted`), CLI routes

#### Client hooks

- `useAuth`, `useBackendStatus`, `usePlans`, `useCloudPlans`, `usePublishing`, `useSubscription`

### `@agendex/cli` (`packages/cli/`)

- `src/cli.ts` — entry point (`agendex start|login [--url <url>]|logout|sync|status`)
- `src/daemon.ts` — persistent watcher + cloud sync
- `src/auth.ts` — browser OAuth flow (opens `<siteUrl>/auth/cli`), supports self-hosted via `--url`
- `src/sync.ts` — one-shot scan + push
- `src/api.ts` — HTTP client for Convex actions (`syncPlan`, `refreshToken`)

## Key Patterns

- Plan IDs are SHA-256 hashes of file paths (first 16 hex chars)
- Server port defaults to 4890 (`PORT` env)
- Vite proxies `/api` to server during dev; supports ngrok via `VITE_ALLOWED_HOSTS`
- Dashboard supports local + cloud mode toggle (auto-switches to cloud when backend offline)
- Adding a new agent: implement `AgentAdapter` in `packages/shared/src/adapters/`, register in `catalog.ts`
- CLI auth: `agendex login` opens browser OAuth, stores cloudToken + convexUrl in config
- CLI sync requires active Stripe subscription
- Publishing plans to cloud requires active subscription (enforced in `publishPlan` mutation)
