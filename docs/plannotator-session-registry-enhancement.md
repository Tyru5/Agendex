# Plannotator session registry enhancement for Agendex Pro write-back

Agendex Pro write-back relies on discovering a live local Plannotator server and then calling the existing Plannotator local HTTP API (`/api/deny` for plan sessions, `/api/feedback` for review/annotate sessions). The Claude/Codex/Copilot CLI hook already writes live session files under `~/.plannotator/sessions` through Plannotator's `packages/server/sessions.ts` helper.

For robust Pi and OpenCode support, Agendex should coordinate an upstream Plannotator enhancement so those hosts write equivalent live session records whenever they start a Plannotator browser session.

## Proposed session file shape

```json
{
  "pid": 12345,
  "port": 19432,
  "url": "http://127.0.0.1:19432",
  "mode": "plan",
  "project": "my-project",
  "startedAt": "2026-01-02T14:30:00.000Z",
  "label": "plan-my-project",
  "origin": "pi",
  "reviewId": "optional-review-id",
  "sourcePlanPath": "/absolute/path/to/plan.md"
}
```

Required fields for Agendex:

- `pid` — used to skip stale sessions.
- `url` — must be a loopback `http://localhost`, `http://127.0.0.1`, or `http://[::1]` URL.
- `mode` — `plan`, `review`, or `annotate`.
- `origin` — original agent host (`pi`, `opencode`, `claude-code`, `codex`, etc.).

Recommended fields:

- `port`, `project`, `label`, `startedAt` for UI display.
- `reviewId` for Pi's async review-status API.
- `sourcePlanPath` so Agendex can display the actual source plan path while keeping the session file as the stable local id.

## Suggested upstream touchpoints

- OpenCode: register/unregister a session around the `startPlannotatorServer(...)` call in `apps/opencode-plugin/index.ts`.
- Pi: register/unregister a session around `startPlanReviewServer(...)` in `apps/pi-extension/plannotator-browser.ts` / `apps/pi-extension/server/serverPlan.ts`.
- Reuse the same semantics as `packages/server/sessions.ts`: write one JSON file per server process and remove it on shutdown where possible; stale entries can be cleaned by PID checks.

## Why this matters

Without this registry, Agendex can still sync saved Plannotator snapshots and project-local `@plans/` files, but it cannot reliably know which live Pi/OpenCode Plannotator server should receive a Cloud-originated `Request changes` action. The registry gives Agendex a stable, SSRF-safe local discovery surface while keeping all actual agent write-back behavior inside Plannotator's existing APIs.
