# Agendex × Plannotator-Inspired Feature Plan

## Status update — implemented MVP slice

**Updated:** 2026-06-01
**Current state:** The first implementation pass is complete and ready for Plannotator review.

This plan keeps Agendex positioned as the durable plan system of record and collaboration layer, while Plannotator remains the local/hook-native review gate. The implementation below adapts Plannotator-inspired annotation and feedback loops without cloning Plannotator wholesale.

## What has been implemented

### 1. Shared annotation model and feedback utilities — implemented

Files:

- `packages/shared/src/annotations.ts`
- `packages/shared/src/annotations.test.ts`
- `packages/shared/src/services/annotation-store.ts`
- `packages/shared/src/index.ts`
- `packages/web/src/client/lib/annotations.ts`

Implemented:

- `PlanAnnotationRecord`, `PlanTextAnchor`, annotation status/kind types.
- Text anchor creation with quote, offsets, surrounding context, and content hash.
- Conversion from Agendex annotations to Plannotator-compatible plan annotation payloads.
- Agent feedback formatting for selected annotations.
- Local JSON-backed annotation store under the Agendex config directory.
- Focused tests for anchor creation, feedback formatting, and Plannotator conversion.

Notes:

- The web package has a small mirrored annotation type/helper module so the shared UI can avoid workspace/package-resolution issues while still matching the shared model shape.

### 2. Local/private annotation API — implemented

Files:

- `packages/app/src/server/routes/plans.ts`
- `packages/web/src/client/lib/api.ts`

Implemented local endpoints:

- `GET /api/v1/plans/:id/annotations`
- `POST /api/v1/plans/:id/annotations`
- `PATCH /api/v1/plans/:id/annotations/:annotationId`
- `DELETE /api/v1/plans/:id/annotations/:annotationId`

Notes:

- These endpoints are local/private daemon APIs protected by the existing local token middleware.
- The OSS local UI does not yet expose annotation creation, keeping the product surface Pro-first while still allowing local plumbing/tests.

### 3. Convex Cloud annotation persistence — implemented

Files:

- `packages/ee/convex/schema.ts`
- `packages/ee/convex/annotations.ts`
- `packages/ee/convex/_generated/api.d.ts`

Implemented:

- New `planAnnotations` table with indexes:
  - `by_plan`
  - `by_plan_status`
  - `by_author_plan`
- Entitlement-checked annotation queries/mutations:
  - `listForPlan`
  - `createAnnotation`
  - `updateAnnotation`
  - `markSubmitted`
  - `deleteAnnotation`
- Owner-only write access with `ProFeature.PLANNOTATOR_INTEGRATION` enforced on mutations.
- Workspace/member read support mirrors existing Cloud plan access patterns.

### 4. Inline annotation UI in PlanViewer — implemented as MVP

Files:

- `packages/web/src/client/components/PlanViewer.tsx`
- `packages/web/src/client/hooks/usePlanAnnotationHighlights.ts`
- `packages/web/src/client/index.css`
- `packages/web/src/index.ts`
- `packages/web/src/vite-env.d.ts`

Implemented:

- Host-gated annotation props on `PlanViewer`:
  - `annotations`
  - `selectedAnnotationId`
  - `canCreateAnnotations`
  - `annotationUpgradeMessage`
  - `onCreateAnnotation`
  - `onSelectAnnotation`
- Selection toolbar for highlighted plan text.
- MVP actions:
  - Comment
  - Replace
  - Delete
- Highlight rendering for unresolved annotations.
- Selected-highlight styling and keyboard/click selection behavior.
- Upgrade note slot for non-entitled Cloud surfaces.

Known MVP trade-off:

- The first pass uses browser prompts for entering annotation body/replacement text. A richer popover/editor remains a follow-up polish item.

### 5. Cloud Pro annotation panel and write-back submission — implemented

Files:

- `packages/ee/src/components/CloudPlanAnnotationsPanel.tsx`
- `packages/ee/src/App.tsx`
- `packages/ee/src/components/CloudPlannotatorPanel.tsx`

Implemented:

- `useCloudPlanAnnotations` hook for loading/creating annotations from Convex.
- Cloud annotation panel below Cloud plan viewer.
- Annotation list with status, selected quote, body, replacement text, resolve/reopen, and delete actions.
- Submit-to-agent action for open annotations.
- Open annotations are formatted into feedback and converted into Plannotator annotation payloads.
- Existing manual Plannotator write-back panel is retained as an advanced/manual fallback and copy was updated accordingly.

### 6. Plannotator write-back queue integration — implemented

Files:

- `packages/ee/convex/plannotator.ts`
- `packages/cli/src/daemon.ts` (existing daemon path reused)

Implemented:

- `enqueueWriteback` now accepts `annotationIds` in addition to typed Plannotator feedback annotations.
- The mutation validates that selected annotations belong to the plan and author.
- When a write-back is queued, included annotations are patched to:
  - `status: 'submitted'`
  - `submittedAt`
  - `writebackId`
- Existing daemon polling/delivery path remains the transport layer for Cloud → local Plannotator feedback delivery.

### 7. Initial Claude Code / Codex / Pi hook manager — implemented as safe skeleton

Files:

- `packages/cli/src/hooks.ts`
- `packages/cli/src/cli.ts`

Implemented CLI commands:

