#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="full"
SKIP_INSTALL=false
RELEASE_VERSION=""
CURRENT_STEP="startup"
STARTED_AT=$SECONDS
TEMP_DIR=""

usage() {
	cat <<'EOF'
Usage: scripts/local-ci.sh [options]

Run Agendex CI and release-readiness checks locally without publishing anything.

Options:
  --quick              Run dependency, format, lint, and test checks only.
  --full               Also build the apps and dry-run CLI/UI release artifacts (default).
  --release VERSION    Validate desktop release metadata and, for stable versions,
                       confirm the download page already points at VERSION.
  --skip-install       Skip `bun install --frozen-lockfile`.
  -h, --help           Show this help.

Examples:
  bun run ci:local
  bun run ci:local:quick
  bun run ci:local -- --release 1.2.3
EOF
}

while (($# > 0)); do
	case "$1" in
	--quick)
		MODE="quick"
		;;
	--full)
		MODE="full"
		;;
	--release)
		if (($# < 2)); then
			echo "error: --release requires a version" >&2
			exit 2
		fi
		RELEASE_VERSION="$2"
		shift
		;;
	--skip-install)
		SKIP_INSTALL=true
		;;
	-h | --help)
		usage
		exit 0
		;;
	--)
		;;
	*)
		echo "error: unknown option '$1'" >&2
		usage >&2
		exit 2
		;;
	esac
	shift
done

cleanup() {
	if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
		rm -rf "$TEMP_DIR"
	fi
}

on_error() {
	local exit_code=$?
	echo >&2
	echo "FAILED: $CURRENT_STEP (exit $exit_code)" >&2
	echo "No package, tag, or release was published." >&2
	exit "$exit_code"
}

trap cleanup EXIT
trap on_error ERR

step() {
	CURRENT_STEP="$1"
	echo
	echo "==> $CURRENT_STEP"
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "error: '$1' is required" >&2
		exit 1
	fi
}

require_command bun
require_command node
require_command npm
require_command git

cd "$ROOT_DIR"

echo "Agendex local CI/CD validation"
echo "Mode: $MODE"
echo "Safety: validation only; publishing and git writes are not performed"

if [[ "$SKIP_INSTALL" == false ]]; then
	step "Install frozen dependencies"
	bun install --frozen-lockfile
fi

step "Check formatting and lint"
bun run check

step "Run the complete Bun test suite"
# `bun run ci:local` sets package-manager invocation variables for this wrapper.
# They describe the wrapper, not how the CLI fixture paths in upgrade tests were
# installed, so do not leak them into the test process.
env -u npm_config_user_agent -u npm_execpath bun test

if [[ -n "$RELEASE_VERSION" ]]; then
	step "Validate desktop release metadata for $RELEASE_VERSION"
	RELEASE_OUTPUT="$(node scripts/prepare-desktop-release.mjs "$RELEASE_VERSION")"
	printf '%s\n' "$RELEASE_OUTPUT"

	RELEASE_VERSION_NORMALIZED="$(printf '%s\n' "$RELEASE_OUTPUT" | sed -n 's/^version=//p')"
	IS_PRERELEASE="$(printf '%s\n' "$RELEASE_OUTPUT" | sed -n 's/^is_prerelease=//p')"
	if [[ -z "$RELEASE_VERSION_NORMALIZED" || -z "$IS_PRERELEASE" ]]; then
		echo "error: desktop release metadata did not contain expected fields" >&2
		exit 1
	fi

	if [[ "$IS_PRERELEASE" == false ]]; then
		step "Verify the stable download page points at v$RELEASE_VERSION_NORMALIZED"
		node --input-type=module - "$RELEASE_VERSION_NORMALIZED" <<'EOF'
import { readFileSync } from 'node:fs';
import { updateDownloadPageVersion } from './scripts/prepare-desktop-release.mjs';

const version = process.argv[2];
const path = './packages/web/src/client/components/DownloadPage.tsx';
const current = readFileSync(path, 'utf8');
const expected = updateDownloadPageVersion(current, version);
if (expected !== current) {
  console.error(`error: ${path} does not advertise desktop v${version}`);
  console.error(`Run: node scripts/prepare-desktop-release.mjs ${version} --write`);
  process.exit(1);
}
console.log(`Download page is ready for desktop v${version}.`);
EOF
	fi
fi

if [[ "$MODE" == "full" ]]; then
	step "Build the OSS app"
	bun run build

	step "Build the desktop app"
	bun run desktop:build

	step "Build the Node-compatible CLI release artifact"
	bun run build:cli:release

	step "Dry-run the CLI npm package"
	bun run pack:cli:dry-run

	step "Smoke-test the packed CLI"
	bun run smoke:cli:release

	step "Dry-run the desktop UI release bundle"
	TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agendex-local-ci.XXXXXX")"
	node scripts/build-ui-bundle.mjs --out "$TEMP_DIR/ui-release"
	test -s "$TEMP_DIR/ui-release/ui-manifest.json"
	test -n "$(find "$TEMP_DIR/ui-release" -maxdepth 1 -name 'agendex-ui-*.tar.gz' -print -quit)"
	echo "UI bundle manifest and archive were generated successfully."
fi

CURRENT_STEP="complete"
echo
echo "PASS: local $MODE CI/CD validation completed in $((SECONDS - STARTED_AT))s."
echo "No package, tag, or release was published."
