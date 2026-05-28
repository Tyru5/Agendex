# Cloud mode when the Agendex CLI daemon is not running

## Current behavior

Cloud mode already reads synced plans from the cloud database. The CLI daemon is only needed to keep local plan files synchronized into Convex and to deliver daemon-dependent jobs such as Plannotator write-backs.

Relevant code paths:

- `packages/ee/src/hooks/useCloudPlans.ts` uses `useQuery(api.plans.getMyPublishedPlans)` and maps Convex `plans` rows into UI `Plan` objects. This does not depend on the CLI daemon.
- `packages/ee/convex/plans.ts#getMyPublishedPlans` returns visible rows from the `plans` table for the signed-in user or workspace owner. This is the already-synced database state.
- `packages/ee/src/hooks/useDaemonStatus.ts` uses `api.cli.getDaemonStatus`, then classifies the aggregate daemon status as:
  - `unknown` while the Convex query is unresolved
  - `alive` if at least one heartbeat is newer than `CLI_DAEMON_STALE_AFTER_MS`
  - `stale` if there are no devices or all devices are stale
- `packages/shared/src/daemon-status.ts` sets heartbeat every 30s and stale after 150s.
- `packages/ee/src/App.tsx` converts `daemonStatus === 'stale'` into `backendStatus === 'offline'` for cloud mode.
- `packages/ee/src/App.tsx` then renders `<OfflineView />` whenever `backendStatus === 'offline'`, before it renders plan viewing, editing, uploading, creation, or history UI.
- The sidebar also applies reduced opacity, blur, and `pointerEvents: 'none'` whenever `backendStatus === 'offline'`.
- `packages/web/src/client/components/OfflineView.tsx` says “Server unreachable” and instructs the user to run `agendex start` or `bun run dev`.

Net effect: cloud mode can have valid cloud database data loaded, but the UI treats a missing/stale daemon as a full backend outage. That makes the application effectively unusable even though the cloud database is available.

## Important distinction

There are two different “offline” states currently collapsed into one UI state:

1. **Cloud unavailable**: Convex/auth/network is unavailable, so current cloud reads and writes cannot happen.
2. **Daemon unavailable**: Convex is available, but no local CLI daemon is heartbeating, so new local file changes will not sync and daemon-delivered actions cannot run.

The second state should not block review of already-synced plans.

## What common practice suggests

The common guidance from offline-first/local-first UX and architecture is:

- Keep critical reads available from the nearest usable data source instead of showing a hard failure screen.
- Clearly label freshness/staleness and tell users what capabilities are degraded.
- Separate read availability from write/sync availability.
- Prefer graceful degradation: allow safe actions, disable or queue unsafe actions.
- If supporting offline writes, design a real sync model: local store, pending mutation queue, conflict detection/resolution, retries, and user-visible sync state.
- Avoid implying data is live when it is a cached or last-synced snapshot.

Research sources:

- web.dev Offline UX guidelines: communicate what changes when disconnected, what is saved, and what the user can still do. https://web.dev/articles/offline-ux-design-guidelines
- Android offline-first data layer guidance: local data source can be read first while network may lag; apps need explicit freshness/update behavior. https://developer.android.com/topic/architecture/data-layer/offline-first
- Local-first/offline-first architecture writeups generally recommend “UI reads from local/cache, sync separately,” with conflict handling required for offline edits.
- TanStack Query supports persistent caches; Convex React Query documentation describes Convex subscriptions as server-pushed live data and TanStack cache integration. This can help for client-side cached reads, but it is not the same as a full local-first sync engine.

## Options

### Option 1 — Quick fix: daemon-degraded cloud mode

Let cloud mode stay usable when Convex queries are working but daemon status is stale.

Behavior:

- Continue rendering the plan list and plan viewer in cloud mode if `useCloudPlans()` has data or has finished successfully.
- Replace the blocking `OfflineView` with a non-blocking banner/status pill:
  - “CLI daemon not running — showing last synced cloud plans.”
  - “New local changes won’t appear until `agendex start` is running.”
- Keep cloud-native actions enabled if Convex is online: view, search, tags/collections, comments, share links, cloud create/upload/edit/rename/delete.
- Disable or explain daemon-dependent actions: Plannotator write-back delivery, “live sync” expectations, any action that requires reaching local files.
- Update the sidebar so it is not blurred/disabled in cloud mode solely because the daemon is stale.

Pros:

- Smallest change.
- Matches the existing architecture: Convex is already the source for cloud plans.
- Immediately addresses the “application unusable” problem.

Cons:

- Cloud data may be stale relative to local files.
- Cloud edits/deletes are server-side only. If the local file later changes, the daemon may sync that local file back into cloud and effectively reassert the local version.

Recommended as the first step.

### Option 2 — Read-only cloud snapshot mode

When daemon is unavailable, keep cloud plan review fully enabled but disable cloud mutations on plans that originated from local sync.

