# Filter Non-Plan Sync

Agendex must stop indexing and syncing artifacts that are not real plans. The plan-value gate should be thorough and consistent across local indexing, CLI/daemon sync, Convex visibility, inbound cloud sync, and existing-row cleanup so empty files, straight code blocks, logs/reports, prompt-only requests, heading-only markdown, and generic session artifacts do not remain visible or synced as plans.

Use `facts.md` as the reviewed shared understanding for what must be true when this is complete.

Use `plan.md` as the approved execution plan.

Done condition: all accepted facts in `facts.md` are implemented and verified, the dry-run audit identifies existing low-value Convex rows safely, the explicit cleanup path is available for reviewed apply runs, and automated checks cover classifier fixtures, scan/rescan paths, sync pruning behavior, Convex read/sync behavior, and cleanup dry-run/apply behavior.
