# Changes since last read

Open **Changes since last read** in a plan's viewer to inspect title and body changes against the revision you previously opened. The earlier content is the removed side of the unified diff; the current content is the added side. Opening a plan remembers its full loaded revision for your next visit, even while this section is collapsed. A comparison target, list preview, or prefetch does not record a read.

Read-content baselines are separate from unread badges. **Mark all read**, pinning, and marking unread preserve the actual revision previously opened. Existing unread timestamps are not treated as saved content: the first visit after installing this feature establishes a baseline. A metadata timestamp change with the same title/body reports unchanged content.

Local mode saves `plan-read-snapshots.json` in the Agendex configuration directory. It retains at most 100 source identities and 8 MiB total, with snapshots limited to 256 KiB of serialized title/body/update data. Old snapshots are evicted first; oversized plans explicitly say they cannot be remembered. IDs, agent, source path, and workspace are part of the identity, so similarly named plans do not share content. The file is written atomically with owner-only permissions and a cross-process lock.

Cloud mode records the exact immutable history version opened by the authenticated owner. It waits for the selected plan body to load and verifies that the displayed title, body, and timestamp still match the current plan. Account and local/cloud boundaries are separate. Missing or deleted snapshots report that the baseline is unavailable rather than selecting an approximate revision by timestamp. The same 256 KiB per-plan limit applies to read comparisons; normal history retention remains unchanged.

**Forget remembered revision** clears this plan's baseline. Your next visit begins a new baseline. It does not delete the plan or cloud version history.

Local authenticated API:

- `POST /api/v1/plans/:id/read` accepts `{ "updatedAt": "<ISO date>", "title": "<displayed title>", "content": "<displayed body>" }`, verifies the displayed revision, returns `{ baseline, reason }`, then remembers it atomically. Stale content returns HTTP 409 without advancing the read boundary.
- `DELETE /api/v1/plans/:id/read` forgets the source's remembered revision.

A missing baseline means no exact comparison is possible. It does not mean no changes occurred.
