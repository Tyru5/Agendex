# Plannotator Integration Plan for Agendex

## Context

Agendex should integrate with Plannotator as an **EE / Pro add-on only**: a cloud sync layer for Plannotator-reviewed plans plus a Pro write-back bridge that lets Agendex Cloud feedback flow back to the active originating agent as structured `request-changes` feedback. The OSS local app should not expose Plannotator sync/write-back UI or routes; any shared-package changes should exist only as plumbing consumed by the EE CLI/daemon/cloud flow.

### Where Agendex and Plannotator overlap

- Both are plan-centric, agent-agnostic tools for AI coding workflows.
- Both normalize value around plans as artifacts, not just transient chat messages.
- Both already support multiple agent ecosystems, especially Claude Code, OpenCode, Pi, and Codex-adjacent workflows.

### How they differ

- **Agendex** is strongest after or around plan creation: cross-agent indexing/search, persistent browsing, daemon-based cloud sync, account/workspace identity, tags/collections, long-lived plan history, and team workspace workflows.
- **Plannotator** is strongest inside the agent loop: pre-execution visual review, inline annotations, plan diffs between revisions, approval/denial gates, hook-native feedback back to the running agent, and its own local/zero-knowledge sharing/collaboration flows.
- **Codex caveat:** Plannotator docs state Codex does not yet support true plan mode; Codex support is currently code review, markdown annotation, and last-message annotation. Agendex should still support Codex write-back where Plannotator is running in hook/annotate/review mode, but should not present Codex plan-mode write-back as guaranteed.

### What they do well together

Agendex becomes the durable system of record for Plannotator-reviewed plans, while Plannotator remains the human-in-the-loop gate that can route feedback back to agents. Together they provide:

- Live review in Plannotator, durable discovery/search/history in Agendex.
- Cloud visibility for Plannotator-approved/denied plan snapshots.
- A second review surface in Agendex that can send structured changes back through Plannotator rather than silently editing a static file.
- Complementary collaboration layers: Plannotator already supports share/comment/collaboration around a review session; Agendex Cloud adds account/workspace-level aggregation across agents, durable organization, tags/collections, and long-lived searchable history across machines.

### Agendex findings

- Implemented adapters live in `packages/shared/src/adapters/*` and are selected from `packages/shared/src/adapters/catalog.ts`.
- Plans normalize to `Plan` in `packages/shared/src/types.ts`.
- Scanning, watching, update, and create logic lives in `packages/shared/src/services/plan-service.ts` and `packages/shared/src/services/watcher.ts`.
- The OSS API exposes read/list/rescan/custom-source endpoints in `packages/app/src/server/routes/plans.ts`, but this integration should not add OSS Plannotator write-back routes. Plannotator write-back should be an EE Cloud + CLI daemon feature.
- CLI cloud sync pushes normalized plans through `packages/cli/src/sync.ts` and `packages/cli/src/api.ts` into Convex `publishPlan` / CLI upsert logic; this is the right Pro-only sync path for Plannotator snapshots.
- The existing daemon already has heartbeat/sync infrastructure in `packages/cli/src/daemon.ts`; extend that daemon for EE write-back polling rather than adding local OSS API behavior.

### Plannotator findings

- Claude Code plan review is an `ExitPlanMode` `PermissionRequest` hook configured as `plannotator`; denial returns a Claude hook-specific deny decision with feedback.
- Generic hook mode is `plannotator annotate <file> --hook`; it always exits `0` and emits either empty stdout for approve/close or `{"decision":"block","reason":"<feedback>"}` for send-annotations/request-changes.
- Plannotator plan servers expose `/api/plan`, `/api/approve`, `/api/deny`, `/api/plan/versions`, and `/api/external-annotations`.
- Annotate/review servers expose `/api/feedback` and `/api/external-annotations`.
- Approved and denied plans are saved to `~/.plannotator/plans/` by default as `*-approved.md` / `*-denied.md`, with companion `.annotations.md` files and version history under `~/.plannotator/history/{project}/{slug}/NNN.md`.
- The Plannotator plugin can also create project-local `@plans/` directories; these should be indexed as read-only Plannotator project plans for Cloud sync.
- The CLI package tracks live sessions in `~/.plannotator/sessions/*.json` with `{ pid, port, url, mode, project, startedAt, label }`, and `plannotator sessions` lists/reopens them.
- Pi and OpenCode currently start Plannotator plan servers but do not appear to write the same `~/.plannotator/sessions` registry entries. To support robust Agendex live write-back for Pi/OpenCode, we should either coordinate a small Plannotator-side session-registry enhancement or build an Agendex fallback that only offers write-back when a live session URL can be discovered.
- Pi has a shared event API (`plannotator:request`, `plannotator:review-result`) and persists review statuses under `~/.pi/plannotator-review-status.json`, but that status file is not enough by itself to discover a live server URL for external write-back.

