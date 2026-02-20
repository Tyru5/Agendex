# Repository Guidelines

## Project Structure & Module Organization

`Agendex` is a Bun workspaces monorepo:

- `packages/shared/`: shared domain layer (types, adapter catalog/registry, config, plan service, watcher, setup helpers).
- `packages/app/`: `@agendex/app` OSS local app (Hono server + React client).
- `packages/app/src/server/`: local API/auth/search wiring (`/api/v1`, WebSocket updates, static hosting).
- `packages/app/src/client/`: Vite React app (`components/`, `hooks/`, `lib/`, `main.tsx`, `App.tsx`).
- `packages/app/src/client/dist/`: OSS client build output served by the app server.
- `packages/ee/`: `@agendex/ee` cloud/pro UI and Convex integration (auth, subscriptions, sharing/comments).
- `packages/ee/convex/`: Convex schema/functions/http/auth/Stripe routes.
- `packages/cli/`: `@agendex/cli` commands (`start`, `login`, `logout`, `sync`, `status`) for daemon + cloud sync flows.

Keep code close to package boundaries: reusable logic in `packages/shared`, OSS local app concerns in `packages/app`, cloud/pro features in `packages/ee`, and CLI behavior in `packages/cli`.

## Build, Test, and Development Commands

- `bun install`: install dependencies.
- `bun run dev`: start OSS app server (`@agendex/app`) with hot reload on port `4890`.
- `bun run dev:client`: start Vite client on port `5173` (proxies `/api` to `4890`).
- `bun run build`: build OSS client bundle into `packages/app/src/client/dist`.
- `bun run build:cloud`: build EE client (`@agendex/ee`).
- `bun run --filter @agendex/app start`: run the production OSS app server.
- `bun run --filter @agendex/ee dev:client`: run EE Vite client directly when working in cloud/pro UI.
- `bun run cli:start|cli:login|cli:sync|cli:status`: run CLI workflows from repo root.
- `bun run format` / `bun run format:check`: format or validate formatting with Biome.
- `bun run lint` / `bun run lint:fix` / `bun run check` / `bun run check:fix`: lint and full Biome checks.

For OSS web development, run both `bun run dev` and `bun run dev:client`. When editing EE Convex functions, run `npx convex dev` from `packages/ee` (or with that directory as your working dir).

## Coding Style & Naming Conventions

- Language: TypeScript with strict compiler settings (`tsconfig.json`).
- Style in current codebase: 2-space indentation, semicolons, trailing commas, and explicit `.ts`/`.tsx` imports where required.
- React components: PascalCase files (for example, `PlanViewer.tsx`).
- Hooks: `useX` naming (for example, `usePlans.ts`).
- Server/shared modules: descriptive, mostly kebab-case filenames (`plan-service.ts`, `claude-code.ts`).

Biome is configured via root scripts; match existing file style in touched files.

## Testing Guidelines

There is no automated test suite configured yet. Until one is added:

- Validate changes by running relevant dev servers and exercising affected API/UI paths.
- For API edits, verify endpoints under `packages/app/src/server/routes/` (served at `/api/v1`) manually.
- For OSS UI edits, verify local filtering/search, plan viewing/editing, and live updates.
- For EE UI edits, verify auth, subscription/paywall flows, sharing, and comments where affected.
- For Convex/Stripe changes, validate behavior in local Convex dev plus webhook/auth paths.
- For CLI edits, exercise `bun run cli:login`, `bun run cli:sync`, and `bun run cli:status` against expected local/cloud behavior.

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


