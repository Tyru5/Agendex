# Plan: Annotate Low-Value / Non-Plan Entries

## Context

Agendex indexes plans from local agent adapters and custom markdown directories. Some agent/session-derived entries can have little or no plan value: empty markdown, captured user invocations, model thoughts/system context, execution summaries, or session transcript fragments that are not actual implementation plans.

User decisions:

- Low-value entries should **stay indexed**; they should be annotated with metadata instead of removed.
- Detection should apply only to **agent/session-derived sources**, not user-created plans or generic custom markdown directories.
- One-line prompts and entries with no meaningful content should be treated as low-value.
- The provided screenshot shows a Codex JSONL entry whose title is an invocation (`IMPORTANT: Work in the repository...`) and whose body is an execution/report-style response rather than a plan; that should be detectable as low-value metadata.

Code findings:

- Local indexing is centralized in `packages/shared/src/services/plan-service.ts`.
- Agent adapters return `Plan[]` directly; `scan()` and `rescanFile()` currently add every parsed adapter plan without value assessment.
- Generic markdown parsing in `parseGenericMarkdownPlan()` is used for user-created plans and custom plan dirs; this path should remain unannotated per the source-scope decision.
- Agent-derived adapters that should be assessed:
  - `packages/shared/src/adapters/claude-code.ts`
  - `packages/shared/src/adapters/cursor.ts`
  - `packages/shared/src/adapters/oh-my-opencode.ts`
  - `packages/shared/src/adapters/codex-cli.ts`
- `packages/shared/src/adapters/codex-cli.ts` already has useful extraction heuristics for `<proposed_plan>` blocks, final answers, meaningful user text, and system-context filtering, but still returns a `Plan` even when the selected content may not be a real plan.
- CLI sync (`packages/cli/src/sync.ts`, `packages/cli/src/daemon.ts`) sends `plan.metadata` already.
- Cloud storage already accepts and stores arbitrary `metadata` via `SyncPlanPayload`, `packages/ee/convex/cli.ts`, `packages/ee/convex/plans.ts`, and the Convex schema (`metadata: v.optional(v.any())`), so no cloud schema change is needed.

## Approach

Create a shared, deterministic plan-value assessment helper in `@agendex/shared` and apply it only to adapter-derived plans before they are placed into the in-memory store. Do **not** filter low-value entries out; preserve them with metadata.

Recommended metadata shape:

```ts
metadata: {
  ...existingMetadata,
  lowValue: true,
  lowValueReasons: ['empty-content' | 'heading-only' | 'prompt-like' | 'system-context' | 'execution-report' | 'no-plan-signals'],
  lowValueSignals: string[],
}
```

Implementation notes:

- Keep the metadata deterministic; do not include timestamps or scan-specific values, because CLI sync hashes include metadata and non-deterministic fields would cause repeated sync churn.
- Preserve existing adapter metadata such as Codex `sessionId` / `planBlocks` and Oh My Opencode `source`.
- Strip stale low-value keys before reassessing a plan, then add them back only when the current assessment says the plan is low-value.
- Leave valuable plans unmarked unless a future UI needs explicit `value: 'normal'` metadata.

Assessment behavior:

1. Normalize plan content by removing frontmatter/comments, proposed-plan tags, markdown boilerplate, whitespace-only markup, and common session/system wrappers.
2. Mark as low-value when any strong negative condition is present:
   - Empty or whitespace-only content after normalization.
   - Content that is only a title/heading with no body.
   - One-line prose prompts/invocations without plan structure.
   - Content dominated by known system/thought wrappers such as environment context, system reminders, AGENTS instructions, `<thinking>` blocks, or tool-call logs.
   - Execution/status report content like “fixed/pushed/committed/passed” plus command markers, without forward-looking plan structure.
3. Treat positive plan signals as valuable:
   - Plan-oriented headings/sections such as Context, Approach, Files to modify, Steps, Verification, Implementation plan, Tasks, Checklist.
   - Markdown checklists or ordered implementation steps, including short checklist entries.
   - Multiple actionable sections/bullets with implementation language.
   - Explicit Codex `<proposed_plan>` blocks (`metadata.planBlocks`) as a strong positive signal.