## Approach

Build the integration in EE/Pro layers. Shared code may contain parsing/adapter primitives, but the feature should only be enabled by the Pro CLI daemon and surfaced in the EE Cloud UI after entitlement checks.

1. **Pro-only Plannotator adapter / scanner**
   - Add Plannotator parsing primitives in shared code, but do **not** expose them as an OSS local-app feature.
   - Register `plannotator` in the adapter catalog as implemented but **not OSS-default-enabled**; the EE CLI/daemon should enable it when the user has Cloud Pro / the Plannotator add-on enabled.
   - Scan default Plannotator storage and project-local plan folders for the Pro sync flow:
     - `~/.plannotator/plans/` for durable approved/denied snapshots.
     - `~/.plannotator/sessions/` for live sessions that can be fetched over local HTTP by the daemon.
     - Project-local `@plans/` directories for Plannotator plugin-created source/project plans.
     - `~/.plannotator/history/` as related metadata/version context, not as separate default plan rows unless explicitly enabled later.
   - Preserve original agent origin (`claude-code`, `pi`, `opencode`, `codex`, etc.) in metadata and, where useful, in the `agent` field for filtering in Cloud.

2. **Live session ingestion**
   - Parse session JSON files, validate that the PID is alive, require `localhost`/loopback URLs, and fetch `/api/plan` for live plan/annotate sessions.
   - Normalize live sessions as `Plan` objects with metadata such as:
     - `metadata.source = 'plannotator'`
     - `metadata.plannotator.kind = 'live-session' | 'snapshot' | 'project-plan'`
     - `metadata.plannotator.mode = 'plan' | 'annotate' | 'review' | 'archive'`
     - `metadata.plannotator.url`, `pid`, `port`, `origin`, `project`, `label`, `status`, `reviewId` when available
     - `metadata.sourceAdapter = 'plannotator'` so write-back can route to the Plannotator adapter even when `plan.agent` is the originating agent.
   - For saved snapshots and project-local `@plans/` files, parse approval status from filenames when present and derive annotation presence from matching `.annotations.md` files.

3. **EE structured write-back bridge**
   - Add an EE/Convex write-back queue rather than an OSS local route:
     - Cloud mutation, e.g. `api.plannotator.enqueueWriteback`.
     - Convex table, e.g. `plannotatorWritebacks`, keyed by owner, device, local plan id, and status.
     - Payload: `{ localPlanId: string, feedback: string, revisedContent?: string, annotations?: PlannotatorFeedbackAnnotation[], source: 'agendex-cloud' }`.
   - Extend the Pro CLI daemon to poll pending write-backs, locate the matching live Plannotator session locally, and call shared `requestChanges(plan, payload)`.
   - Add typed annotation payloads instead of untyped arrays:
     - `PlannotatorPlanAnnotation` for plan text annotations.
     - `PlannotatorReviewAnnotation` for code/diff annotations.
     - `PlannotatorFeedbackAnnotation = PlannotatorPlanAnnotation | PlannotatorReviewAnnotation`.
   - The Plannotator request-changes implementation calls the live Plannotator server:
     - Plan review session: `POST {url}/api/deny` with `{ feedback, planSave: { enabled: true } }`.
     - Annotate/review session: `POST {url}/api/feedback` with `{ feedback, annotations }`.
   - For Agendex Cloud content edits, generate structured feedback rather than silently overwriting source files. Recommended feedback shape:
     - Header: `# Agendex Plan Feedback`
     - Explanation that the user edited/reviewed the plan in Agendex and the agent must revise the plan.
     - Optional diff or full revised plan under `## Requested revision`.
     - Optional typed annotations under `## Notes`.
   - Once the daemon calls Plannotator’s existing `/api/deny` or `/api/feedback`, Plannotator continues to do the host-specific write-back:
     - Claude Code: hook-specific `PermissionRequest` deny response.
     - Pi: `plannotator_submit_plan` denial result / `plannotator:review-result` path.
     - OpenCode: `submit_plan` returns `planDenyFeedback(...)` to the planning agent.
     - Codex: supported for Plannotator hook/annotate/review flows, not true plan mode until Codex exposes plan hooks.

4. **EE Cloud UI changes**
   - Surface the integration only in EE/Pro components after entitlement checks.
   - Show Plannotator status badges (`Live review`, `Approved`, `Denied`, `Snapshot`) and original origin agent in Cloud plan views.
   - For live Plannotator plans with an online daemon, show `Request changes` instead of generic `Save`.
   - Provide an “Open in Plannotator” link for live sessions (`metadata.plannotator.url`) when the browser is on the same machine/network and the URL is loopback-safe.
   - Keep saved snapshots read-only in Cloud; only live sessions with an online daemon should advertise write-back.

