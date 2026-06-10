#!/bin/bash
#
# Lazy-install shim for npm-distributed CLI tools (Apify CLI, mcpc).
#
# Same idea as agent-launchers.sh, but as a real executable on PATH instead of
# a shell function: AI agents and the execute-code endpoints run commands in
# non-interactive shells that never source the rcfile, so functions would be
# invisible exactly where AGENTS.md tells the agents to use these tools.
#
# The shim directory (/opt/sandbox-bin) sits at the END of PATH while npm's
# global bin (/usr/local/bin) comes earlier, so each tool resolves to this shim
# only until its first use installs the real binary — after that, PATH lookup
# finds the real one and the shim is out of the loop.
#
# One script serves every shimmed tool: the Dockerfile copies it under each
# tool's name and it dispatches on $0.

set -uo pipefail

bin=$(basename "$0")
case "$bin" in
    # --ignore-scripts works around apify-client's `only-allow pnpm` preinstall hook.
    apify) pkg=apify-cli; label='Apify CLI'; install_flags='--ignore-scripts' ;;
    mcpc) pkg=@apify/mcpc; label='mcpc'; install_flags='' ;;
    *)
        printf 'cli-shims.sh: no install recipe for "%s"\n' "$bin" >&2
        exit 127
        ;;
esac

# Resolve the real installed binary, preferring npm's global bin dir in this
# image (/usr/local/bin). The `npm prefix -g` fallback covers a relocated
# prefix; it only runs when the tool isn't installed yet, so invocations of an
# already-installed tool stay fast.
resolve_real() {
    if [ -x "/usr/local/bin/$bin" ]; then
        printf '%s' "/usr/local/bin/$bin"
        return 0
    fi
    local prefix
    if prefix=$(npm prefix -g 2>/dev/null) && [ -x "$prefix/bin/$bin" ]; then
        printf '%s' "$prefix/bin/$bin"
        return 0
    fi
    return 1
}

install_tool() {
    printf 'Installing %s (one-time setup on first use)...\n' "$label" >&2
    # npm's cache goes under /tmp so it stays out of the migration snapshot
    # (/tmp is excluded), and install chatter goes to stderr so the tool's
    # stdout stays clean for pipes like `mcpc ... --json | jq`.
    # shellcheck disable=SC2086  # install_flags is intentionally word-split
    npm_config_cache=/tmp/.npm-shim-cache npm install -g --no-fund --no-audit $install_flags "$pkg" >&2
}

if ! real=$(resolve_real); then
    # Serialize concurrent first calls (agents often run commands in parallel):
    # whoever wins the lock installs, the rest see it installed and move on.
    lock="/tmp/.cli-shim-$bin.lock"
    if command -v flock >/dev/null 2>&1; then
        (
            flock 9
            resolve_real >/dev/null || install_tool
        ) 9>"$lock"
    else
        install_tool
    fi

    if ! real=$(resolve_real); then
        printf 'Failed to install %s. Check the network connection and try again.\n' "$label" >&2
        exit 127
    fi
fi

exec "$real" "$@"
