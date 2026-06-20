#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${AGENDEX_INSTALL_PACKAGE:-agendex-cli}"
BIN_NAME="${AGENDEX_INSTALL_BIN:-agendex}"
VERSION="${AGENDEX_INSTALL_VERSION:-latest}"
PACKAGE_MANAGER="${AGENDEX_INSTALL_PM:-auto}"
SKIP_VERIFY=0
POSITIONAL_VERSION_SET=0

if [ -t 1 ]; then
	BOLD='\033[1m'
	GREEN='\033[32m'
	YELLOW='\033[33m'
	RED='\033[31m'
	RESET='\033[0m'
else
	BOLD=''
	GREEN=''
	YELLOW=''
	RED=''
	RESET=''
fi

usage() {
	cat <<'USAGE'
Usage: install.sh [options]
       curl -fsSL https://agendex.ai/install.sh | bash
       curl -fsSL https://agendex.ai/install.sh | bash -s -- --version 1.2.3

Options:
  --version <version>  Install a specific agendex-cli version. A leading "v"
                       is accepted (for example, v1.2.3 -> 1.2.3).
                       Defaults to latest.
  --pm <manager>       Package manager to use: npm, pnpm, yarn, bun, or auto.
                       Defaults to auto (npm first, then pnpm/yarn/bun).
  --skip-verify        Skip the post-install `agendex --version` check.
  --help               Show this help text.

Environment:
  AGENDEX_INSTALL_VERSION   Same as --version.
  AGENDEX_INSTALL_PM        Same as --pm.
  AGENDEX_INSTALL_PACKAGE   Override the npm package name (default: agendex-cli).
USAGE
}

info() {
	printf '%b\n' "${BOLD}[agendex]${RESET} $*"
}

success() {
	printf '%b\n' "${GREEN}[agendex]${RESET} $*"
}

warn() {
	printf '%b\n' "${YELLOW}[agendex] warning:${RESET} $*" >&2
}

fail() {
	printf '%b\n' "${RED}[agendex] error:${RESET} $*" >&2
	exit 1
}

normalize_version() {
	case "$1" in
	v[0-9]*) printf '%s\n' "${1#v}" ;;
	*) printf '%s\n' "$1" ;;
	esac
}

require_value() {
	local flag="$1"
	local value="${2:-}"
	if [ -z "$value" ]; then
		fail "$flag requires a value"
	fi
	case "$value" in
	-*) fail "$flag requires a value, got flag: $value" ;;
	esac
}

while [ $# -gt 0 ]; do
	case "$1" in
	--version)
		require_value "$1" "${2:-}"
		VERSION="$2"
		shift 2
		;;
	--version=*)
		VERSION="${1#--version=}"
		if [ -z "$VERSION" ]; then
			fail "--version requires a value"
		fi
		shift
		;;
	--pm)
		require_value "$1" "${2:-}"
		PACKAGE_MANAGER="$2"
		shift 2
		;;
	--pm=*)
		PACKAGE_MANAGER="${1#--pm=}"
		if [ -z "$PACKAGE_MANAGER" ]; then
			fail "--pm requires a value"
		fi
		shift
		;;
	--skip-verify)
		SKIP_VERIFY=1
		shift
		;;
	--help | -h)
		usage
		exit 0
		;;
	--)
		shift
		break
		;;
	-*)
		usage >&2
		fail "unknown option: $1"
		;;
	*)
		if [ "$POSITIONAL_VERSION_SET" = "1" ]; then
			usage >&2
			fail "unexpected argument: $1"
		fi
		VERSION="$1"
		POSITIONAL_VERSION_SET=1
		shift
		;;
	esac
done

case "$PACKAGE_MANAGER" in
auto | npm | pnpm | yarn | bun) ;;
*) fail "unsupported package manager: $PACKAGE_MANAGER (expected npm, pnpm, yarn, bun, or auto)" ;;
esac

command_exists() {
	command -v "$1" >/dev/null 2>&1
}

check_node() {
	if ! command_exists node; then
		fail "Node.js 20+ is required. Install Node.js from https://nodejs.org/ and rerun this installer."
	fi

	local major
	if ! major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null)"; then
		fail "could not determine your Node.js version; Agendex requires Node.js 20+."
	fi

	if [ "$major" -lt 20 ]; then
		local current
		current="$(node -v 2>/dev/null || printf 'unknown')"
		fail "Node.js 20+ is required; found $current. Upgrade Node.js and rerun this installer."
	fi
}

detect_package_manager() {
	if [ "$PACKAGE_MANAGER" != "auto" ]; then
		if ! command_exists "$PACKAGE_MANAGER"; then
			fail "$PACKAGE_MANAGER is not installed or not on PATH."
		fi
		printf '%s\n' "$PACKAGE_MANAGER"
		return
	fi

	for candidate in npm pnpm yarn bun; do
		if command_exists "$candidate"; then
			printf '%s\n' "$candidate"
			return
		fi
	done

	fail "no supported package manager found. Install npm, pnpm, yarn, or bun and rerun this installer."
}