5. **Cloud sync and write-back status**
   - Existing CLI sync can carry Plannotator metadata in `metadata`; use this for snapshot sync.
   - Add daemon-mediated write-back status (`pending`, `sent`, `failed`, `expired`) so Cloud can show whether feedback reached the local Plannotator hook.
   - Use daemon heartbeats/device ids to select where a write-back should run.

## Files to modify

### Agendex

- `packages/shared/src/adapters/plannotator.ts` (new parser/adapter plumbing consumed by EE CLI/daemon)
- `packages/shared/src/adapters/catalog.ts` (add `plannotator` adapter id/entry, implemented but not OSS-default-enabled)
- `packages/shared/src/adapters/registry.ts` (adapter-routing helpers for `metadata.sourceAdapter` if needed)
- `packages/shared/src/types.ts` (typed `requestChanges` capability plus `PlannotatorPlanAnnotation`, `PlannotatorReviewAnnotation`, and `PlannotatorFeedbackAnnotation` interfaces)
- `packages/shared/src/services/plan-service.ts` (EE daemon scan support, request-changes routing, route writes by `metadata.sourceAdapter`)
- `packages/shared/src/services/watcher.ts` (daemon watcher for `~/.plannotator/plans`, `~/.plannotator/sessions`, and discovered project-local `@plans`; handle session deletion/rescan)
- `packages/shared/src/config.ts` (optional Pro-only Plannotator adapter flag / custom save dirs)
- `packages/cli/src/daemon.ts` (Pro daemon polling for pending write-backs and status reporting)
- `packages/cli/src/api.ts` (cloud API calls for fetching/reporting write-back jobs)
- `packages/cli/src/sync.ts` (ensure one-shot Pro sync can include Plannotator snapshots and project-local `@plans` when enabled)
- `packages/ee/convex/schema.ts` (write-back queue/status table)
- `packages/ee/convex/cli.ts` (HTTP or mutation/query endpoints for daemon write-back polling/reporting)
- `packages/ee/convex/plans.ts` or a new `packages/ee/convex/plannotator.ts` (entitlement-checked enqueue mutation)
- `packages/ee/src/App.tsx` and/or new EE components for Pro-only Plannotator badges and request-changes UI
- `packages/ee/src/components/CloudPlanEditor.tsx` or a new `CloudPlannotatorWritebackPanel.tsx` (Cloud request-changes flow)
- Tests under `packages/shared/src/adapters/*.test.ts`, `packages/shared/src/services/plan-service.test.ts`, and relevant Convex/CLI tests

### Plannotator-side coordination / upstream reference

Agendex can start with current Plannotator CLI session files, but robust Pi/OpenCode live write-back needs the Plannotator hosts to expose the same live-session registry. Reference files:

- `packages/server/sessions.ts` — existing session registry shape.
- `apps/hook/server/index.ts` — Claude/Codex/Copilot CLI session registration and hook-output behavior.
- `apps/opencode-plugin/index.ts` — OpenCode `submit_plan` server and denial path.
- `apps/pi-extension/plannotator-browser.ts` and `apps/pi-extension/server/serverPlan.ts` — Pi plan-review server and review result path.
- `packages/shared/feedback-templates.ts` — `planDenyFeedback()` format to reuse/align with.
- `packages/shared/storage.ts` — saved plan/history path conventions.

## Reuse

- Reuse Agendex’s `AgentAdapter` contract, `scan()`, `rescanFile()`, `startWatching()`, `setOnPlansChanged()`, and CLI sync payload pipeline, but enable Plannotator only through the EE/Pro daemon path.
- Reuse Agendex’s existing `metadata: Record<string, unknown>` to preserve Plannotator details without immediate Convex schema expansion, while adding typed interfaces for Plannotator annotations/write-back payloads.
- Reuse Plannotator’s existing local APIs instead of inventing a new hook protocol:
  - `GET /api/plan`
  - `POST /api/deny`
  - `POST /api/feedback`
  - `POST /api/external-annotations`
- Reuse Plannotator’s existing storage conventions:
  - `~/.plannotator/plans/*-{approved,denied}.md`
  - `~/.plannotator/plans/*.annotations.md`
  - `~/.plannotator/history/{project}/{slug}/NNN.md`
  - `~/.plannotator/sessions/*.json`
  - Project-local `@plans/*.md`
- Reuse `planDenyFeedback()` semantics rather than creating a competing feedback style.

## Steps

