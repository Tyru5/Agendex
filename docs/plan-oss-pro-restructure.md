# Plan: Open Source vs Pro Architecture Restructure

> **Status**: Draft  
> **Priority**: Critical (Phase 1), High (Phases 2–4)  
> **Estimated effort**: ~3–4 days total

---

## Problem Statement

Agendex is an open-core product (free self-hosted + paid Cloud Pro), but the codebase
does not correctly separate OSS from Pro code. This creates **security vulnerabilities**,
**structural confusion**, and **no legal licensing boundary**.

### Key Issues Identified

1. **Security**: 3 Pro Convex mutations (`createShareLink`, `addComment`, `deleteComment`)
   have **no subscription check** — any authenticated user can use Pro features for free.
2. **Security**: Comment/sharing capability model is broken — non-owners don't need to
   present the share token to comment, only need a `planId`.
3. **Structure**: All code (OSS local server, Pro Convex backend, Stripe billing, Pro UI)
   lives in a single `packages/web/` package.
4. **Licensing**: No `LICENSE` file exists. No legal boundary between OSS and proprietary code.
5. **Bundle**: Pro UI components (PaywallGuard, PricingModal, ShareDialog, CommentThread)
   ship in the OSS client bundle — unnecessary for self-hosters and easy to strip.

---

## Phase 1: Fix Backend Security (Critical — Day 1)

**Goal**: Every Pro operation is enforced server-side. Client-side gates become UX-only.

### 1.1 Create centralized entitlement helper

Create `convex/entitlements.ts`:

```ts
// Single source of truth for Pro enforcement
export async function requirePro(ctx): Promise<void>
// Calls hasActiveSubscription, throws ConvexError if not active
```

This replaces the inline `hasActiveSubscription` call in `plans.ts` and gives every
mutation a single function to call.

### 1.2 Add `requirePro()` to all Pro mutations

| File | Function | Current State | Action |
|------|----------|---------------|--------|
| `convex/sharing.ts` | `createShareLink` | ❌ No check | Add `requirePro(ctx)` |
| `convex/sharing.ts` | `revokeShareLink` | ❌ No check | Add `requirePro(ctx)` |
| `convex/sharing.ts` | `getShareLinks` | ❌ No check | Add `requirePro(ctx)` |
| `convex/comments.ts` | `addComment` | ❌ No check | Add `requirePro(ctx)` for plan owner |
| `convex/comments.ts` | `deleteComment` | ❌ No check | Add `requirePro(ctx)` for plan owner |
| `convex/plans.ts` | `publishPlan` | ✅ Has check | Migrate to `requirePro()` |
| `convex/plans.ts` | `updatePlanContent` | ❌ No check | Add `requirePro(ctx)` |
| `convex/cli.ts` | `sync` httpAction | ✅ Has check | Keep (already checks `hasUserSubscription`) |

### 1.3 Fix sharing/comment capability model

**Problem**: `addComment` and `getComments` allow any authenticated user if *any* active
share link exists for the plan. They don't verify the caller possesses the token.

**Fix**:
- Add optional `token` arg to `addComment` and `getComments`
- For non-owner callers: require `token`, validate it matches the plan and is not revoked
- For owner callers: require Pro subscription (via `requirePro`)

```
getComments({ planId, token? })
  → owner? → requirePro, return comments
  → non-owner? → require token arg, validate token matches planId, return comments

addComment({ planId, body, token? })
  → owner? → requirePro, insert comment
  → non-owner? → require token arg, validate token, insert comment
```

### 1.4 Decide product policy for shared plan viewers

Document the decision clearly:
- **Can shared-link viewers comment?** Current behavior allows it (if signed in).
  If yes → validate token, don't require Pro for the viewer.
  If no → only Pro owners can comment on their own plans.
- **Can shared-link viewers view without sign-in?** Currently yes (via `getPlanByShareToken`).
  Keep this — it's good for virality.

### 1.5 Verification

- Manually test each mutation without a subscription → should get `ConvexError`
- Manually test commenting via share link with valid token → should work
- Manually test commenting without token (non-owner) → should be denied
- Verify `publishPlan` still works for Pro users
- Verify CLI `sync` still works for Pro users

---

## Phase 2: Licensing & Documentation (Day 1–2)

**Goal**: Establish clear legal boundaries between OSS and Pro code.

### 2.1 Add root LICENSE file

Choose license for OSS core. Recommendation: **AGPLv3** (prevents competitors from
hosting a fork without contributing back) or **MIT** (more permissive, simpler).

