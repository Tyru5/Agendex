# Agendex

Agendex is a Bun-workspaces monorepo that indexes and explores coding-agent plans/sessions. See the root [`README.md`](./README.md) for the product overview, full command list, configuration, and the EE/cloud development flow, and [`docs/self-hosting.md`](./docs/self-hosting.md) for the EE stack.

## Cursor Cloud specific instructions

Scope note: the default development scope is the **OSS local app** (`packages/app`), which needs no external secrets. The **EE/cloud stack** (`packages/ee`) can also be run locally without a Convex account using Convex anonymous agent mode (see "Running the EE/cloud flow" below); only completing an actual login requires user-provided GitHub/Google OAuth credentials, and Stripe is only needed for billing.

- **Runtime/package manager is Bun.** All scripts run through `bun` (e.g. `bun run dev`, `bun test`). Bun is installed at `~/.bun/bin/bun` and is on `PATH`; the update script runs `bun install`.
- **Standard commands** are in `README.md` / root `package.json`: `bun run dev` (OSS API on :4890), `bun run dev:client:oss` (OSS client on :5173), `bun run build`, `bun run lint`, `bun run fmt:check`. There is no root test script — run tests with `bun test` (Bun's built-in runner discovers the `*.test.ts` files).
- **Lint emits warnings, not errors.** `bun run lint` (oxlint) currently reports ~80 warnings and 0 errors; a clean run still exits 0.
- **First server startup prompts for adapters in a TTY.** `bun run dev` shows an interactive adapter picker on first run when attached to a TTY (e.g. tmux); press Enter to accept defaults. The selection is saved to `~/.agendex/config.json`, so subsequent startups (and non-interactive runs, which auto-enable defaults) do not prompt. That config dir persists in the VM snapshot.
- **Auth token.** The OSS server prints/saves a local auth token to `~/.agendex/config.json` on startup; paste it into the web login modal. Override with `AGENDEX_TOKEN`. Server routes live under `/api/v1` and require `Authorization: Bearer <token>`.
- **A fresh VM has no agent plans to index** (it scans local agent dirs like `~/.claude`, etc.). To get plans for testing, add a custom plan source: `POST /api/v1/plan-sources` with `{"path":"/abs/dir"}` (or `bun run cli -- add-dir <dir>`), drop a `.md` plan in that dir, and it is indexed immediately.

### Running the EE/cloud flow

The EE stack runs three processes (README "EE / Cloud Development" lists them, but assumes a logged-in Convex account — use anonymous agent mode instead here):

1. **Convex backend** — from `packages/ee`: `CONVEX_AGENT_MODE=anonymous npx convex dev` (matches the `npx convex` convention in `README.md` / `docs/self-hosting.md`). Anonymous agent mode spins up an isolated **local** Convex backend with no account/login (the workspace Convex rules cover this). It writes `packages/ee/.env.local` with `VITE_CONVEX_URL=http://127.0.0.1:3210` and `VITE_CONVEX_SITE_URL=http://127.0.0.1:3211` (`.env.local` is gitignored). Keep this process running; it serves the API (:3210) and HTTP/site routes (:3211, including auth).
2. **OSS API** — from repo root: `bun run dev` (:4890). The EE client proxies `/api` to it.
3. **EE client** — from repo root: `bun run dev:client:ee`. Vite binds to host **`agendex.localhost:5174`** (not plain `localhost`); `*.localhost` resolves to loopback so a browser can reach `http://agendex.localhost:5174/`.

Convex **deployment** env vars (set with `CONVEX_AGENT_MODE=anonymous npx convex env set <NAME> <VALUE>` from `packages/ee`, not in `.env.local`):

- `BETTER_AUTH_SECRET` — required for auth; generate with `openssl rand -base64 32`.
- `SITE_URL` and `APP_URL` — set both to `http://agendex.localhost:5174` for local dev.
- Do **not** set `CONVEX_SITE_URL` — it is a built-in Convex variable (auto `http://127.0.0.1:3211`) and the CLI rejects overriding it.

Login is **GitHub/Google OAuth only** (no email/password). To actually sign in, create an OAuth app, set its callback to `http://127.0.0.1:3211/api/auth/callback/github` (or `.../google`), and set `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (or the Google pair) as Convex deployment env vars. Without these, the stack still runs and the dashboard/landing/sign-in pages render and connect to Convex, but the OAuth login itself cannot complete. Stripe vars (`STRIPE_*`) are only needed for billing/checkout flows.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:

- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
