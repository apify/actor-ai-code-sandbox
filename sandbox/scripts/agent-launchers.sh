# shellcheck shell=bash
#
# Lazy installers for the bundled AI coding agents (Claude Code, OpenCode, Codex).
#
# The sandbox image ships each agent's *configuration* (provider/proxy settings,
# auto-approve flags, MCP connectors — see the Dockerfile and mcp-agent-config.ts)
# but no longer bundles the CLIs themselves. Each agent is instead installed on
# first use with its official installer, then exec'd.
#
# They are defined as shell functions (rather than wrapper scripts on PATH) so
# both entry points take the identical install-then-run path:
#   - the landing-page launch buttons -> /shell?launch=claude (etc.), and
#   - a plain `claude` / `opencode` / `codex` typed at the prompt.
#
# This file defines functions only and has no top-level side effects, so the
# shell rcfile (SANDBOX_BASHRC) can source it cheaply on every shell start.

# Ensure $1 (a binary name) is runnable, installing it via the command in $3 if
# it is missing. $2 is a human-readable label for messages. Returns non-zero —
# without running anything else — if the agent cannot be made available, so the
# caller can bail out instead of printing a confusing "command not found".
__sandbox_ensure_agent() {
    local bin=$1 label=$2 installer=$3

    # Already installed (from a previous launch, persisted across migrations)?
    # `type -P` ignores this very function and looks only at PATH executables.
    if type -P "$bin" >/dev/null 2>&1; then
        return 0
    fi

    if [ -t 2 ]; then
        printf '\033[0;34mInstalling %s (one-time setup on first launch)...\033[0m\n' "$label" >&2
    else
        printf 'Installing %s (one-time setup on first launch)...\n' "$label" >&2
    fi

    # `set -o pipefail` so a failed download (curl) fails the install instead of
    # piping an empty script to the interpreter, which would exit 0 and look
    # like success.
    if ! bash -c "set -o pipefail; $installer"; then
        printf 'Failed to install %s. Check the network connection and try again.\n' "$label" >&2
        return 1
    fi

    # Drop bash's cached "not found" result, then re-check. The official
    # installers place their binaries in directories already on PATH
    # (~/.local/bin for Claude Code and Codex, ~/.opencode/bin for OpenCode);
    # the loop is a fallback that prepends the install dir to PATH should an
    # installer ever change its default location.
    hash -r 2>/dev/null || true
    if type -P "$bin" >/dev/null 2>&1; then
        return 0
    fi
    local dir
    for dir in "$HOME/.local/bin" "$HOME/.opencode/bin" "$HOME/.codex/bin" "$HOME/bin" /usr/local/bin; do
        if [ -x "$dir/$bin" ]; then
            export PATH="$dir:$PATH"
            hash -r 2>/dev/null || true
            return 0
        fi
    done

    printf '%s was installed but "%s" was not found on PATH.\n' "$label" "$bin" >&2
    return 1
}

# `command <bin>` bypasses these functions and runs the installed binary, so the
# wrappers don't recurse into themselves.
claude() {
    __sandbox_ensure_agent claude 'Claude Code' \
        'curl -fsSL https://claude.ai/install.sh | bash' || return
    command claude "$@"
}

opencode() {
    __sandbox_ensure_agent opencode 'OpenCode' \
        'curl -fsSL https://opencode.ai/install | OPENCODE_INSTALL_DIR=$HOME/.opencode/bin bash' || return
    command opencode "$@"
}

codex() {
    __sandbox_ensure_agent codex 'Codex' \
        'curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh' || return
    command codex "$@"
}