The root `LICENSE` should state:
```
All content in this repository is licensed under [AGPL-3.0/MIT], except:
- Content under packages/ee/ is licensed under the terms in packages/ee/LICENSE
```

### 2.2 Add `packages/ee/LICENSE` (proprietary)

Create a commercial/BUSL-style license for Pro code:
- Source-available (can read, modify for dev/testing)
- Cannot be used in production without a valid Cloud Pro subscription
- All rights reserved by Agendex

Reference: Cal.com's `ee/LICENSE` and PostHog's `ee/LICENSE` for template language.

### 2.3 Update README.md

Add sections:
- **What's free (Self-Hosted)**: local plan indexing, search, all adapters, file watching,
  plan editing, CLI scanning
- **What requires Cloud Pro**: cloud sync, shareable links, comments, plan creation from
  dashboard, technology dependency charts, unseen plan tracking, workspace members
- **Self-hosting**: no Stripe/Convex setup needed for local use
- **License**: link to both licenses

### 2.4 Update docs/self-hosting.md

Clarify that self-hosted mode does NOT require Convex or Stripe configuration.

---

## Phase 3: Package Restructure (Day 2–3)

**Goal**: Separate OSS and Pro code into distinct packages with clear boundaries.

### 3.1 Target directory structure

```
packages/
  shared/              ← OSS (keep as-is)
    src/
      adapters/
      services/
      setup/
      config.ts
      types.ts
      index.ts

  app/                 ← OSS (new — extracted from web/)
    src/
      server/          ← Hono local server (from web/src/server/)
        index.ts
        auth.ts
        routes/plans.ts
        services/search.ts
      client/          ← OSS React client (from web/src/client/)
        components/    ← Only local-mode components (see 3.3)
        hooks/         ← Only local hooks (see 3.3)
        lib/           ← Shared client utils
        App.tsx
        main.tsx
    package.json       ← No Convex, no Stripe dependencies
    vite.config.ts

  cli/                 ← OSS (keep as-is, update imports if needed)
    src/

  ee/                  ← Proprietary (new)
    LICENSE            ← Commercial license
    convex/            ← Convex backend (from web/convex/)
      schema.ts
      auth.ts
      auth.config.ts
      cli.ts
      comments.ts
      entitlements.ts  ← New (from Phase 1)
      http.ts
      plans.ts
      sharing.ts
      stripe.ts
      subscriptions.ts
      convex.config.ts
    src/
      components/      ← Pro UI components (from web/src/client/components/)
        CloudUpgrade.tsx
        CommentThread.tsx
        PaywallGuard.tsx
        PricingModal.tsx
        SharePlanDialog.tsx
        SharedPlanView.tsx
        SubscriptionBadge.tsx
      hooks/           ← Pro hooks (from web/src/client/hooks/)
        useAuth.ts
        useCloudPlans.ts
        usePublishing.ts
        useSubscription.ts
      lib/
        auth-client.ts
        convex-client.ts
    package.json       ← Has Convex, Stripe, better-auth deps
```

### 3.2 File migration map

**Files moving from `packages/web/` → `packages/app/`** (OSS):
- `src/server/` → `packages/app/src/server/` (entire directory)
- `src/client/main.tsx` → `packages/app/src/client/main.tsx`
- `src/client/App.tsx` → `packages/app/src/client/App.tsx` (stripped of Pro imports)
- `src/client/index.html` → `packages/app/src/client/index.html`
- `src/client/index.css` → `packages/app/src/client/index.css`
- `src/client/favicon.png`, `logo.png` → `packages/app/src/client/`
- `vite.config.ts` → `packages/app/vite.config.ts`
- `postcss.config.mjs` → `packages/app/postcss.config.mjs`
- `tsconfig.json` → `packages/app/tsconfig.json`

**OSS components staying in `packages/app/src/client/components/`:**
- `AgentFilter.tsx`
- `AgentIcon.tsx`
- `AgentSelect.tsx`
- `LandingPage.tsx`
- `MarkdownCodeBlock.tsx`
- `OfflineView.tsx`
- `PlanEditor.tsx`
- `PlanList.tsx`
- `PlanOutline.tsx`
- `PlanUploader.tsx`
- `PlanViewer.tsx` (stripped of share/comment/pro imports)
- `PlanCreator.tsx` (no longer wrapped in PaywallGuard)
- `SearchBar.tsx`
- `SidebarFilters.tsx`
- `Skeleton.tsx`
- `ThemeProvider.tsx`
- `ThemeToggle.tsx`
- `WipMarquee.tsx`

