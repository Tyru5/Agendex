# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # install all workspace deps
bun run dev              # OSS web server w/ hot reload (port 4890)
bun run dev:client       # OSS vite dev server (port 5173, proxies /api -> 4890)
bun run build            # build OSS client to packages/app/src/client/dist
bun run build:cloud      # build EE client
bun run format           # biome format
bun run cli:start        # start CLI daemon
bun run cli:login        # CLI login flow
bun run cli:sync         # one-shot sync
bun run cli:status       # check CLI status
```

Run both `dev` and `dev:client` simultaneously during development.

## Monorepo Structure

Bun workspaces monorepo with four packages:

```
packages/
  shared/    → types, adapters, config, plan-service, watcher (used by CLI + app + ee)
  app/       → @agendex/app — OSS: React client + Hono server (local-only, no auth/cloud)
  ee/        → @agendex/ee — Pro: cloud dashboard + Convex backend (auth, subscriptions, sharing)
  cli/       → @agendex/cli — daemon + one-shot sync to cloud
```

### `@agendex/shared` (`packages/shared/`)

Core abstractions shared across all packages.

- `src/types.ts` — `Plan`, `AgentAdapter` interfaces, `ProFeature` enum
- `src/hash.ts` — centralized `hashPath()` (SHA-256, first 16 hex chars)
- `src/config.ts` — `~/.agendex/config.json` schema (v3: token, cloudToken, convexUrl, enabledAdapters)
- `src/adapters/catalog.ts` — `AdapterId` union (44 agents), `AdapterCatalogEntry`, `AdapterGroup`, `getAdapterCatalog()`, `getCatalogDefaultAdapterIds()`, `resolveAdapterId()`
- `src/adapters/registry.ts` — `resolveAdapters()`, `setActiveAdapters()`, `getActiveAdapters()`, `sanitizeEnabledAdapterIds()`
- `src/adapters/` — implemented adapters: claude-code, cursor, codex-cli, continue-ide, oh-my-opencode; all others use `createStubAdapter()`
- `src/services/plan-service.ts` — in-memory plan store with `onPlansChanged` callback, `rescanFile()`, `getAgentStats()`
- `src/services/watcher.ts` — `fs.watch` on adapter paths, 300ms debounced rescan
- `src/setup/adapter-selection.ts` — interactive TTY adapter picker (`@clack/prompts`)
- `src/index.ts` — barrel re-export of all modules

### `@agendex/app` (`packages/app/`) — OSS

Pure local-only dashboard. No auth, no cloud, no Convex.

- `src/server/index.ts` — Hono server, Bun WebSocket, adapter loading, watcher, `plan:updated` broadcast
- `src/server/auth.ts` — bearer token middleware
- `src/server/routes/plans.ts` — REST: `/health`, `/plans`, `/plans/:id`, `/plans/:id/raw`, `/agents`, `/rescan`
- `src/server/services/search.ts` — Fuse.js full-text search
- `src/client/App.tsx` — OSS dashboard (no auth, no cloud mode, no paywall)
- `src/client/main.tsx` — bare React root with `NuqsAdapter` + `ThemeProvider`

#### OSS client hooks

- `useBackendStatus` — polls `/api/v1/health`
- `usePlans` + `useAgents` — local REST + WebSocket subscription
- `useSeenPlans` — localStorage-backed unseen tracking
- `useScrollSpy`, `useSocket`, `useTheme`

### `@agendex/ee` (`packages/ee/`) — Pro

Extends OSS by importing `@agendex/app` components directly by path. Adds cloud/auth/subscription features. Uses Convex as backend.

- `src/App.tsx` — Pro dashboard: local/cloud mode toggle, `isPro` gating, `PaywallGuard`, auth buttons, subscription badge
- `src/main.tsx` — wraps in `ConvexBetterAuthProvider`

#### EE-only components

`AuthButton`, `CliAuthPage`, `CloudUpgrade`, `CommentThread`, `PaywallGuard`, `PricingModal`, `SharedPlanView`, `SharePlanDialog`, `SubscriptionBadge`

#### EE client hooks

- `useAuth` — wraps `authClient.useSession()`
- `useCloudPlans` — `useQuery(api.plans.getMyPublishedPlans)`
- `usePublishing` — `useMutation(api.plans.publishPlan)`
- `useSubscription` — sub status, `isActive`, checkout/portal/reactivate

#### Convex backend (`packages/ee/convex/`)

Schema tables: `plans`, `shareLinks`, `comments`, `subscriptions`, `workspaceMembers`

Modules:
- `auth.ts` — better-auth w/ GitHub OAuth, bearer plugin
- `entitlements.ts` — `requirePro(ctx)`, `requireFeature(ctx, feature: ProFeature)` — throws if no active sub
- `plans.ts` — `publishPlan` (gated: `CLOUD_SYNC`), `getMyPublishedPlans`, `getPlanByShareToken`, `updatePlanContent`
- `sharing.ts` — `createShareLink` (gated: `SHARE_LINKS`), `revokeShareLink`, `getShareLinks`
- `comments.ts` — `getComments`, `addComment`, `deleteComment` (owner gated: `COMMENTS`; visitor validates share token)
- `subscriptions.ts` — `getMySubscriptionQuery`, `hasActiveSubscription`, `createCheckoutSession`, `createPortalSession`, `reactivateSubscription`
- `stripe.ts` — `@convex-dev/stripe` integration
- `cli.ts` — HTTP actions for `/api/cli/sync` and `/api/cli/refresh`; gated behind active subscription
- `http.ts` — auth routes, Stripe webhook handlers, CLI routes

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
- OSS dashboard is local-only; Pro dashboard adds local/cloud mode toggle
- Adding a new agent: implement `AgentAdapter` in `packages/shared/src/adapters/`, register in `catalog.ts`
- CLI auth: `agendex login` opens browser OAuth, stores cloudToken + convexUrl in config
- CLI sync + cloud publishing require active Stripe subscription
- Feature gating is dual-layered: server-side via `requireFeature(ctx, ProFeature.X)` in Convex mutations + client-side via `PaywallGuard`/`isPro` checks
- `ProFeature` enum: `CLOUD_SYNC`, `SHARE_LINKS`, `COMMENTS`, `PLAN_CREATION`, `TECH_CHARTS`, `UNSEEN_TRACKING`, `WORKSPACE_MEMBERS`
- EE imports OSS components directly by path (e.g. `@agendex/app/src/client/components/...`)
- Biome for formatting/linting (replaced Prettier)
