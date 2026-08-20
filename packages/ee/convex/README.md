# Agendex EE Convex Backend

This directory contains the Convex backend for Agendex Cloud / EE. It powers authentication, subscription state, share links, comments, cloud plan storage, plan history, and the CLI sync endpoints used by the daemon and one-shot sync flows.

## What Lives Here

- Better Auth integration for dashboard and CLI authentication
- Convex tables and indexes for plans, comments, share links, subscriptions, daemon heartbeats, tags, collections, and plan history snapshots
- Stripe-backed subscription and portal flows
- HTTP endpoints for Stripe webhooks and CLI sync, refresh, and heartbeat requests

## Key Files

- `auth.ts` - Better Auth setup, GitHub provider wiring, Convex adapter, and trusted origins
- `http.ts` - registers auth routes, Stripe webhook handling, and CLI HTTP endpoints
- `subscriptions.ts` - trial start and skip flows, checkout and portal sessions, and webhook-driven subscription sync
- `cli.ts` - cloud plan upsert flow, token refresh, daemon heartbeat writes, and daemon status queries (clients authenticate with a session token from `agendex login`; open the dashboard in a browser with `agendex open`; the CLI keeps `cloudToken` and `convexUrl` under `~/.agendex`, or `~/.agendex-dev` when using `agendex --dev` / `AGENDEX_DEV=1` — see `packages/cli/README.md`)
- `plans.ts` - EE plan retrieval helpers and shared plan access
- `planVisibility.ts` - shared low-value plan classification on ingest, metadata merge, and visibility gates for reads
- `planVersions.ts` - plan history listing, snapshot reads, and restore flow
- `planVersioning.ts` - shared helpers that write `planVersions` snapshots on create, CLI sync, editor save, and restore
- `planCleanup.ts` - internal dry-run audit and apply cleanup for existing low-value cloud rows and Codex subagent/title-family clones (maintainer-only)
- `sharing.ts` - create and revoke share links
- `comments.ts` - read, create, and delete plan comments
- `collections.ts` - collection-level EE feature logic
- `tags.ts` and `planTags.ts` - tag and plan-tag feature support
- `entitlements.ts` - subscription gating for Pro features
- `schema.ts` - table definitions and indexes
- `_generated/` - Convex-generated client and server artifacts managed by the Convex CLI

## Required Environment Variables

### Auth and site configuration

- `SITE_URL`
- `CONVEX_SITE_URL`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `BETTER_AUTH_SECRET`

### EE client configuration

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`
- optional `VITE_APP_URL`

### Billing

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_YEARLY_PRICE_ID`

Stripe variables are needed for checkout, customer portal, and paid subscription lifecycles. They are not required to understand the backend structure or bring up the EE UI locally before you wire billing.

## Important HTTP Routes

- `POST /api/cli/sync` - upsert a plan into the cloud for the authenticated user
- `POST /api/cli/refresh` - refresh the CLI session token
- `POST /api/cli/heartbeat` - update daemon liveness
- `GET /api/cli/plan` - download one cloud plan by id, title, or agent + title
- `GET /api/cli/plans` - list recent cloud plans for interactive CLI browse
- `/stripe/webhook` - Stripe webhook receiver registered through `@convex-dev/stripe`

Auth routes are also registered through Better Auth in `http.ts`.

## Low-Value Plan Handling

Cloud sync reuses the same plan-value classifier as the OSS app and CLI (`packages/shared/src/services/plan-value.ts`, wired through `planVisibility.ts`).

On `POST /api/cli/sync`:

- Indexable plans upsert normally.
- Low-value payloads are not stored as visible plans. If a matching cloud row already exists for the user/device, it is **deleted** (prune). The HTTP response includes `skippedLowValue: true` and optional `lowValueReasons`.

Reads and writes elsewhere hide low-value rows (`isPlanVisibleForRead`). Plan version **restore** rejects low-value snapshots; **list/get version** remain available so owners can browse history and recover from an earlier good snapshot.

### Maintainer cleanup (existing rows)

For deployments that already accumulated low-value plans before filtering tightened, `planCleanup.ts` exposes **internal-only** Convex functions (not callable from the public client API):

- `auditLowValuePlans` — paginated dry-run summary (`mode: "dry-run"`)
- `cleanupLowValuePlans` — paginated delete of classified low-value rows (`mode: "apply"`)
- `auditCodexSubagentPlans` / `cleanupCodexSubagentPlans` — remove Codex multi-agent subagent clones and optional same-title codex session floods (`mode: "codex-subagent-dry-run"` / `"codex-subagent-apply"`)

Both require `PLAN_CLEANUP_ADMIN_TOKEN` to be set on the Convex deployment and passed as `adminToken` in the function args. Paginate with `cursor` / `continueCursor` until `isDone` is true. Review dry-run output before running apply.

Example (from `packages/ee`, after setting the env var on the deployment):

```bash
npx convex env set PLAN_CLEANUP_ADMIN_TOKEN "$(openssl rand -base64 32)"

# Dry-run first page (internal function — not exposed to clients)
npx convex run internal/planCleanup:auditLowValuePlans '{"adminToken":"<token>"}'

# Apply first batch (repeat with continueCursor until isDone)
npx convex run internal/planCleanup:cleanupLowValuePlans '{"adminToken":"<token>"}'

# Codex subagent / same-title clone cleanup (dry-run then apply).
# titleContains scopes title-family collapse to matching codex session rollouts
# (keeps one winner per exact title per owner). keepPlanId forces the winner when present.
npx convex run planCleanup:auditCodexSubagentPlans '{"adminToken":"<token>","titleContains":"drawing board","keepPlanId":"<canonical-plan-id>"}'
npx convex run planCleanup:cleanupCodexSubagentPlans '{"adminToken":"<token>","titleContains":"drawing board","keepPlanId":"<canonical-plan-id>","continue":true}'
```

## Local Development

Use the EE stack together with the OSS API server:

```bash
# from packages/ee
npx convex dev

# from repo root
bun run dev

# from repo root
bun run dev:client:ee
```

That gives you:

- Convex backend watching `packages/ee/convex`
- OSS API on `http://localhost:4890`
- EE UI on `http://localhost:5174`
- `/api` requests from the EE UI proxied to the OSS API

For self-hosted CLI logins, pass `--url` explicitly. The current in-repo CLI auth source defaults to `http://localhost:5174` unless overridden.

## Deployment Notes

- Run `npx convex deploy` from `packages/ee` to deploy the backend.
- Treat `_generated/` as Convex-managed output.
- Keep this README focused on Agendex-specific behavior and operational details rather than generic Convex examples.
