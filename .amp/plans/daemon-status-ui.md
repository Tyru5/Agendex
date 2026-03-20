# Multi-Device Machine Hostname & CLI Daemon Status in Settings

**Created:** 2026-03-20
**Status:** Planning

## Overview

Surface machine hostname and CLI daemon status info in the EE cloud web app's Settings page, with support for multiple devices per user.

Commit `237a15d` ("Add CLI version flag and richer daemon status") added `hostname` and `startedAtMs` to the local PID file (`~/.agendex/daemon.pid`), but this data is never sent to the cloud. This plan bridges that gap across 7 files in 3 packages.

A stable `deviceId` (persisted in the CLI config) combined with the hostname uniquely identifies each machine, enabling multi-device heartbeat rows per owner.

---

## Architecture

```
packages/shared/src/config.ts    → Add deviceId to AgendexConfig, auto-generate on first run
packages/cli/src/api.ts          → Send deviceId + hostname + startedAtMs in heartbeat body
packages/ee/convex/schema.ts     → Add fields + by_owner_device index to daemonHeartbeats
packages/ee/convex/cli.ts        → Multi-device upsertHeartbeat, body parsing, array query return
packages/ee/src/hooks/useDaemonStatus.ts → Return DaemonStatusResult with device array + aggregate
packages/ee/src/App.tsx          → Destructure { aggregateStatus } from hook
packages/ee/src/components/SettingsPage.tsx → Add DaemonSection rendering device list
```

---

## Step 1 — Add `deviceId` to Config (`packages/shared/src/config.ts`)

- Add `deviceId?: string` to `AgendexConfig` interface and `StoredConfig`
- In `normalizeStoredConfig`, preserve existing `deviceId` if present
- In `loadOrInitConfig`, auto-generate a `deviceId` via `randomBytes(16).toString('hex')` if one doesn't exist, then persist it via `saveConfig`
- `saveConfig` must include `deviceId` in the written payload
- Export a `loadOrCreateDeviceId()` helper for direct use by the CLI heartbeat sender

Uses the same pattern as the existing `loadOrCreateToken()`.

---

## Step 2 — Extend Convex Schema (`packages/ee/convex/schema.ts`)

Replace the current `daemonHeartbeats` definition with:

| Field | Type | Notes |
|---|---|---|
| `ownerId` | `v.string()` | (existing) |
| `lastSeenAt` | `v.number()` | (existing) |
| `deviceId` | `v.optional(v.string())` | Stable CLI-generated device ID |
| `hostname` | `v.optional(v.string())` | Machine hostname |
| `startedAtMs` | `v.optional(v.number())` | Daemon start time |

Add a new compound index: `.index('by_owner_device', ['ownerId', 'deviceId'])` alongside the existing `by_owner` index (which is now used to query _all_ devices for an owner).

---

## Step 3 — Update Convex Heartbeat Logic (`packages/ee/convex/cli.ts`)

**`upsertHeartbeat` mutation** — Add `deviceId`, `hostname`, `startedAtMs` to args. Change the lookup from `by_owner` (single row) to `by_owner_device` (per-device row). Only overwrite optional fields when provided.

**`heartbeat` httpAction** — Parse the request body defensively (`try/catch`, empty body = `{}`). Extract `deviceId`, `hostname`, `startedAtMs` and pass to `upsertHeartbeat`. Backward compat: if no `deviceId` in body, fall back to the old single-row-per-owner behavior (query `by_owner` without `deviceId`).

**`getDaemonStatus` query** — Change from returning a single object to returning an **array** of all heartbeat rows for the owner, each with `{ alive, lastSeenAt, deviceId, hostname, startedAtMs }`. Use `ctx.db.query('daemonHeartbeats').withIndex('by_owner', ...).collect()`.

---

## Step 4 — Update CLI Heartbeat Sender (`packages/cli/src/api.ts`)