- `agendex hooks status`
- `agendex hooks install <claude-code|codex|pi|all> [--scope repo|user] [--dry-run]`
- `agendex hooks uninstall <claude-code|codex|pi|all> [--scope repo|user] [--dry-run]`
- `agendex hooks doctor`
- `agendex review-plan --hook --agent <agent>`

Implemented behavior:

- Claude Code install merges a managed `PermissionRequest` / `ExitPlanMode` command hook.
- Codex install enables `[features].hooks = true` and merges a managed `Stop` hook.
- Pi install writes an Agendex Pi extension with `/agendex-review-plan` and `/agendex-annotate` commands.
- Install/uninstall creates backups before modifying or removing managed config.
- Unknown existing hook entries are preserved.

Known MVP trade-off:

- `agendex review-plan --hook` currently preserves the hook-native pass-through contract by exiting `0` with empty stdout. The interactive local review-session server is still deferred.

## Verification completed

Passed:

- LSP diagnostics on changed files: **0 errors**
- Changed-file formatting check: **passed**
- Changed-file lint: **0 warnings, 0 errors**
- Tests: **8 passed**
  - `packages/shared/src/annotations.test.ts`
  - `packages/cli/src/api.test.ts`
  - `packages/cli/src/writeback-delivery-cache.test.ts`
- EE build: **passed**
- OSS app build: **passed**

Known existing repo noise:

- Full `bun run check` still reports pre-existing warnings unrelated to this implementation.
- The working tree also shows pre-existing deleted docs/old plan files that were not part of this implementation pass.

## Still deferred / not implemented yet

### A. Interactive hook-native review sessions

Deferred files/modules from the original plan:

- `packages/cli/src/review-session.ts`
- `packages/app/src/server/routes/review-sessions.ts`
- browser review route for hook-launched sessions

Needed next:

- `agendex review-plan --hook` should open an Agendex review page, block until decision, and emit hook-native JSON only when the user requests changes.
- Current command is a safe pass-through stub.

### B. Rich annotation editor UX

Needed next:

- Replace `window.prompt` with an accessible popover/editor.
- Add explicit annotation type picker, severity, keyboard focus management, and cancel/save actions.
- Add better markdown-anchor rebind UI when selected text changes.

### C. External annotation ingestion API

Deferred:

- External tools pushing annotations directly into an Agendex review session or Cloud plan.
- Validation and source attribution for external scanners/reviewers.

### D. Diff-aware annotations and history

Deferred:

- Attach annotations to historical versions and diff hunks.
- Show unresolved annotations since last version.
- Add badges/counts in `PlanHistoryDrawer`.

### E. Collaboration workflow

Deferred:

- Share-link annotation permissions.
- Assignment, notifications, activity feed.
- Review-complete state per plan.

### F. Deeper Pi lifecycle integration

Partially implemented:

- Pi extension install and commands exist.

Deferred:

- Native Pi lifecycle interception that automatically opens Agendex review and injects structured feedback into the active Pi session.

## Product decisions reflected in implementation

- Keep comments and plan annotations separate.
- Keep annotation creation Pro-first in Cloud.
- Use the existing Plannotator daemon/Convex write-back queue as delivery infrastructure.
- Avoid duplicating the old freeform write-back UX as the primary path; annotations are now the preferred structured feedback path.
- Support Claude Code, Codex, and Pi first in the hook manager.
- Treat old `plans/plannotator-integration.md` as historical baseline, not an implementation constraint.

## Review questions for Plannotator

1. Is the MVP split correct: annotations + Cloud submit path now, full hook-native review session later?
2. Should local/private annotation endpoints exist in OSS plumbing if the visible annotation UI remains Cloud Pro-only?
3. Should `agendex review-plan --hook` remain pass-through until the review-session server is complete, or should it fail loudly to avoid a false sense of protection?
4. Is the Pi extension skeleton sufficient for initial support, or should native Pi lifecycle events be promoted into the next milestone?
5. Is the remaining manual Plannotator write-back panel useful as an advanced fallback, or should it be removed once inline annotations are stable?

## Plannotator review result

Latest gated Plannotator review returned one action item:

> Implement the next deferred steps.

Decision: move the next deferred milestone from “recommended” to **active implementation scope**. The next coding pass should focus on the local review-session engine before expanding collaboration/history features.

## Active next milestone

Build the local review-session engine:

1. Add local review-session routes and persistence.
2. Make `agendex review-plan --hook` open the review page and block for a decision.
3. Reuse the annotation panel inside that review page.
4. Emit correct hook-native output:
   - approve/close → empty stdout
   - request changes → `{"decision":"block","reason":"<formatted feedback>"}`
5. Add Claude Code and Codex manual end-to-end validation.

Implementation checklist for this milestone:

- [ ] Add `packages/shared/src/services/review-session-store.ts` for local pending review state.
- [ ] Add `packages/app/src/server/routes/review-sessions.ts` with create/read/decide endpoints.
- [ ] Add a minimal local review page that renders the plan, annotations, approve, and request-changes controls.
- [ ] Update `packages/cli/src/hooks.ts` so `review-plan --hook` creates a session, opens the local review URL, waits for the decision, and prints hook-native JSON only for request-changes.
- [ ] Add timeout/cancel behavior so hooks cannot hang indefinitely without a clear message.
- [ ] Add tests for approve, request-changes, timeout, and malformed session payloads.