## Skills
A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.
### Available skills
- avoid-feature-creep: Prevent feature creep when building software, apps, and AI-powered products. Use this skill when planning features, reviewing scope, building MVPs, managing backlogs, or when a user says "just one more feature." Helps developers and AI agents stay focused, ship faster, and avoid bloated products. (file: /Users/tiru5/.agents/skills/avoid-feature-creep/SKILL.md)
- baseline-ui: Enforces an opinionated UI baseline to prevent AI-generated interface slop. (file: /Users/tiru5/.agents/skills/baseline-ui/SKILL.md)
- better-auth-best-practices: Skill for integrating Better Auth - the comprehensive TypeScript authentication framework. (file: /Users/tiru5/.agents/skills/better-auth-best-practices/SKILL.md)
- create-auth-skill: Skill for creating auth layers in TypeScript/JavaScript apps using Better Auth. (file: /Users/tiru5/.agents/skills/create-auth-skill/SKILL.md)
- develop-web-game: Use when Codex is building or iterating on a web game (HTML/JS) and needs a reliable development + testing loop: implement small changes, run a Playwright-based test script with short input bursts and intentional pauses, inspect screenshots/text, and review console errors with render_game_to_text. (file: /Users/tiru5/.codex/skills/develop-web-game/SKILL.md)
- find-skills: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. (file: /Users/tiru5/.agents/skills/find-skills/SKILL.md)
- fixing-accessibility: Fix accessibility issues. (file: /Users/tiru5/.agents/skills/fixing-accessibility/SKILL.md)
- fixing-metadata: Ship correct, complete metadata. (file: /Users/tiru5/.agents/skills/fixing-metadata/SKILL.md)
- fixing-motion-performance: Fix animation performance issues. (file: /Users/tiru5/.agents/skills/fixing-motion-performance/SKILL.md)
- frontend-design: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics. (file: /Users/tiru5/.agents/skills/frontend-design/SKILL.md)
- next-best-practices: Next.js best practices - file conventions, RSC boundaries, data patterns, async APIs, metadata, error handling, route handlers, image/font optimization, bundling (file: /Users/tiru5/.agents/skills/next-best-practices/SKILL.md)
- pricing-strategy: When the user wants help with pricing decisions, packaging, or monetization strategy. Also use when the user mentions 'pricing,' 'pricing tiers,' 'freemium,' 'free trial,' 'packaging,' 'price increase,' 'value metric,' 'Van Westendorp,' 'willingness to pay,' or 'monetization.' This skill covers pricing research, tier structure, and packaging strategy. (file: /Users/tiru5/.agents/skills/pricing-strategy/SKILL.md)
- react-doctor: Diagnose and fix React codebase health issues. Use when reviewing React code, fixing performance problems, auditing security, or improving code quality. (file: /Users/tiru5/.agents/skills/react-doctor/SKILL.md)
- remotion-best-practices: Best practices for Remotion - Video creation in React (file: /Users/tiru5/.agents/skills/remotion-best-practices/SKILL.md)
- seo-audit: When the user wants to audit, review, or diagnose SEO issues on their site. Also use when the user mentions "SEO audit," "technical SEO," "why am I not ranking," "SEO issues," "on-page SEO," "meta tags review," or "SEO health check." For building pages at scale to target keywords, see programmatic-seo. For adding structured data, see schema-markup. (file: /Users/tiru5/.agents/skills/seo-audit/SKILL.md)
- vercel-react-best-practices: React and Next.js performance optimization guidelines from Vercel Engineering. This skill should be used when writing, reviewing, or refactoring React/Next.js code to ensure optimal performance patterns. Triggers on tasks involving React components, Next.js pages, data fetching, bundle optimization, or performance improvements. (file: /Users/tiru5/.agents/skills/vercel-react-best-practices/SKILL.md)
- web-design-guidelines: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices". (file: /Users/tiru5/.agents/skills/web-design-guidelines/SKILL.md)
- skill-creator: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations. (file: /Users/tiru5/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos). (file: /Users/tiru5/.codex/skills/.system/skill-installer/SKILL.md)
### How to use skills
- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.
  2) When `SKILL.md` references relative paths (e.g., `scripts/foo.py`), resolve them relative to the skill directory listed above first, and only consider other paths if needed.
  3) If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; don't bulk-load everything.
  4) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.
  5) If `assets/` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.