- [x] Add/confirm a Pro entitlement for the Plannotator add-on (new `ProFeature.PLANNOTATOR_INTEGRATION` or reuse `CLOUD_SYNC` if the product decision is to bundle it with Pro sync).
- [x] Add typed Plannotator metadata and annotation interfaces in shared code: `PlannotatorMetadata`, `PlannotatorPlanAnnotation`, `PlannotatorReviewAnnotation`, `PlannotatorFeedbackAnnotation`, and `PlannotatorWritebackPayload`.
- [x] Add `packages/shared/src/adapters/plannotator.ts` that parses saved snapshots from `~/.plannotator/plans`, project-local `@plans`, and live sessions from `~/.plannotator/sessions` for EE daemon use.
- [x] Register the `plannotator` adapter in `packages/shared/src/adapters/catalog.ts` as implemented but not OSS-default-enabled.
- [x] Update EE CLI/daemon adapter resolution so Pro users can opt into or auto-enable Plannotator sync without enabling it in the OSS local app.
- [x] Update plan-service adapter routing so plans with `metadata.sourceAdapter = 'plannotator'` can route write-back to the Plannotator adapter even if `plan.agent` is `claude-code`, `pi`, `opencode`, or `codex`.
- [x] Add `requestChanges` support to the shared service layer and implement Plannotator write-back via local `/api/deny` or `/api/feedback`.
- [x] Add Convex schema/mutations for an entitlement-checked Pro write-back queue and status tracking.
- [x] Extend the CLI daemon to poll pending write-backs, call local `requestChanges()`, and report `sent`, `failed`, or `expired` status to Convex.
- [x] Add EE-only Cloud UI for Plannotator badges, daemon/write-back status, and `Request changes` action.
- [x] Ensure daemon watcher rescans on saved snapshot creation, annotation file creation, project-local `@plans` changes, live session creation, and live session deletion.
- [x] Ensure CLI sync includes Plannotator snapshots, project-local `@plans`, and typed metadata without duplicate cache churn.
- [x] Add tests for snapshot parsing, project-local `@plans` parsing, live-session parsing with mocked localhost responses, stale-session skipping, request-changes routing, queue polling/reporting, typed annotations, and SSRF-safe URL validation.
- [x] Coordinate or contribute a Plannotator-side enhancement so Pi and OpenCode also register live sessions in `~/.plannotator/sessions` with URL, origin, reviewId, and source plan path.

## Verification

- Run targeted adapter/service tests for Plannotator parsing, typed annotation payloads, and request-changes routing.
- Run Convex/CLI tests for write-back queue polling and status reporting.
- Run `bun run check` / Biome checks after implementation.
- Verify OSS local app behavior remains unchanged: no Plannotator Pro UI, no OSS request-changes route, and no default Plannotator adapter exposure.
- Manual Claude Code Pro flow:
  - Start Plannotator plan review from `ExitPlanMode`.
  - Confirm the Pro daemon syncs a live Plannotator plan to Agendex Cloud metadata.
  - Send request-changes from the EE Cloud UI.
  - Verify daemon picks up the queued write-back, posts to Plannotator, and Claude receives denial feedback/revises the plan.
  - Approve/deny in Plannotator and confirm `~/.plannotator/plans/*-{approved,denied}.md` is indexed and cloud-synced.
- Manual Pi Pro flow:
  - Submit a plan with `plannotator_submit_plan`.
  - Confirm live-session discovery works once Pi session registration is available.
  - Send request-changes from Cloud and verify the Pi agent receives `planDenyFeedback()`-style guidance.
- Manual OpenCode Pro flow:
  - Submit a plan with `submit_plan`.
  - Confirm live-session discovery works once OpenCode session registration is available.
  - Send request-changes from Cloud and verify the planning agent is prompted to revise and resubmit.
- Manual Codex Pro flow:
  - Use Plannotator annotate/review hook mode, not plan mode.
  - Confirm Cloud only advertises write-back when the daemon can discover a live annotate/review session.
- Cloud sync verification:
  - Run `agendex sync` / daemon sync as a Pro user and verify Plannotator snapshots appear in Cloud with metadata preserved.
  - Verify stale live sessions are not synced as durable cloud plans unless explicitly desired.

## Decisions

- First release is EE/Pro-only and includes both automatic Plannotator plan sync/indexing and daemon-mediated write-back to the originating agent when a live Plannotator session is discoverable.
- Agendex Cloud edits to Plannotator-backed live plans default to structured `request-changes` feedback, letting the agent revise the plan.
- Initial validation targets are Claude Code, Pi, OpenCode, and Codex, with the explicit Codex limitation that true plan mode is not currently supported by Plannotator/Codex.
- Saved Plannotator snapshots are durable read-only Cloud records; live Plannotator sessions with an online daemon are the only write-back-capable records.
- Plannotator integration should be treated as a Pro feature/add-on and must not surface in the OSS local-only flow.
