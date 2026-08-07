#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="full"
SKIP_INSTALL=false
RUN_ACT=true
IS_ACT_CHILD=false
RELEASE_VERSION=""
CURRENT_STEP="startup"
STARTED_AT=$SECONDS
TEMP_DIR=""
ACT_WORKSPACE=""

usage() {
	cat <<'EOF'
Usage: scripts/local-ci.sh [options]

Run Agendex CI and release-readiness checks locally without publishing anything.

Options:
  --quick              Run dependency, format, lint, and test checks only.
  --full               Also build the apps and dry-run CLI/UI release artifacts (default).
  --release VERSION    Validate desktop release metadata and, for stable versions,
                       confirm the download page already points at VERSION.
  --skip-install       Skip `bun install --frozen-lockfile` on the host.
  --skip-act           Skip the isolated act workflow (used by the act child run).
  -h, --help           Show this help.

Examples:
  bun run ci:local
  bun run ci:local:quick
  bun run ci:local -- --release 1.2.3
  bun run ci:local -- --skip-act
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
	--skip-act)
		RUN_ACT=false
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
	if [[ -n "$ACT_WORKSPACE" && -d "$ACT_WORKSPACE" ]]; then
		rm -rf "$ACT_WORKSPACE"
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

if [[ "${AGENDEX_ACT_CHILD:-0}" == 1 ]]; then
	RUN_ACT=false
	IS_ACT_CHILD=true
fi

if [[ "$RUN_ACT" == true ]]; then
	require_command act
	require_command docker
	if ! docker info >/dev/null 2>&1; then
		echo "error: Docker must be running to execute the local act workflow" >&2
		exit 1
	fi
fi

cd "$ROOT_DIR"

echo "Agendex local CI/CD validation"
echo "Mode: $MODE"
echo "Safety: validation only; publishing and git writes are not performed"

if [[ "$SKIP_INSTALL" == false ]]; then
	step "Install frozen dependencies"
	bun install --frozen-lockfile
fi

if [[ "$IS_ACT_CHILD" == false ]]; then
	BASE_REF="${AGENDEX_CI_BASE_REF:-origin/main}"
	if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
		echo "error: cannot verify changeset coverage because '$BASE_REF' does not exist" >&2
		echo "Fetch the base branch or set AGENDEX_CI_BASE_REF to a valid ref." >&2
		exit 1
	fi

	CURRENT_BRANCH="$(git branch --show-current)"
	CHANGED_PATHS="$({
		git diff --name-only "$BASE_REF...HEAD"
		git diff --name-only
		git diff --cached --name-only
		git ls-files --others --exclude-standard
	} | sort -u)"
	if [[ "$CURRENT_BRANCH" != changeset-release/* ]] &&
		printf '%s\n' "$CHANGED_PATHS" | grep -qE '^packages/(cli|shared)/'; then
		step "Require a changeset for CLI-relevant changes"
		bunx changeset status --since="$BASE_REF"
	fi
fi

step "Check formatting and lint"
bun run check

step "Run the complete Bun test suite"
# `bun run ci:local` sets package-manager invocation variables for this wrapper.
# They describe the wrapper, not how the CLI fixture paths in upgrade tests were
# installed, so do not leak them into the test process. CI must also remain
# non-interactive when launched from a TTY; otherwise adapter-selection tests can
# open the prompt and time out waiting for input.
env -u npm_config_user_agent -u npm_execpath bun test </dev/null

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
	step "Check CLI release surfaces"
	bun run check:cli:release

	step "Build the OSS app"
	bun run build

	step "Build and package the desktop app for this host"
	bun run build-test:desktop

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

if [[ "$RUN_ACT" == true ]]; then
	step "Snapshot the current worktree for act"
	ACT_WORKSPACE="$(mktemp -d "${TMPDIR:-/tmp}/agendex-act-workspace.XXXXXX")"
	while IFS= read -r -d '' path; do
		if [[ ! -e "$path" && ! -L "$path" ]]; then
			continue
		fi
		mkdir -p "$(dirname "$ACT_WORKSPACE/$path")"
		cp -pP -- "$path" "$ACT_WORKSPACE/$path"
	done < <(git ls-files --cached --others --exclude-standard -z)

	# Give tools inside the container normal Git metadata without exposing the
	# host repository or ignored local files such as credentials and build output.
	git -C "$ACT_WORKSPACE" init --quiet
	git -C "$ACT_WORKSPACE" add --all
	git -C "$ACT_WORKSPACE" \
		-c user.name='Agendex Local CI' \
		-c user.email='local-ci@agendex.invalid' \
		-c commit.gpgsign=false \
		-c core.hooksPath=/dev/null \
		commit --quiet --message='Local act worktree snapshot'

	case "$(uname -m)" in
	arm64 | aarch64) ACT_CONTAINER_ARCH='linux/arm64' ;;
	*) ACT_CONTAINER_ARCH='linux/amd64' ;;
	esac
	ACT_RUNNER_IMAGE='node:22-bookworm@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a'

	step "Run the safe local CI/CD workflow with act"
	ACT_ARGS=(
		workflow_dispatch
		--directory "$ACT_WORKSPACE"
		--workflows "$ACT_WORKSPACE/.act/workflows/local-ci.yml"
		--job local-ci
		--bind
		--container-architecture "$ACT_CONTAINER_ARCH"
		--platform "ubuntu-latest=$ACT_RUNNER_IMAGE"
		--input "mode=$MODE"
	)
	if [[ -n "$RELEASE_VERSION" ]]; then
		ACT_ARGS+=(--input "release_version=$RELEASE_VERSION")
	fi
	act "${ACT_ARGS[@]}"
fi

CURRENT_STEP="complete"
echo
echo "PASS: local $MODE CI/CD validation completed in $((SECONDS - STARTED_AT))s."
echo "No package, tag, or release was published."
