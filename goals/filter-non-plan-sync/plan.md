# Plan: Filter Non-Plan Sync

## Solution approach

Make plan-value classification a strict, shared gate rather than a best-effort UI filter. The local scanner should classify every source before it becomes indexable, the CLI should only use low-value payloads for pruning previously synced cloud rows, and Convex should independently classify inbound/visible plans so old or buggy clients cannot populate the `plans` table with code blocks, logs, empty rows, prompt-only requests, or session artifacts.

The accepted facts intentionally omit the proposed hard requirement that cloud create/upload/edit mutations must reject low-value content with a blocking error. Treat those cloud write paths as validation/read-path work: they must not bypass classification or make low-value content visible, but blocking manual creation can remain a follow-up unless implementation discovery shows it is necessary to satisfy the accepted visibility/sync facts.

## Ordered steps

### 1. Turn the classifier into the canonical contract

Files/systems:

- `packages/shared/src/services/plan-value.ts`
- `packages/shared/src/services/plan-value.test.ts`
- `packages/shared/package.json`
- optionally `packages/shared/src/plan-value-fixtures.ts` or `packages/shared/src/services/plan-value.fixtures.ts`

Work:

- Extend `PlanLowValueReason` with reason codes for the missing shapes observed in Convex, especially `code-dominated` / `code-only` and a generic conversation/session artifact reason if needed.
- Add normalized content metrics: visible text, meaningful non-code prose words, fenced code blocks, indented code blocks if practical, code character share, section count, checklist count, ordered-step count, action bullet count, and future-plan language.
- Make the classifier stricter: a plan is indexable only when it has explicit plan structure or enough actionable planning prose. Strong positives remain explicit `metadata.planBlocks`, checklists, ordered steps, action bullets, plan sections, files-to-change, verification, and acceptance criteria.
- Preserve the accepted exception for minimal checklist plans such as `- [ ] Fix login bug`.
- Mark code-only/code-dominated content low-value when it lacks enough non-code planning prose or explicit plan structure.
- Add fixture coverage for:
  - empty/frontmatter/comment-only content;
  - heading-only markdown;
  - prompt-only requests and prompt-like titles;
  - generic chat/session artifacts;
  - system/tool logs;
  - execution reports;
  - review outputs and wrapper titles;
  - code-only fenced blocks;
  - code-dominated answers with only a sentence of prose;
  - code-heavy but valid implementation plans with explicit steps/verification;
  - structured plans and short checklist plans that must stay indexable.
- Expose the classifier through a safe shared subpath such as `@agendex/shared/plan-value` rather than importing the top-level shared index from Convex. This avoids pulling Node-only shared modules into Convex bundles.

Verification:

- `bun test packages/shared/src/services/plan-value.test.ts`
- Add parity fixture assertions for every accepted low-value/valuable shape.

### 2. Apply the local gate to every local source and rescan path

Files/systems:

- `packages/shared/src/services/plan-service.ts`
- `packages/shared/src/services/plan-service.test.ts`
- `packages/shared/src/services/watcher.ts` indirectly through `rescanFile`
- adapters under `packages/shared/src/adapters/*.ts` only if source-specific metadata needs tightening

Work:

- Introduce a small helper in `plan-service.ts`, e.g. `preparePlanForIndex(plan: Plan): Plan`, that calls `annotatePlanValueMetadata` for every plan before it enters `store`.
- Use that helper for:
  - active adapter scans;
  - discovered project plan dir scans;
  - `scanUserPlans`;
  - `scanCustomPlanDirs`;
  - adapter `rescanFile` results;
  - user-plan `rescanFile` results;
  - custom-dir `rescanFile` results;
  - `create()` results.
- Remove the effective source bypass for user-created and custom-dir local plans. Their provenance metadata should stay, but it must not suppress low-value annotation.
- Ensure `getIndexablePlans`, `getIndexableById`, `getAgentStats`, local search, raw routes, and annotation routes continue using indexable-only helpers.
- Add plan-service tests proving:
  - custom-dir empty/code-only/log-like markdown is stored with `metadata.lowValue: true` and excluded from `getIndexablePlans()`;
  - user-created heading-only/prompt-only markdown is low-value and excluded;
  - custom/user structured plans and short checklist plans remain indexable;
  - `rescanFile` behaves the same as full `scan()` for adapter, user, and custom sources;
  - agent stats exclude low-value plans across all sources.

Verification:

- `bun test packages/shared/src/services/plan-service.test.ts`
- `bun test packages/shared/src/services/plan-value.test.ts packages/shared/src/services/plan-service.test.ts`

### 3. Keep sync semantics prune-only for low-value local items

Files/systems:

