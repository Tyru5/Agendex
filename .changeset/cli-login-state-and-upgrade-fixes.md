---
'agendex-cli': patch
---

`agendex login` now binds the browser callback to a random per-login `state` nonce and only accepts a trusted Convex site URL (`https://*.convex.site` or the local `http://127.0.0.1:3211`), so a forged local callback can no longer complete a login or point later syncs at another server. `agendex upgrade` on Windows runs the npm/pnpm/yarn `.cmd` shims through the shell instead of failing with `EINVAL` on current Node releases, and it installs the version it reports (`agendex-cli@<version>`) instead of `@latest`. `agendex login --url` and `agendex open --url` reject a missing value instead of treating the next flag (such as `--dev`) as the URL. When `agendex start` can't start the daemon, it now prints the reason.