parse_major() {
	printf '%s\n' "$1" | sed -E 's/^([0-9]+).*/\1/'
}

check_package_manager() {
	local pm="$1"
	if [ "$pm" = "yarn" ]; then
		local yarn_version yarn_major
		yarn_version="$(yarn --version 2>/dev/null || true)"
		yarn_major="$(parse_major "$yarn_version")"
		if [ -n "$yarn_major" ] && [ "$yarn_major" -ge 2 ]; then
			fail "Yarn $yarn_version does not support 'yarn global add'. Rerun with '--pm npm' or use npm install -g ${PACKAGE_NAME}."
		fi
	fi
}

install_package() {
	local pm="$1"
	local pkg_spec="$2"

	case "$pm" in
	npm)
		info "Installing ${pkg_spec} with npm..."
		npm install -g "$pkg_spec"
		;;
	pnpm)
		info "Installing ${pkg_spec} with pnpm..."
		pnpm add -g "$pkg_spec"
		;;
	yarn)
		info "Installing ${pkg_spec} with yarn..."
		yarn global add "$pkg_spec"
		;;
	bun)
		info "Installing ${pkg_spec} with bun..."
		bun install -g "$pkg_spec"
		;;
	esac
}

manager_bin_dir() {
	local pm="$1"
	case "$pm" in
	npm)
		local npm_prefix
		npm_prefix="$(npm prefix -g 2>/dev/null || true)"
		if [ -n "$npm_prefix" ]; then
			printf '%s/bin\n' "$npm_prefix"
		fi
		;;
	pnpm)
		pnpm bin -g 2>/dev/null || true
		;;
	yarn)
		yarn global bin 2>/dev/null || true
		;;
	bun)
		bun pm bin -g 2>/dev/null || printf '%s/.bun/bin\n' "$HOME"
		;;
	esac
}

resolve_agendex_bin() {
	local pm="$1"
	local bin_dir
	bin_dir="$(manager_bin_dir "$pm" | head -n 1)"
	if [ -n "$bin_dir" ] && [ -x "$bin_dir/$BIN_NAME" ]; then
		printf '%s\n' "$bin_dir/$BIN_NAME"
		return
	fi

	if command_exists "$BIN_NAME"; then
		command -v "$BIN_NAME"
	fi
}

print_next_steps() {
	cat <<'NEXT'

Next steps:
  agendex login       # authenticate with Agendex Cloud
  agendex configure   # select which agent plan sources to index
  agendex start       # start the background sync daemon

For a self-hosted Agendex instance, use:
  agendex login --url https://agendex.yourdomain.com
NEXT
}

check_node
PM="$(detect_package_manager)"
check_package_manager "$PM"
NORMALIZED_VERSION="$(normalize_version "$VERSION")"
PKG_SPEC="${PACKAGE_NAME}@${NORMALIZED_VERSION}"

info "Installing Agendex CLI (${PKG_SPEC})"
if ! install_package "$PM" "$PKG_SPEC"; then
	warn "installation failed."
	if [ "$PM" = "npm" ]; then
		cat >&2 <<'NPM_HELP'
If this was an npm permissions error, either use a Node version manager
(recommended) or configure a user-writable npm prefix, then rerun:

  mkdir -p "$HOME/.local"
  npm config set prefix "$HOME/.local"
  export PATH="$HOME/.local/bin:$PATH"
NPM_HELP
	elif [ "$PM" = "pnpm" ]; then
		cat >&2 <<'PNPM_HELP'
If pnpm reported that no global bin directory is configured, run:

  pnpm setup

Then restart your shell and rerun the Agendex installer.
PNPM_HELP
	fi
	exit 1
fi

BIN_PATH="$(resolve_agendex_bin "$PM" || true)"
if [ "$SKIP_VERIFY" = "0" ]; then
	if [ -z "$BIN_PATH" ]; then
		BIN_DIR="$(manager_bin_dir "$PM" | head -n 1)"
		success "Agendex CLI was installed, but '${BIN_NAME}' is not on PATH yet."
		if [ -n "$BIN_DIR" ]; then
			printf 'Add it for this shell with:\n  export PATH="%s:$PATH"\n' "$BIN_DIR"
		fi
		print_next_steps
		exit 0
	fi

	INSTALLED_VERSION="$($BIN_PATH --version 2>/dev/null || true)"
	if [ -z "$INSTALLED_VERSION" ]; then
		fail "installed ${BIN_NAME}, but '${BIN_PATH} --version' failed."
	fi
	success "Agendex CLI installed successfully (${BIN_NAME} ${INSTALLED_VERSION})."
else
	success "Agendex CLI installed successfully."
fi

if ! command_exists "$BIN_NAME" && [ -n "$BIN_PATH" ]; then
	BIN_DIR="$(dirname "$BIN_PATH")"
	printf '\n%s is installed at:\n  %s\n\n' "$BIN_NAME" "$BIN_PATH"
	printf 'Add it for this shell with:\n  export PATH="%s:$PATH"\n' "$BIN_DIR"
fi

print_next_steps
