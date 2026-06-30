# Self-Hosting Agendex

This guide is for running the Agendex EE stack yourself with your own Convex deployment. If you only want local indexing and search on your own machine, use the free OSS flow from the root [README](../README.md) instead. OSS local usage does not require Convex, GitHub OAuth, or Stripe.

Self-hosting the EE stack is for the cloud features: authentication, CLI sync, sharing, comments, plan history, onboarding, and paid subscription flows.

## Prerequisites

- [Bun](https://bun.sh)
- A [Convex](https://convex.dev) account
- A GitHub OAuth app
- A place to host the EE web dashboard

## 1. Clone and install

```bash
git clone https://github.com/tyru5/agendex.git
cd agendex
bun install
```

## 2. Create a Convex project

From `packages/ee`:

```bash
npx convex dev
```

This provisions a Convex deployment and writes `packages/ee/.env.local` with values like:

```bash
CONVEX_DEPLOYMENT=dev:your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud
VITE_CONVEX_SITE_URL=https://your-deployment.convex.site
```

## 3. Create a GitHub OAuth app

1. Go to [GitHub Developer Settings](https://github.com/settings/developers) and create a new OAuth app.
2. Set **Homepage URL** to your dashboard URL, for example `https://agendex.yourdomain.com`.
3. Set **Authorization callback URL** to `https://your-deployment.convex.site/api/auth/callback/github`.
4. Copy the client ID and generate a client secret.

## 4. Configure Convex environment variables

In the [Convex dashboard](https://dashboard.convex.dev), configure these variables for the deployment used by `packages/ee/convex`.

### Backend and auth

| Variable               | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `SITE_URL`             | Public EE dashboard URL, for example `https://agendex.yourdomain.com` |
| `CONVEX_SITE_URL`      | Convex site URL from `.env.local`                                     |
| `GITHUB_CLIENT_ID`     | GitHub OAuth app client ID                                            |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret                                        |
| `BETTER_AUTH_SECRET`   | Generate with `openssl rand -base64 32`                               |

### Billing

| Variable                  | Value                                   |
| ------------------------- | --------------------------------------- |
| `STRIPE_SECRET_KEY`       | Stripe secret key for the EE deployment |
| `STRIPE_WEBHOOK_SECRET`   | Webhook secret for `/stripe/webhook`    |
| `STRIPE_MONTHLY_PRICE_ID` | Stripe price ID for monthly plans       |
| `STRIPE_YEARLY_PRICE_ID`  | Stripe price ID for yearly plans        |

Stripe is only required once you want checkout, customer portal, or paid subscription renewals. You can defer these while bringing up auth and the EE UI locally, but Cloud Pro usage beyond the built-in trial flow depends on subscription state being configured correctly.

## 5. Configure EE client environment variables

`npx convex dev` already writes `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` into `packages/ee/.env.local` for local development. For deployed EE builds, copy those same values into your hosting provider's environment settings and add `VITE_APP_URL` for the public site URL.

Example local or hosted client env:

```bash
VITE_CONVEX_URL=https://your-deployment.convex.cloud
VITE_CONVEX_SITE_URL=https://your-deployment.convex.site
VITE_APP_URL=https://agendex.yourdomain.com
```

`VITE_APP_URL` is optional but recommended so share links point at the correct public site.

## 6. Deploy the EE web dashboard

### Vercel

1. Import the repo into Vercel.
2. Set **Root Directory** to `packages/ee`.
3. Set **Build Command** to `bun run build`.
4. Set **Output Directory** to `dist`.
5. Add the `VITE_*` variables above.
6. Deploy.

### Other platforms

```bash
cd packages/ee
bun run build
```

Serve `dist/` as a static site.

## 7. Deploy Convex to production

From `packages/ee`:

```bash
npx convex deploy
```

## 8. Connect the CLI

The published CLI works with `npm`, `pnpm`, `yarn`, and `bun`, but for self-hosted instances you should always pass your site URL explicitly:

```bash
npx agendex-cli login --url https://agendex.yourdomain.com
pnpm dlx agendex-cli login --url https://agendex.yourdomain.com
bunx agendex-cli login --url https://agendex.yourdomain.com
```

This opens your self-hosted instance for OAuth and stores the returned token and Convex URL in `~/.agendex/config.json`.

Then configure adapters, sync, or start the daemon:

```bash
bunx agendex-cli configure
bunx agendex-cli sync
bunx agendex-cli start
bunx agendex-cli status
```

If you are working from this repo checkout instead of the published CLI, use the equivalent root scripts and still pass `--url`:

```bash
bun run cli:login -- --url https://agendex.yourdomain.com
bun run cli:configure
bun run cli:sync
bun run cli:start
bun run cli:status
```

The default published login target is `https://agendex.dev`, so keep passing `--url` for self-hosted deployments.

See [`packages/cli/README.md`](../packages/cli/README.md) for daemon polling intervals, plan-value filtering during sync, and retry behavior.

## Cleaning up existing low-value cloud plans

If your deployment already has low-value rows indexed before filtering improved, use the internal Convex cleanup functions in `packages/ee/convex/planCleanup.ts`. Set `PLAN_CLEANUP_ADMIN_TOKEN` on the deployment, run `auditLowValuePlans` (dry-run) via `npx convex run`, review the summary, then run `cleanupLowValuePlans` in batches. Details and examples are in [`packages/ee/convex/README.md`](../packages/ee/convex/README.md#maintainer-cleanup-existing-rows).

## Local EE development

To develop the EE stack locally from this repo, run all three processes:

```bash
# from packages/ee
npx convex dev

# from repo root
bun run dev

# from repo root
bun run dev:client:ee
```

Ports and routing:

- OSS API server: `http://localhost:4890`
- EE Vite client: `http://localhost:5174`
- EE client `/api` requests proxy to the OSS API on `:4890`

The OSS Vite client on `:5173` is for the free local app and is not the frontend used for EE development.

## Maintainer billing notes

- Stripe webhooks are registered at `/stripe/webhook`.
- Subscription state is synchronized through Convex HTTP handlers in `packages/ee/convex/http.ts` and mutations in `packages/ee/convex/subscriptions.ts`.
- Plan history is stored in the `planVersions` table and implemented in `packages/ee/convex/planVersions.ts`.
- Billing is only required for EE paid or cloud flows. It is not needed for free local OSS usage.
