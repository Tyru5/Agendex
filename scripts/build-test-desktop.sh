#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/packages/desktop"

if [ ! -f "$DESKTOP_DIR/package.json" ]; then
  echo "Desktop app not found at $DESKTOP_DIR"
  exit 1
fi

# Force unsigned builds for local smoke packaging.
export CSC_IDENTITY_AUTO_DISCOVERY=false
unset CSC_LINK CSC_KEY_PASSWORD
unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_TEAM_ID

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required for this script."
  exit 1
fi

echo "==> Building desktop (bun)"
(cd "$ROOT_DIR" && bun run desktop:build)

echo "==> Packaging unsigned macOS app (electron-builder)"
(cd "$DESKTOP_DIR" && bun run dist -- --mac --universal)

echo "==> Artifacts are in $DESKTOP_DIR/release"