Behavior:

- View/search/filter plans as usual.
- Show a “snapshot” banner with last daemon heartbeat and last plan update.
- Allow comments/share/tags if desired, but make content edits/renames/deletes read-only for synced local-file plans unless the user explicitly opts into cloud-only edits.
- Cloud-created plans could remain editable because they do not have a real local source file.

Pros:

- Safer data model.
- Avoids false expectations that cloud edits modify local files.
- Low-to-medium implementation cost.

Cons:

- Less capable than current cloud editor.
- Requires clear UX copy and maybe plan provenance labels.

Good if avoiding local/cloud divergence is more important than cloud editing without a daemon.

### Option 3 — Browser cache for true network-offline read mode

Persist the last successful cloud query result in browser storage, then show cached plans when Convex/network is unavailable.

Implementation choices:

- Minimal: store `getMyPublishedPlans` results in IndexedDB or localStorage with a schema version and `cachedAt` timestamp.
- Better: add TanStack Query with persistence for Convex query results, or use a small IndexedDB wrapper.

Behavior:

- If Convex query fails/unavailable but cached plans exist, show read-only cached plans.
- Prominent banner: “Offline — showing cached cloud plans from <time>.”
- Disable network mutations until reconnected.

Pros:

- Handles actual network offline, not just missing daemon.
- Improves perceived reliability.

Cons:

- More work than Option 1.
- Needs cache invalidation, storage limits, privacy consideration, and account scoping.

Good second step after daemon-degraded mode.

### Option 4 — Full local-first/offline-write architecture

Make the browser maintain an authoritative local database and queue mutations for later sync.

Behavior:

- UI always reads from local IndexedDB/SQLite.
- Writes apply locally immediately and sync to Convex later.
- Pending operations are visible and retry automatically.
- Conflicts are resolved via version checks, last-write-wins, field merge, CRDTs, or user arbitration.

Pros:

- Best user experience for unreliable connectivity.
- Enables offline create/edit/delete/comment workflows.

Cons:

- Significant product and engineering investment.
- Requires sync protocol, conflict semantics, per-record versions, migration/versioning, auth/session handling, and QA around multi-device behavior.

Not recommended as the immediate fix unless offline editing is a major product goal.

### Option 5 — Improve daemon lifecycle/autostart

Reduce how often users encounter a missing daemon.

Ideas:

- Better in-app instructions and one-command copy for `agendex start`.
- CLI install step that offers LaunchAgent/system service setup.
- `agendex status` surfacing stale cloud daemon rows and local PID state clearly.
- Optional local loopback health endpoint/deep link if a desktop wrapper is ever introduced.

Pros:

- Helps sync freshness.
- Complements degraded cloud mode.

Cons:

- Browser apps generally cannot start local processes directly.
- Does not solve review of already-synced plans by itself.

## Recommendation

Implement in phases:

1. **Decouple cloud read availability from daemon status.** Treat stale daemon as “sync degraded,” not “offline.” Let users review already-synced plans from Convex.
2. **Add a cloud-mode degraded banner/status.** Include last seen daemon time, explain that local changes will not sync until `agendex start` runs, and identify daemon-dependent actions.
3. **Gate only daemon-dependent features.** Keep cloud-native Convex features usable. Disable or annotate Plannotator write-back and live-local expectations.
4. **Add browser cached read-only snapshots later.** This handles actual network/Convex outages with a clear stale timestamp.
5. **Only pursue full local-first offline writes if product requirements demand editing while offline.** It is a much larger architecture change.

Suggested terminology:

- Use **“Cloud: live”** when Convex is reachable and at least one daemon is alive.
- Use **“Cloud: sync paused”** when Convex is reachable but daemon is stale/missing.
- Use **“Offline: cached snapshot”** when Convex is unreachable but browser cache exists.
- Use **“Offline”** only when neither live cloud data nor cached data can be shown.

## Likely code-level change areas

- `packages/ee/src/App.tsx`
  - Split `backendStatus` into something like `cloudConnectionStatus` and `daemonSyncStatus`.
  - Stop rendering `OfflineView` in cloud mode solely because daemon is stale.
  - Stop disabling the sidebar in cloud mode solely because daemon is stale.
  - Add a non-blocking banner for daemon-stale cloud mode.
- `packages/ee/src/hooks/useDaemonStatus.ts`
  - Keep as-is or expose richer metadata such as most recent `lastSeenAt`.
- `packages/ee/src/hooks/useCloudPlans.ts`
  - Optionally expose `lastLoadedAt` and query error state.
  - Later, persist successful results to IndexedDB/localStorage for actual offline cached reads.
- `packages/ee/src/components/CloudPlannotatorPanel.tsx`
  - Disable/write clearer copy for write-back when no daemon is alive.
- `packages/web/src/client/components/OfflineView.tsx`
  - Rename/copy-adjust so it does not imply the cloud server is unreachable when only the CLI daemon is missing.