4. For ambiguous multi-line content, prefer not marking low-value unless clear negative signals outweigh plan signals. The goal is conservative annotation, not hiding data.

Source gating:

- Run the assessment in the adapter loops in `scan()` and the adapter branch of `rescanFile()`.
- Do not run it in `scanUserPlans()`, `scanCustomPlanDirs()`, user plan `create()`, or generic markdown rescan branches.

## Files to modify

- `packages/shared/src/services/plan-value.ts` (new) — normalization, assessment, metadata annotation helpers, and reason/signal types.
- `packages/shared/src/services/plan-service.ts` — call the annotation helper only for adapter-derived plans in `scan()` and `rescanFile()`.
- `packages/shared/src/services/plan-value.test.ts` (new) — focused classifier tests.
- `packages/shared/src/services/plan-service.test.ts` — integration tests proving adapter-derived plans are annotated while user/custom plans are not.
- `packages/shared/src/adapters/codex-cli.ts` — optional small refactor only if needed to share proposed-plan normalization or expose deterministic content-source metadata.
- `packages/shared/src/index.ts` — export the helper/types only if another package needs them; otherwise keep internal to shared services.

No expected schema/API changes:

- `packages/cli/src/api.ts`, `packages/cli/src/sync.ts`, and `packages/cli/src/daemon.ts` already carry `metadata` through sync payloads.
- `packages/ee/convex/schema.ts`, `packages/ee/convex/cli.ts`, and `packages/ee/convex/plans.ts` already persist metadata.

## Reuse

- `codex-cli.ts` already includes logic worth reusing or mirroring:
  - `normalizeLineEndings()`
  - `stripProposedPlanTags()` / proposed-plan tag regexes
  - `isMeaningfulUserText()` system-context filtering
  - `titleFromPlanBlock()` positive heading extraction
- `plan-service.ts` already centralizes scan and rescan insertion points, which avoids changing every adapter.
- Existing Bun test style in `packages/shared/src/services/plan-service.test.ts` can be reused for temporary adapter tests.

## Steps

- [ ] Add `plan-value.ts` with normalization, `assessPlanValue()`, and `annotatePlanValueMetadata()` helpers.
- [ ] Define deterministic low-value metadata keys and a closed set of reason strings.
- [ ] Implement negative detection for empty/heading-only content, one-line prompt-like invocations, system/thought wrappers, and execution-report/transcript-like responses.
- [ ] Implement positive detection for plan sections, checklists, ordered steps, implementation bullets, and Codex `metadata.planBlocks`.
- [ ] Update `scan()` adapter paths to store annotated plans instead of raw adapter plans.
- [ ] Update `rescanFile()` adapter path to annotate reparsed plans; leave user/custom rescan branches unchanged.
- [ ] Add classifier unit tests for empty content, heading-only content, one-line prompts, system context/model thought, screenshot-like Codex execution summaries, valid structured plans, and short checklist plans.
- [ ] Add plan-service integration tests showing adapter-derived low-value plans stay indexed with `metadata.lowValue === true`, while user/custom generic markdown plans are not assessed.
- [ ] Run shared tests and repository checks.

## Verification

- Run the new `plan-value` tests and updated `plan-service` tests.
- Run `bun test packages/shared/src/services/plan-value.test.ts packages/shared/src/services/plan-service.test.ts` or the project’s equivalent Bun test command.
- Run `bun run check` or targeted `biome check`/TypeScript checks if full checks are too broad.
- Manually scan sample agent-derived files/sessions and verify:
  - Empty/heading-only/prompt-like/execution-report entries still appear in `getAll()` and `/plans`.
  - Those entries include deterministic metadata such as `lowValue: true` and `lowValueReasons`.
  - Valid plans from Claude Code, Cursor, Oh My Opencode, and Codex proposed-plan sessions are not marked low-value.
  - User-created plans and generic custom directory markdown are not annotated by this detector.
  - Cloud sync payloads include the low-value metadata without requiring any schema changes.