**OSS hooks staying in `packages/app/src/client/hooks/`:**
- `useBackendStatus.ts`
- `usePlans.ts`
- `useScrollSpy.ts`
- `useSeenPlans.ts`
- `useSocket.ts`
- `useTheme.ts`

**OSS libs staying in `packages/app/src/client/lib/`:**
- `agent-colors.ts`
- `api.ts`
- `extract-headings.ts`
- `plan-markdown.ts`
- `plan-search.ts`
- `tech-extract.ts`
- `tech-graph.ts`
- `view-transition.ts`

**Files moving to `packages/ee/`** (Pro/Proprietary):
- `convex/` → `packages/ee/convex/` (entire directory)
- `src/client/components/CloudUpgrade.tsx` → `packages/ee/src/components/`
- `src/client/components/CommentThread.tsx` → `packages/ee/src/components/`
- `src/client/components/PaywallGuard.tsx` → `packages/ee/src/components/`
- `src/client/components/PricingModal.tsx` → `packages/ee/src/components/`
- `src/client/components/SharePlanDialog.tsx` → `packages/ee/src/components/`
- `src/client/components/SharedPlanView.tsx` → `packages/ee/src/components/`
- `src/client/components/SubscriptionBadge.tsx` → `packages/ee/src/components/`
- `src/client/components/AuthButton.tsx` → `packages/ee/src/components/`
- `src/client/components/CliAuthPage.tsx` → `packages/ee/src/components/`
- `src/client/hooks/useAuth.ts` → `packages/ee/src/hooks/`
- `src/client/hooks/useCloudPlans.ts` → `packages/ee/src/hooks/`
- `src/client/hooks/usePublishing.ts` → `packages/ee/src/hooks/`
- `src/client/hooks/useSubscription.ts` → `packages/ee/src/hooks/`
- `src/client/lib/auth-client.ts` → `packages/ee/src/lib/`
- `src/client/lib/convex-client.ts` → `packages/ee/src/lib/`

### 3.3 Update `packages/app/src/client/App.tsx`

The OSS App.tsx should:
- Remove all Convex/Pro imports (PaywallGuard, PricingModal, CloudUpgrade, etc.)
- Remove `useSubscription`, `useCloudPlans`, `useAuth` hooks
- Remove `DashboardMode` cloud toggle (local only)
- Remove `SubscriptionBadge`, `AuthButton` from topbar
- Remove `SharedPlanView` route
- Remove `CliAuthPage` route
- Keep: local dashboard, plan list, plan viewer, plan editor, search, sidebar filters

### 3.4 Create `packages/ee/src/App.tsx` (Pro entrypoint)

The Pro App.tsx should:
- Import and extend the OSS App (or be a separate entrypoint)
- Add cloud mode, auth, subscription, sharing, comments
- Import Pro components from `packages/ee/src/components/`
- This is the entrypoint deployed to the hosted Cloud product

### 3.5 Update `package.json` files

**`packages/app/package.json`** (OSS):
- Dependencies: `@agendex/shared`, `hono`, `react`, `react-dom`, `react-markdown`,
  `remark-gfm`, `fuse.js`, `highlight.js`, `nuqs`, `codemirror`, `@xyflow/react`,
  `@dagrejs/dagre`, `simple-icons`, `github-slugger`
- No: `convex`, `better-auth`, `stripe`, `@convex-dev/stripe`, `@convex-dev/better-auth`

**`packages/ee/package.json`** (Pro):
- Dependencies: `@agendex/shared`, `@agendex/app` (workspace:*),
  `convex`, `better-auth`, `stripe`, `@convex-dev/stripe`, `@convex-dev/better-auth`

### 3.6 Update root `package.json` scripts

```json
{
  "scripts": {
    "dev": "bun run --filter @agendex/app dev",
    "dev:client": "bun run --filter @agendex/app dev:client",
    "build": "bun run --filter @agendex/app build",
    "dev:cloud": "bun run --filter @agendex/ee dev",
    "build:cloud": "bun run --filter @agendex/ee build"
  }
}
```

### 3.7 Delete `packages/web/`

After migration is complete and verified, remove the old `packages/web/` directory.

### 3.8 Verification

- `bun install` → no errors
- `bun run dev` + `bun run dev:client` → OSS app works locally (no Convex/Stripe needed)
- `bun run dev:cloud` → Pro app works with Convex + Stripe
- OSS client bundle does NOT contain Convex, Stripe, or Pro component code
- CLI commands still work
- All existing Pro features (sharing, comments, sync) still work in cloud mode

---

## Phase 4: Improve Feature Gating Architecture (Day 3–4)

