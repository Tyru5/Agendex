---
'agendex-cli': minor
---

Add plan receipts: plans with trackable file mentions in a readable git repository get a planned, in-progress, landed, or stalled status from git evidence, with changed, untouched, and unplanned files. Other plans return an unavailable receipt. Expand Receipt in the plan viewer to inspect the evidence; active status tags also appear on plan rows, and the EE activity brief includes landings when local receipts are available. The local API serves receipts at `GET /api/v1/plans/:id/receipt` and `GET /api/v1/receipts`.
