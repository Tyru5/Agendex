# Current logic review: non-plan sync/indexing

## Local scan/index pipeline

- `packages/shared/src/services/plan-value.ts` contains the primary local classifier. It marks plans as low-value via metadata keys: `lowValue`, `lowValueReasons`, and `lowValueSignals`.
- Current low-value reasons cover empty content, heading-only documents, prompt-like one-liners/titles, system context, execution reports, review output, wrapper titles, and no plan signals.
- Current positive signals cover explicit `metadata.planBlocks`, checklist lines, ordered steps, action bullets, future-plan language, and section labels such as Context, Approach, Implementation, Steps, Verification, and Acceptance Criteria.
- `packages/shared/src/services/plan-service.ts` calls `annotatePlanValueMetadata` only for plans returned by adapters and discovered project plan dirs.
- `scanUserPlans` and `scanCustomPlanDirs` call `parseGenericMarkdownPlan` and insert plans without classifier annotation.
- `rescanFile` similarly annotates adapter parses, but not user-plan or custom-dir rescans.
- `getIndexablePlans`, `getIndexableById`, search indexing, and local HTTP routes hide only plans whose metadata has `lowValue: true`.
- Result: user-created local plans and custom directories can index empty, heading-only, prompt-only, log/report, and code-only artifacts locally unless later caught by cloud-side visibility heuristics.

## Adapter behavior and source risks

- `codex-cli` extracts explicit `<proposed_plan>` blocks when present, otherwise falls back to assistant final answers or all assistant text. This can produce empty content, review output, execution reports, code-only answers, or generic conversations.
- `continue-ide` indexes entire sessions as role-separated text, which is often not a plan.
- `claude-code`, `cursor`, `oh-my-opencode`, and `plannotator` read markdown-ish plan files directly; some are real plans, but code-dominated documents and heading-only files can still pass if the local classifier is too permissive or not applied.
- Plannotator project dirs (`@plans`) and Oh My Opencode dirs (`.sisyphus/plans`) are discovered automatically; custom dirs can also point at arbitrary session/artifact folders.

## CLI sync behavior

- `packages/cli/src/sync.ts` and `packages/cli/src/daemon.ts` build payloads for both syncable and low-value plans.
- Low-value plans are sent to the cloud with `metadata.lowValue: true` so the cloud endpoint can delete/prune any previously synced row with the same `localPlanId`.
- The sync cache hashes the full payload. Once a low-value prune payload succeeds, future runs skip it as unchanged.
- Watcher changes queue whatever `rescanFile` returns; if custom/user rescans do not annotate low-value content, those changes can still be synced as normal plans.

## Convex/cloud behavior

- `packages/ee/convex/cli.ts` `/api/cli/sync` deletes an existing plan only when incoming metadata has `lowValue: true`; otherwise it upserts the row. It does not independently run `isLikelyLowValuePlan` before upsert.
- `packages/ee/convex/planVisibility.ts` duplicates a smaller version of the classifier for query-time visibility.
- `isLikelyLowValuePlan` bypasses heuristics when `metadata.userCreated === true` or `metadata.source === 'custom-dir'`.
- `getMyPublishedPlans`, `getPlan`, and sharing queries hide invisible plans, but hiding does not remove them from the `plans` table.
- `packages/ee/convex/plans.ts` `publishPlan` and `updatePlanContent` do not validate plan value before inserting/updating cloud-created or uploaded plans.
- Plan versions can preserve low-value content as version rows if edits/publishes are allowed without classification.

## Current Convex table sample

- A sampled dev deployment query read 866 `plans` documents.
- Agent breakdown included: `codex-cli` 546, `claude-code` 128, `auto-sessions` 131, `oh-my-opencode` 23, `cursor` 13, `plannotator` 13, and smaller one-off agents.
- Metadata source breakdown included: `none` 679, `custom-dir` 138, `plan-file` 23, and `plannotator` 26.
- A simple content-shape audit found 76 suspicious rows: 59 empty, 7 code-dominated, 1 code-block-with-little-prose, and 10 short/no-plan-language rows.
- Running the existing shared classifier against the same sample flagged 138 low-value rows: 59 empty-content, 48 execution-report, 19 prompt-like, 14 no-plan-signals, 10 wrapper-title, 5 review-output, and 1 heading-only.
- Running the existing Convex visibility classifier found 132 invisible rows, but those rows still remain in the table and are not deleted unless a low-value metadata sync arrives.
- The sample includes concrete problematic shapes the user called out: empty rows, straight code blocks/code-dominated rows, heading-only rows, CI/log/output artifacts, review outputs, and prompt/session artifacts.

## Key gaps to resolve

1. The canonical classification logic is duplicated and divergent between shared local code and Convex.
2. Custom-dir and user-created sources bypass local annotation; Convex also bypasses custom/user visibility heuristics.
3. Cloud sync trusts local metadata for pruning and does not validate every inbound payload before upsert.
4. Cloud create/upload/edit flows can insert or preserve low-value plans.
5. Existing low-value rows are hidden at query time in some cases but remain in Convex tables.
6. The current classifier is not strict enough for code-only/code-dominated content and generic non-plan conversations.
7. There is no dry-run audit/cleanup workflow that reports and prunes existing bad rows safely.
