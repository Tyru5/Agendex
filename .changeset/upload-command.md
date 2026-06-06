---
'agendex-cli': minor
---

Add `agendex upload <path>` to push a single existing Markdown plan file directly to the cloud webapp via the authenticated sync flow, without running a full adapter scan. The plan id is derived from the absolute file path so re-uploading the same file updates the same cloud plan. Supports `--agent <name>` to override the plan's agent label and `--open` to open the uploaded plan in the browser. On success it prints a direct dashboard URL (`/dashboard?plan=<id>`); when not logged in or lacking a Cloud Pro subscription it fails fast with a clear, actionable message (including a pricing link), and low-value plans skipped by the server are reported explicitly.
