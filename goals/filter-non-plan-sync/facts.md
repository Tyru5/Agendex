# Facts

- Every local plan source is assessed before it becomes indexable: adapter scans, discovered project plan dirs, user-created local plans, custom plan dirs, and file rescans all pass through the same plan-value gate.
- No source automatically bypasses low-value classification; custom-dir and user-created metadata no longer make empty, code-only, log/report, prompt-only, or heading-only content visible or syncable.
- The classifier treats empty content, frontmatter/comment-only content, heading-only markdown, prompt-only requests, generic chat/session artifacts, system/tool logs, execution reports, review outputs, and wrapper-title answers as low-value.
- The classifier treats code-only or code-dominated content as low-value when there is not enough non-code planning prose or explicit plan structure around the code.
- A real plan remains indexable when it has explicit planning structure such as goals/context, approach, ordered steps, checklist tasks, files to change, verification, or acceptance criteria.
- Minimal but intentional checklist plans, such as a single unchecked task, remain valid plans and are not rejected solely for being short.
- The local app list, search index, raw-plan routes, annotation routes, and agent counts only use indexable plans after the stricter gate is applied across all sources.
- The CLI one-shot sync and daemon never create or update cloud plan rows with low-value content as normal synced plans; low-value local items are only used to prune/delete any previously synced row for the same local plan identity.
- The Convex CLI sync endpoint independently classifies each inbound payload and prunes low-value content even when an older or buggy client omits lowValue metadata.
- Convex plan visibility, direct plan fetches, sharing flows, and workspace plan lists use the same classification behavior as local sync so low-value rows cannot appear through alternate cloud read paths.
- There is a dry-run audit for existing Convex plans that reports how many rows would be pruned, grouped by reason, source/agent, and representative metadata, without deleting anything by default.
- There is an explicit apply cleanup path for existing Convex plans that deletes low-value plan rows and their related data with deletePlanRelatedData, after the dry-run output has been reviewed.
- Low-value decisions are deterministic and expose reason codes/signals in metadata, logs, or audit output so a rejected or pruned plan can be explained without inspecting implementation internals.
- The shared/local and Convex classifiers stay in parity through a single reusable implementation or through parity tests over the same fixture corpus.
- Automated verification covers classifier fixtures, scan/rescan source paths, one-shot and daemon sync behavior, Convex sync/publish/edit validation, visibility/read paths, and cleanup dry-run/apply behavior.
