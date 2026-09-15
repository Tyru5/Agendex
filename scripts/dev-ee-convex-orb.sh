#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/packages/ee"

: "${AGENDEX_EE_PUBLIC_URL:?Configure AGENDEX_EE_PUBLIC_URL in Amp project environment variables}"

node24="$(npx -y -p node@24 -c 'command -v node')"
export PATH="$(dirname "$node24"):$PATH"
convex_cli="$repo_root/node_modules/convex/bin/main.js"
export CONVEX_AGENT_MODE=anonymous

"$node24" "$convex_cli" dev &
convex_pid=$!
cleanup() {
  trap - EXIT INT TERM
  kill "$convex_pid" 2>/dev/null || true
  wait "$convex_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM

for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:3210 >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$convex_pid" 2>/dev/null; then
    wait "$convex_pid"
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:3210 >/dev/null

runtime_dir="${XDG_RUNTIME_DIR:-/tmp}/agendex-ee"
secret_file="$runtime_dir/better-auth-secret"
mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"
if [[ -n "${BETTER_AUTH_SECRET:-}" ]]; then
  auth_secret="$BETTER_AUTH_SECRET"
elif [[ -f "$secret_file" ]]; then
  auth_secret="$(cat "$secret_file")"
else
  auth_secret="$(openssl rand -base64 32)"
  umask 077
  printf '%s' "$auth_secret" >"$secret_file"
fi

set_convex_env() {
  "$node24" "$convex_cli" env set "$1" "$2" >/dev/null
}

set_convex_env BETTER_AUTH_SECRET "$auth_secret"
set_convex_env SITE_URL "$AGENDEX_EE_PUBLIC_URL"
set_convex_env APP_URL "$AGENDEX_EE_PUBLIC_URL"
set_convex_env BETTER_AUTH_BASE_URL "$AGENDEX_EE_PUBLIC_URL"
set_convex_env BETTER_AUTH_ENVIRONMENT production
set_convex_env BETTER_AUTH_TRUSTED_ORIGINS "$AGENDEX_EE_PUBLIC_URL"

if [[ -n "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  set_convex_env GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"
  set_convex_env GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"
elif [[ -n "${GOOGLE_CLIENT_ID:-}${GOOGLE_CLIENT_SECRET:-}" ]]; then
  echo "Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required" >&2
  exit 1
else
  echo "Google OAuth credentials are not configured; cloud UI will run without sign-in"
fi

wait "$convex_pid"
