# Self-Hosting Agendex

Run your own Agendex instance with your own Convex backend.

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Convex](https://convex.dev) account (free tier works)
- GitHub OAuth app (for authentication)
- Hosting platform for the web dashboard (Vercel, etc.)

## 1. Clone and install

```bash
git clone https://github.com/tyru5/agendex.git
cd agendex
bun install
```

## 2. Create a Convex project

```bash
npx convex dev
```

This provisions a Convex deployment and creates `.env.local` with:

```
CONVEX_DEPLOYMENT=dev:your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud
VITE_CONVEX_SITE_URL=https://your-deployment.convex.site
```

## 3. Create a GitHub OAuth app

1. Go to [GitHub Developer Settings](https://github.com/settings/developers) > OAuth Apps > New OAuth App
2. Set **Homepage URL** to your web dashboard URL (e.g. `https://agendex.yourdomain.com`)
3. Set **Authorization callback URL** to `https://your-deployment.convex.site/api/auth/callback/github`
4. Copy the Client ID and generate a Client Secret

## 4. Configure Convex environment variables

In the [Convex dashboard](https://dashboard.convex.dev), set these env vars for your deployment:

| Variable               | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| `SITE_URL`             | Your web dashboard URL (e.g. `https://agendex.yourdomain.com`) |
| `CONVEX_SITE_URL`      | Your Convex site URL (from `.env.local`)                       |
| `GITHUB_CLIENT_ID`     | From GitHub OAuth app                                          |
| `GITHUB_CLIENT_SECRET` | From GitHub OAuth app                                          |
| `BETTER_AUTH_SECRET`   | Generate with `openssl rand -base64 32`                        |

## 5. Add client env vars

Add to `.env.local` (or your hosting platform's env config):

```
VITE_APP_URL=https://agendex.yourdomain.com
```

`VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` should already be set from step 2.

## 6. Deploy the web dashboard

### Vercel

1. Import the repo in Vercel
2. Set **Root Directory** to `packages/web`
3. Set **Build Command** to `bun run build`
4. Set **Output Directory** to `src/client/dist`
5. Add the `VITE_*` env vars from above
6. Deploy

### Other platforms

```bash
cd packages/web
bun run build
# serve src/client/dist as static files
```

## 7. Deploy Convex to production

```bash
npx convex deploy
```

## 8. Connect the CLI

```bash
bunx @agendex/cli login --url https://agendex.yourdomain.com
```

This opens your self-hosted instance for OAuth, stores the token and Convex URL in `~/.agendex/config.json`.

Then sync or start the daemon:

```bash
bunx @agendex/cli sync    # one-shot
bunx @agendex/cli start   # persistent daemon
```

## Local development

Run all three simultaneously:

```bash
npx convex dev             # Convex backend (watches convex/ for changes)
bun run dev                # Hono server on :4890
bun run dev:client         # Vite on :5173 (proxies /api -> :4890)
```