- `packages/cli/src/sync.ts`
- `packages/cli/src/daemon.ts`
- `packages/cli/src/payload.ts`
- `packages/cli/src/sync-cache.ts`
- new or expanded tests such as `packages/cli/src/sync.test.ts` and `packages/cli/src/daemon.test.ts`

Work:

- Preserve the current design where low-value local plans are queued/sent only so the cloud endpoint can delete an existing row with the same `localPlanId`.
- Ensure the stricter local annotation changes the payload hash, so a plan previously synced as normal will be sent once more as low-value and pruned instead of being skipped by cache.
- Add tests with a fake cloud HTTP server for one-shot sync:
  - valuable plans are sent as normal;
  - low-value custom/user/adapter plans include `metadata.lowValue` and are counted as skipped/pruned;
  - unchanged low-value prune payloads are cached after success;
  - forced sync still sends low-value prune payloads.
- Add or extend daemon tests around watcher/rescan queueing so changed low-value plans are queued as prune payloads, not normal create/update payloads.
- Keep Plannotator live-session end patches working; if an ended live-session payload is low-value by content, make sure liveness cleanup still reaches the cloud or document the exception. Live-session state should not reintroduce non-plan visibility.

Verification:

- `bun test packages/cli/src/sync.test.ts packages/cli/src/daemon.test.ts`
- `bun test packages/cli/src/payload.test.ts packages/cli/src/api.test.ts`

### 4. Replace Convex visibility duplication with the canonical gate

Files/systems:

- `packages/ee/convex/planVisibility.ts`
- `packages/ee/convex/plans.ts`
- `packages/ee/convex/sharing.ts`
- `packages/ee/convex/planPreferences.ts`, `planTags.ts`, `collections.ts`, and other plan-adjacent reads if they can expose low-value rows indirectly
- `packages/shared/package.json`

Work:

- Import the shared classifier through the safe subpath created in Step 1.
- Refactor `planVisibility.ts` so `isLikelyLowValuePlan` and `isVisiblePlan` use the same assessment as local sync.
- Remove the current Convex bypass for `metadata.userCreated === true` and `metadata.source === 'custom-dir'`.
- Keep `hasLowValueMetadata` for backwards compatibility, but do not rely on metadata alone.
- Ensure all cloud read paths use `isVisiblePlan` or `filterVisiblePlans` before returning a plan or allowing a share/writeback action. The known already-covered paths are:
  - `plans.getMyPublishedPlans`;
  - `plans.getPlan`;
  - `plans.getPlanByShareToken`;
  - sharing create/read flows.
- Audit tag, collection, preferences, comments, plan history, and Plannotator writeback paths. If a function fetches a plan and then returns plan-derived data, either require `isVisiblePlan(plan)` or prove it cannot expose low-value plan content.
- Add Convex-side pure unit tests for `planVisibility.ts` using the same fixture corpus as shared classifier, or add a parity test that imports both and asserts identical outcomes.

Verification:

- `bun test packages/ee/convex/planVisibility.test.ts`
- `grep`/AST review for `ctx.db.get(args.planId)` and `query('plans')` call sites to confirm visibility checks where needed.

### 5. Make Convex sync independently prune low-value payloads

Files/systems:

- `packages/ee/convex/cli.ts`
- `packages/ee/convex/planDeletion.ts`
- `packages/ee/convex/planVisibility.ts`
- optional tests for the sync handler or extracted helper

Work:

- In `/api/cli/sync`, classify the inbound body using the canonical classifier before `upsertPlan`.
- Treat a payload as low-value if either `metadata.lowValue === true` or the canonical assessment says low-value.
- If low-value:
  - find the existing row by owner/localPlanId;
  - delete it with `deleteSyncedPlan`, which already calls `deletePlanRelatedData`;
  - return `{ ok: true, skippedLowValue: true, deleted, lowValueReasons }` or equivalent explainable metadata.
- If valuable:
  - strip stale low-value metadata keys before upsert, or patch them away in `upsertPlan`, so corrected plans can become visible again;
  - optionally persist positive/negative classifier signals in metadata under an Agendex-specific key if helpful for auditability, without bloating records.
- Keep privacy stripping behavior intact and run classification after stripping only if the metadata change can affect classification; otherwise classify the plan content/title plus sanitized metadata consistently.

Verification:

- Unit test an extracted helper, e.g. `classifySyncPayloadForStorage`, with payloads that omit `lowValue` metadata but are empty/code-only/log-like.
- If practical, add an HTTP action integration-style test with a fake/mocked Convex context for low-value prune and valuable upsert branches.

### 6. Validate cloud write/read behavior without adding the rejected hard-block requirement

Files/systems:

- `packages/ee/convex/plans.ts`
- `packages/ee/src/components/CloudPlanCreator.tsx`
- `packages/ee/src/components/CloudPlanUploader.tsx`
- `packages/ee/src/components/CloudPlanEditor.tsx`
- `packages/ee/src/hooks/usePublishing.ts`

