# Agendex

Agendex is a Bun-workspaces monorepo that indexes and explores coding-agent plans/sessions. See the root [`README.md`](./README.md) for the product overview, full command list, configuration, and the EE/cloud development flow, and [`docs/self-hosting.md`](./docs/self-hosting.md) for the EE stack.

## Cursor Cloud specific instructions

Scope note: the default development scope is the **OSS local app** (`packages/app`), which needs no external secrets. The **EE/cloud stack** (`packages/ee`) additionally requires an interactive Convex login (`npx convex dev`), a GitHub OAuth app, and Stripe secrets, so it cannot be brought up in this environment without user-provided credentials.

- **Runtime/package manager is Bun.** All scripts run through `bun` (e.g. `bun run dev`, `bun test`). Bun is installed at `~/.bun/bin/bun` and is on `PATH`; the update script runs `bun install`.
- **Standard commands** are in `README.md` / root `package.json`: `bun run dev` (OSS API on :4890), `bun run dev:client:oss` (OSS client on :5173), `bun run build`, `bun run lint`, `bun run fmt:check`. There is no root test script — run tests with `bun test` (Bun's built-in runner discovers the `*.test.ts` files).
- **Lint emits warnings, not errors.** `bun run lint` (oxlint) currently reports ~80 warnings and 0 errors; a clean run still exits 0.
- **First server startup prompts for adapters in a TTY.** `bun run dev` shows an interactive adapter picker on first run when attached to a TTY (e.g. tmux); press Enter to accept defaults. The selection is saved to `~/.agendex/config.json`, so subsequent startups (and non-interactive runs, which auto-enable defaults) do not prompt. That config dir persists in the VM snapshot.
- **Auth token.** The OSS server prints/saves a local auth token to `~/.agendex/config.json` on startup; paste it into the web login modal. Override with `AGENDEX_TOKEN`. Server routes live under `/api/v1` and require `Authorization: Bearer <token>`.
- **A fresh VM has no agent plans to index** (it scans local agent dirs like `~/.claude`, etc.). To get plans for testing, add a custom plan source: `POST /api/v1/plan-sources` with `{"path":"/abs/dir"}` (or `bun run cli -- add-dir <dir>`), drop a `.md` plan in that dir, and it is indexed immediately.