Update `sendHeartbeat()` to include a JSON body with all three fields:
- `deviceId` — from `loadConfig()?.deviceId` (or `loadOrCreateDeviceId()`)
- `hostname` — from `readPidInfo()?.hostname` (fallback: `os.hostname()`)
- `startedAtMs` — from `readPidInfo()?.startedAtMs`

Add the body to both the initial request and the retry-after-refresh request.

---

## Step 5 — Upgrade `useDaemonStatus` Hook (`packages/ee/src/hooks/useDaemonStatus.ts`)

Change the return type to expose the full device list plus an aggregate status:

```ts
interface DaemonDeviceInfo {
  deviceId: string | null;
  hostname: string | null;
  startedAtMs: number | null;
  uptimeMs: number | null;
  lastSeenAt: number | null;
  status: 'alive' | 'stale';
}

interface DaemonStatusResult {
  aggregateStatus: 'alive' | 'stale' | 'unknown';  // alive if ANY device is alive
  devices: DaemonDeviceInfo[];
}
```

The local `setInterval` tick continues to re-derive staleness per device.

---

## Step 6 — Update `App.tsx` Consumer (`packages/ee/src/App.tsx`)

Change line 134–136 from:
```ts
const daemonStatus = useDaemonStatus();
const cloudBackendStatus = daemonStatus === 'stale' ? 'offline' : ...
```
to:
```ts
const { aggregateStatus: daemonStatus } = useDaemonStatus();
const cloudBackendStatus = daemonStatus === 'stale' ? 'offline' : ...
```

Minimal change — rest of the dashboard logic stays the same.

---

## Step 7 — Add `DaemonSection` to Settings (`packages/ee/src/components/SettingsPage.tsx`)

Add a new section between Billing and Danger Zone that renders a **list of machine cards**, one per device from `useDaemonStatus().devices`:

| Row | Value | Fallback |
|---|---|---|
| **Machine** | hostname (e.g. `johns-macbook-pro`) | `Unknown device` |
| **Status** | 🟢 Online / 🟡 Stale | — |
| **Uptime** | `2h 14m 5s` | `n/a` |
| **Last seen** | Relative + absolute timestamp | `Never` |

When `devices` is empty, show a single empty state: _"No CLI daemons detected. Run `agendex start` to connect a machine."_

---

## Files Changed Summary

| # | Package | File | Change |
|---|---|---|---|
| 1 | `shared` | `src/config.ts` | Add `deviceId` to config interface, auto-generate + persist |
| 2 | `ee` | `convex/schema.ts` | Add fields + `by_owner_device` index to `daemonHeartbeats` |
| 3 | `ee` | `convex/cli.ts` | Multi-device `upsertHeartbeat`, body parsing in `heartbeat`, array return in `getDaemonStatus` |
| 4 | `cli` | `src/api.ts` | Send `deviceId`, `hostname`, `startedAtMs` in heartbeat body |
| 5 | `ee` | `src/hooks/useDaemonStatus.ts` | Return `DaemonStatusResult` with device array + aggregate status |
| 6 | `ee` | `src/App.tsx` | Destructure `{ aggregateStatus }` from hook |
| 7 | `ee` | `src/components/SettingsPage.tsx` | Add `DaemonSection` rendering device list |

---

## Risks & Guardrails

- **Backward compat**: Old CLIs send no body/no `deviceId` → heartbeat endpoint falls back to `by_owner` lookup (legacy single-row behavior)
- **Stale device cleanup**: Not in v1, but eventually old devices that haven't heartbeated in days should be pruned (a future scheduled Convex function)
- **Config migration**: Existing configs have no `deviceId` — `loadOrInitConfig` generates one seamlessly on next CLI run, no manual migration needed
- **`deviceId` uniqueness**: `randomBytes(16)` = 128 bits of entropy, collision-proof per user
- **Data loss prevention**: Only patch `hostname`/`startedAtMs` when provided, never null them out
- **Privacy**: Hostname shown only to the authenticated owner in Settings; not surfaced in shared/team contexts
