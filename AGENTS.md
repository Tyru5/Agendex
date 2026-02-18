# Repository Guidelines

## Project Structure & Module Organization

`Agendex` is a Bun workspaces monorepo:

- `packages/shared/`: shared domain layer (types, adapter catalog/registry, config, plan service, watcher, setup helpers).
- `packages/cli/`: `@agendex/cli` commands (`start`, `login`, `logout`, `sync`, `status`) for daemon + cloud sync flows.
- `packages/web/`: Hono server + React client + Convex backend.
- `packages/web/src/server/`: API/auth/search wiring.
- `packages/web/src/client/`: Vite React app (`components/`, `hooks/`, `lib/`, `main.tsx`, `App.tsx`).
- `packages/web/convex/`: Convex functions/schema/auth/HTTP routes.
- `packages/web/src/client/dist/`: client build output served by the web server.

Keep code close to its package boundary: reusable logic in `packages/shared`, local web concerns in `packages/web`, and CLI-only behavior in `packages/cli`.

## Build, Test, and Development Commands

- `bun install`: install dependencies.
- `bun run dev`: start web server (`@agendex/web`) with hot reload on port `4890`.
- `bun run dev:client`: start Vite client on port `5173` (proxies `/api` to `4890`).
- `bun run build`: build web client bundle into `packages/web/src/client/dist`.
- `bun run --filter @agendex/web start`: run the production web server.
- `bun run cli:start|cli:login|cli:sync|cli:status`: run CLI workflows from repo root.
- `bun run format` / `bun run format:check`: format or validate formatting with Prettier.

For web development, run both `bun run dev` and `bun run dev:client`. When editing Convex functions, also run `npx convex dev`.

## Coding Style & Naming Conventions

- Language: TypeScript with strict compiler settings (`tsconfig.json`).
- Style in current codebase: 2-space indentation, semicolons, trailing commas, and explicit `.ts`/`.tsx` imports where required.
- React components: PascalCase files (for example, `PlanViewer.tsx`).
- Hooks: `useX` naming (for example, `usePlans.ts`).
- Server/shared modules: descriptive, mostly kebab-case filenames (`plan-service.ts`, `claude-code.ts`).

Prettier is configured via root scripts; match existing file style in touched files.

## Testing Guidelines

There is no automated test suite configured yet. Until one is added:

- Validate changes by running relevant dev servers and exercising affected API/UI paths.
- For API edits, verify endpoints under `/api/v1` manually.
- For UI edits, verify auth, filtering/search, plan viewing/editing, and sharing/comments where affected.
- For Convex/Stripe changes, validate expected behavior in local Convex dev and webhook/auth paths.

When adding tests, place them near the feature (`*.test.ts`/`*.test.tsx`) and keep them focused.

## Commit & Pull Request Guidelines

The project now has active feature branches and merged PRs. Keep contributions disciplined:

- Commit messages: imperative, concise subject line (for example, `Add cursor adapter workspace metadata`).
- Keep commits scoped to one logical change.
- PRs should include: what changed, why, manual verification steps, and screenshots for UI changes.
- Link related issues/tasks, and call out follow-up work and environment changes (`CONVEX_DEPLOYMENT`, Stripe keys, etc.) explicitly.

## Security & Configuration Tips

- Local auth and cloud settings are stored in `~/.agendex/config.json` (`token`, `cloudToken`, `convexUrl`, `enabledAdapters`).
- Never commit tokens, local session data, or machine-specific paths.
- Keep secrets in local environment files (`.env*` is gitignored).