Work:

- Because the fact requiring hard rejection of cloud create/upload/edit was not accepted, do not make blocking errors the core done condition.
- Still ensure cloud-created/uploaded/edited content is classified somewhere before it can be visible through accepted read paths.
- Preferred low-risk approach:
  - `publishPlan` and `updatePlanContent` classify the incoming content;
  - if low-value, store `metadata.lowValue`, `lowValueReasons`, and `lowValueSignals` or return a non-destructive validation result, depending on what best fits the existing UI flow;
  - all read paths then hide the row through `isVisiblePlan`.
- If implementation review shows hidden manual cloud rows create confusing UX, add a small UI warning/error as a follow-up or explicitly ask for a product decision before making rejection behavior mandatory.
- Ensure plan versions do not cause low-value content to reappear through history/restore paths; restore should classify the target version before making it current.

Verification:

- Tests or manual checks proving low-value content created/uploaded/edited through cloud paths cannot appear in plan lists, direct plan fetches, share links, or restore flows.
- If the implementation chooses to block instead of mark-hidden, add UI/error tests and document the departure from the accepted facts.

### 7. Add dry-run audit and explicit cleanup for existing Convex rows

Files/systems:

- new `packages/ee/convex/planCleanup.ts` or similar
- `packages/ee/convex/planDeletion.ts`
- optional script under `packages/ee/scripts/` for operator-friendly invocation
- `goals/filter-non-plan-sync/review-notes.md` as the baseline sample

Work:

- Add a dry-run cleanup function that scans existing `plans` rows in bounded batches and classifies each row with the canonical gate.
- Default to no deletion. The dry-run output should include:
  - total rows scanned;
  - low-value row count;
  - counts by reason;
  - counts by agent;
  - counts by metadata source/provenance;
  - representative row IDs/titles/lengths/reasons without dumping full content.
- Add an explicit apply mode that deletes low-value rows and related data using `deletePlanRelatedData` before `ctx.db.delete(planId)`.
- Guard the cleanup function so it cannot be invoked by arbitrary app users. Use an admin token/environment variable, a deploy-only operator script, or another existing admin mechanism.
- Batch deletes to respect Convex limits and make repeated runs idempotent.
- Run the dry-run against the current deployment before apply. The previous baseline sample found 866 rows with 138 low-value by the shared classifier and 132 invisible by existing Convex heuristics; use that as a sanity check, not as a hard expected count.

Verification:

- Dry-run command prints a grouped report and deletes nothing.
- Apply command deletes only classified low-value rows and related data.
- Re-running dry-run after apply reports zero or only newly-created low-value rows.

### 8. Final verification and regression sweep

Files/systems:

- all touched source/test files
- current Convex deployment data

Work:

- Run focused tests first, then broad checks.
- Run the cleanup dry-run and review its report before any apply.
- If apply is approved, run it in batches and rerun dry-run afterward.
- Manually inspect a small sample of retained plans and pruned candidates to catch false positives/negatives, especially code-heavy implementation plans.

Verification commands/checks:

- `bun test packages/shared/src/services/plan-value.test.ts`
- `bun test packages/shared/src/services/plan-service.test.ts`
- `bun test packages/cli/src/sync.test.ts packages/cli/src/daemon.test.ts`
- `bun test packages/ee/convex/planVisibility.test.ts`
- `bun run check`
- `cd packages/ee && bunx convex codegen` or the project’s equivalent Convex typecheck/deploy validation
- Dry-run audit, for example through the final operator command added in Step 7.
- Optional post-apply query: sample `plans` rows and confirm empty/code-only/log-like rows no longer remain visible or present after cleanup.

## Risks and open questions

- **False positives on code-heavy real plans:** Some legitimate implementation plans include long code samples. The classifier must allow code-heavy content when explicit plan structure and verification steps exist.
- **Convex bundling constraints:** Importing the top-level shared package from Convex may pull in Node-only modules. Use a dedicated shared subpath for the classifier.
- **Manual cloud create/edit UX:** The accepted facts do not require hard rejection for cloud manual writes. If marking/hiding low-value manual rows feels confusing, pause and ask for a product decision before blocking those flows.
- **Cleanup permissions:** A public cleanup mutation would be dangerous. The apply path needs an explicit operator/admin guard and safe batching.
- **Cache interaction:** Existing sync cache entries may skip old low-value rows unless the low-value metadata changes the payload hash. Tests should prove the stricter classifier causes one prune sync for formerly normal rows.
- **Duplicated historical versions:** Deleting plans must clean versions, tags, collections, comments, preferences, annotations, and share links through `deletePlanRelatedData`; restore/history paths also need visibility validation.
