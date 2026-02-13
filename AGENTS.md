# Repository Guidelines

## Project Structure & Module Organization

`Agendex` is split between a Bun server and a React client:

- `src/server/`: Hono API, auth, plan indexing/search services, file watchers, and agent adapters.
- `src/server/adapters/`: one adapter per agent source (`claude-code.ts`, `cursor.ts`, etc.) plus `registry.ts`.
- `src/client/`: Vite + React UI (`components/`, `hooks/`, `lib/`, `main.tsx`, `App.tsx`).
- `src/client/dist/`: build output served by the server in production.

Keep new code close to its domain (API logic in `src/server`, UI logic in `src/client`).

## Build, Test, and Development Commands

- `bun install`: install dependencies.
- `bun run dev`: start server with hot reload on port `4890`.
- `bun run dev:client`: start Vite client on port `5173` (proxies `/api` to `4890`).
- `bun run build`: build client bundle into `src/client/dist`.
- `bun run start`: run production server serving the built client.

For local development, run both `bun run dev` and `bun run dev:client`.

## Coding Style & Naming Conventions

- Language: TypeScript with strict compiler settings (`tsconfig.json`).
- Style in current codebase: 2-space indentation, double quotes, semicolons, explicit `.ts`/`.tsx` imports.
- React components: PascalCase files (for example, `PlanViewer.tsx`).
- Hooks: `useX` naming (for example, `usePlans.ts`).
- Server/adapters: descriptive, mostly kebab-case filenames (`plan-service.ts`, `claude-code.ts`).

No ESLint/Prettier config is currently checked in, so match existing file style when editing.

## Testing Guidelines

There is no automated test suite configured yet. Until one is added:

- Validate changes by running both dev servers and exercising affected API/UI paths.
- For API edits, verify endpoints under `/api/v1` manually.
- For UI edits, confirm login flow, filtering/search, plan viewing, and markdown editing.

When adding tests, place them near the feature (`*.test.ts`/`*.test.tsx`) and keep them focused.

## Commit & Pull Request Guidelines

Git history is minimal (currently a single `initial commit`), so follow a clear baseline:

- Commit messages: imperative, concise subject line (for example, `Add cursor adapter workspace metadata`).
- Keep commits scoped to one logical change.
- PRs should include: what changed, why, manual verification steps, and screenshots for UI changes.
- Link related issues/tasks and call out follow-up work explicitly.

## Security & Configuration Tips

- Auth token is read from `AGENDEX_TOKEN` or generated in `~/.agendex/config.json`.
- Never commit tokens, local session data, or machine-specific paths.
- Keep secrets in local environment files (`.env*` is gitignored).