**Goal**: Replace scattered `if (isPro)` checks with a declarative, auditable system.

### 4.1 Define Pro feature enum in `packages/shared/`

Add to `packages/shared/src/types.ts`:

```ts
export enum ProFeature {
  CLOUD_SYNC = 'cloud_sync',
  SHARE_LINKS = 'share_links',
  COMMENTS = 'comments',
  PLAN_CREATION = 'plan_creation',
  TECH_CHARTS = 'tech_charts',
  UNSEEN_TRACKING = 'unseen_tracking',
  WORKSPACE_MEMBERS = 'workspace_members',
}
```

### 4.2 Create declarative backend middleware in `packages/ee/convex/`

Update `convex/entitlements.ts` to use the enum:

```ts
export async function requireFeature(ctx, feature: ProFeature): Promise<void>
// Checks subscription, throws ConvexError with feature name in message
```

Usage in mutations becomes self-documenting:

```ts
await requireFeature(ctx, ProFeature.SHARE_LINKS);
```

### 4.3 Create stub service pattern for self-hosted

In `packages/shared/`, define interfaces that Pro code implements:

```ts
// packages/shared/src/types.ts
export interface CloudService {
  publishPlan(plan: Plan): Promise<string>;
  getCloudPlans(): Promise<Plan[]>;
  createShareLink(planId: string): Promise<string>;
}

export const stubCloudService: CloudService = {
  async publishPlan() { throw new Error('Cloud Pro required'); },
  async getCloudPlans() { return []; },
  async createShareLink() { throw new Error('Cloud Pro required'); },
};
```

The OSS app uses `stubCloudService`. The Pro app provides the real Convex-backed
implementation. This follows Cal.com's `StubBillingService` pattern.

### 4.4 Audit all client-side `isPro` checks

Current locations where `isPro` / `useSubscription` is used:
- `App.tsx` line 122: `const { isActive: isPro } = useSubscription()`
- `App.tsx` line 559: New button → if not Pro, show pricing modal
- `App.tsx` line 672: Cloud mode → if not Pro, show CloudUpgrade
- `PlanViewer.tsx` line 56: `const { isActive: isPro } = useSubscription()`
- `PlanList.tsx`: likely uses `isPro` prop
- `PaywallGuard.tsx`: wraps PlanCreator

After restructure, these checks move entirely into `packages/ee/` components.
The OSS `App.tsx` has no concept of "Pro" — everything is available locally.

### 4.5 Verification

- Pro feature enum is importable from `@agendex/shared`
- All Pro mutations use `requireFeature()` instead of direct `hasActiveSubscription()`
- Adding a new Pro feature = add enum value + one `requireFeature()` call
- OSS app has zero references to subscription/paywall/Pro

---

## Summary: What Changes Where

| Phase | Files Created | Files Modified | Files Moved | Files Deleted |
|-------|--------------|----------------|-------------|---------------|
| 1 | 1 (`entitlements.ts`) | 4 (`sharing.ts`, `comments.ts`, `plans.ts`, `subscriptions.ts`) | 0 | 0 |
| 2 | 2 (`LICENSE`, `ee/LICENSE`) | 2 (`README.md`, `docs/self-hosting.md`) | 0 | 0 |
| 3 | 3 (`app/package.json`, `ee/package.json`, `ee/src/App.tsx`) | 2 (`root package.json`, `App.tsx`) | ~30 files | `packages/web/` |
| 4 | 0 | 3 (`types.ts`, `entitlements.ts`, mutations) | 0 | 0 |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking existing Pro users during restructure | Phase 1 (security) is independent of restructure; deploy it first |
| Convex path changes after moving `convex/` dir | Update `convex.config.ts` and Convex project settings to point to `packages/ee/convex/` |
| Import path breakage across ~30 moved files | Do restructure in one focused session; verify with `bun install` + `tsc --noEmit` |
| Vite config differences between OSS and Pro builds | Pro's `vite.config.ts` extends OSS config, adds Convex plugin |
| CLI `sync` depends on cloud API | CLI stays in OSS; it uses the cloud API interface which is documented publicly |

---

## Order of Execution

```
Phase 1 (security)  ──→  Phase 2 (licensing)  ──→  Phase 3 (restructure)  ──→  Phase 4 (feature gating)
     Day 1                    Day 1-2                    Day 2-3                     Day 3-4
   [CRITICAL]               [HIGH]                     [HIGH]                     [MEDIUM]
```

Phase 1 can and should be deployed immediately — it's a security fix that doesn't
require any structural changes. Phases 2–4 can be done together in a feature branch.
