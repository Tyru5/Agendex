---
'agendex-cli': minor
---

Add plan receipts: every plan in a git repository gets a planned, in-progress, landed, or stalled status from the commits that followed it, with changed, untouched, and unplanned files. Receipts show in the plan viewer, on plan rows, and in the activity brief, and the local API serves them at `GET /api/v1/plans/:id/receipt` and `GET /api/v1/receipts`.
