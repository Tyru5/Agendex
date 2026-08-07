#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/packages/desktop"
RELEASE_DIR="$DESKTOP_DIR/release"
PLATFORM="$(uname -s)"

if [[ ! -f "$DESKTOP_DIR/package.json" ]]; then
	echo "Desktop app not found at $DESKTOP_DIR" >&2
	exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
	echo "bun is required for this script." >&2
	exit 1
fi

# Force unsigned builds for local smoke packaging.
export CSC_IDENTITY_AUTO_DISCOVERY=false
unset CSC_LINK CSC_KEY_PASSWORD
unset WIN_CSC_LINK WIN_CSC_KEY_PASSWORD
unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_TEAM_ID

run_electron_builder_with_nsis_retry() {
	local attempt=1
	local max_attempts=3
	local log_file
	local status

	while ((attempt <= max_attempts)); do
		log_file="$(mktemp "${TMPDIR:-/tmp}/agendex-electron-builder.XXXXXX.log")"
		set +e
		bun run --cwd "$DESKTOP_DIR" dist -- "$@" 2>&1 | tee "$log_file"
		status="${PIPESTATUS[0]}"
		set -e

		if ((status == 0)); then
			rm -f "$log_file"
			return 0
		fi
		if ! grep -q '3221225794' "$log_file"; then
			rm -f "$log_file"
			return "$status"
		fi

		rm -f "$log_file"
		if ((attempt == max_attempts)); then
			echo "error: makensis failed with Windows loader error 0xc0000142 after $max_attempts attempts" >&2
			return "$status"
		fi

		echo "warning: makensis hit transient Windows loader error 0xc0000142; retrying ($attempt/$max_attempts)" >&2
		sleep "$attempt"
		((attempt += 1))
	done
}

echo "==> Building desktop (bun)"
bun run --cwd "$ROOT_DIR" desktop:build

case "$PLATFORM" in
Darwin)
	echo "==> Packaging unsigned macOS app (electron-builder)"
	rm -rf "$RELEASE_DIR"
	bun run --cwd "$DESKTOP_DIR" dist -- --mac --universal

	shopt -s nullglob
	disk_images=("$RELEASE_DIR"/*.dmg)
	archives=("$RELEASE_DIR"/*.zip)
	if ((${#disk_images[@]} < 1 || ${#archives[@]} < 1)); then
		echo "error: expected macOS DMG and ZIP artifacts in $RELEASE_DIR" >&2
		exit 1
	fi
	;;
MINGW* | MSYS* | CYGWIN*)
	echo "==> Packaging unsigned Windows app (electron-builder)"
	rm -rf "$RELEASE_DIR"
	bun run --cwd "$DESKTOP_DIR" dist -- --dir --win --x64
	# Compile each artifact from the packaged app in a fresh process. On Windows,
	# launching makensis after Electron packaging can fail with 0xc0000142.
	echo "==> Building unsigned Windows installer"
	run_electron_builder_with_nsis_retry --prepackaged release/win-unpacked --win nsis --x64
	echo "==> Building unsigned Windows portable"
	run_electron_builder_with_nsis_retry --prepackaged release/win-unpacked --win portable --x64

	shopt -s nullglob
	setups=("$RELEASE_DIR"/Agendex-*-x64-Setup.exe)
	portables=("$RELEASE_DIR"/Agendex-*-x64-Portable.exe)
	if ((${#setups[@]} != 1)); then
		echo "error: expected one Windows setup executable, found ${#setups[@]}" >&2
		exit 1
	fi
	if ((${#portables[@]} != 1)); then
		echo "error: expected one Windows portable executable, found ${#portables[@]}" >&2
		exit 1
	fi

	PACKAGED_APP="$RELEASE_DIR/win-unpacked/Agendex.exe"
	if [[ ! -f "$PACKAGED_APP" ]]; then
		echo "error: packaged Windows app not found at $PACKAGED_APP" >&2
		exit 1
	fi
	echo "==> Smoke-testing packaged Windows daemon lifecycle"
	bun "$DESKTOP_DIR/scripts/smoke-daemon-worker.mjs" --app "$PACKAGED_APP"
	;;
Linux)
	echo "==> Native desktop packaging skipped on Linux (macOS/Windows runners required)"
	;;
*)
	echo "error: unsupported host platform for desktop packaging: $PLATFORM" >&2
	exit 1
	;;
esac

echo "==> Desktop build validation completed for $PLATFORM"
if [[ -d "$RELEASE_DIR" && "$PLATFORM" != Linux ]]; then
	echo "==> Artifacts are in $RELEASE_DIR"
fi
