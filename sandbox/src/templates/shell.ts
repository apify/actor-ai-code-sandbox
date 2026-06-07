/**
 * Bash Scripts for Sandbox Environment
 */

/* eslint-disable no-useless-escape */

/**
 * Welcome Script Template - Runs when opening the shell
 */
export const WELCOME_SCRIPT = `#!/bin/bash

# ANSI Color Codes
GREEN='\\033[0;32m'
BLUE='\\033[0;34m'
ORANGE='\\033[38;5;208m'
NC='\\033[0m' # No Color
BOLD='\\033[1m'

# Print ASCII Art
echo -e "\${GREEN}                    *++++++++++++   \${BLUE}************\${NC}"
echo -e "\${GREEN}                    *+++++++++++     \${BLUE}***********\${NC}"
echo -e "\${GREEN}                    *++++++++++       \${BLUE}**********\${NC}"
echo -e "\${GREEN}                    *+++++++++         \${BLUE}*********\${NC}"
echo -e "\${GREEN}                    *++++++++           \${BLUE}********\${NC}"
echo -e "\${GREEN}                    *+++++++             \${BLUE}*******\${NC}"
echo -e "                    \${GREEN}*+++++       \${ORANGE}+\${BLUE}       ******"
echo -e "                    \${GREEN}*+++       \${ORANGE}+++++\${BLUE}       ****"
echo -e "                    \${GREEN}++       \${ORANGE}+++++++++\${BLUE}       **"
echo -e "\${ORANGE}                           +++++++++++++"
echo -e "                         +++++++++++++++++"
echo -e "                       +++++++++++++++++++++"
echo -e "                     +++++++++++++++++++++++++"
echo -e "                    +++++++++++++++++++++++++++\${NC}"

echo ""
echo -e "\${BOLD}Welcome to Apify AI Code Sandbox Actor!\${NC}"
echo ""
echo -e "\${GREEN}System info:\${NC}"

# Read versions from cached files (fallback to runtime check if not found)
VERSION_DIR="/app/.versions"
NODE_VER=\$(cat "\$VERSION_DIR/node.txt" 2>/dev/null || node -v 2>/dev/null || echo 'not installed')
PYTHON_VER=\$(cat "\$VERSION_DIR/python.txt" 2>/dev/null || python3 --version 2>&1 || echo 'not installed')
APIFY_VER=\$(cat "\$VERSION_DIR/apify.txt" 2>/dev/null || apify --version 2>/dev/null || echo 'not installed')
MCPC_VER=\$(cat "\$VERSION_DIR/mcpc.txt" 2>/dev/null || mcpc --version 2>/dev/null || echo 'not installed')
CLAUDE_CODE_VER=\$(cat "\$VERSION_DIR/claude.txt" 2>/dev/null || claude --version 2>/dev/null || echo 'not installed')
OPENCODE_VER=\$(cat "\$VERSION_DIR/opencode.txt" 2>/dev/null || opencode --version 2>/dev/null || echo 'not installed')
CODEX_VER=\$(cat "\$VERSION_DIR/codex.txt" 2>/dev/null || codex --version 2>/dev/null || echo 'not installed')

echo -e "  - Node.js:      \$NODE_VER"
echo -e "  - Python:       \$PYTHON_VER"
if [ -n "\$VIRTUAL_ENV" ]; then
    echo -e "  - Venv:       Active (\$VIRTUAL_ENV)"
fi
echo -e "  - Apify CLI:    \$APIFY_VER"
echo -e "  - mcpc:         \$MCPC_VER"
echo -e "  - Claude Code:  \$CLAUDE_CODE_VER"
echo -e "  - Codex CLI:    \$CODEX_VER"
echo -e "  - OpenCode:     \$OPENCODE_VER"
echo -e "  - LLM API:      https://apify.com/apify/openrouter Actor"
echo -e "  - Working dir:  \$(pwd)"

echo ""
echo -e "\${BLUE}Links:\${NC}"
if [ -n "\$ACTOR_WEB_SERVER_URL" ]; then
    echo -e "  - Sandbox home:        \$ACTOR_WEB_SERVER_URL"
fi
if [ -n "\$ACTOR_RUN_ID" ]; then
    echo -e "  - Actor run:       https://console.apify.com/view/runs/\$ACTOR_RUN_ID"
fi
echo -e "  - Actor homepage:    https://apify.com/apify/ai-code-sandbox"
echo -e "  - Git repo:          https://github.com/apify/actor-ai-sandbox"
echo ""
`;

/**
 * Custom BashRC Template
 */
export const SANDBOX_BASHRC = `# Source global bashrc if it exists
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f ~/.bashrc ] && . ~/.bashrc

# Set environment to match sandbox execution
export PATH="/root/.local/bin:/root/.opencode/bin:/sandbox/js-ts/node_modules/.bin:/sandbox/py/venv/bin:\$PATH"
export NODE_PATH="/sandbox/js-ts/node_modules"
export VIRTUAL_ENV="/sandbox/py/venv"
export PYTHONHOME=""

# Configure Claude Code to use Apify OpenRouter proxy
export ANTHROPIC_BASE_URL="https://openrouter.apify.actor/api"
export ANTHROPIC_AUTH_TOKEN="\${APIFY_TOKEN}"
export ANTHROPIC_API_KEY=""

# Colorful prompt (working directory only, no user/host)
PS1='\\[\\033[01;33m\\]\\w\\[\\033[00m\\]\\$ '

# Aliases
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

# AI coding agents auto-approve all confirmations — safe inside the sandbox.
# Claude Code: bypass mode + prompt suppression are baked into the image via
# settings.json (see the Dockerfile), so a plain \`claude\` starts cleanly on every
# launch path. Codex and OpenCode auto-approve via their own config files.

# Print welcome message (once per session; the launch wrapper sources this
# rcfile twice — to set up the env, then again for the persistent shell).
if [ -z "$SANDBOX_WELCOME_SHOWN" ] && [ -f /app/welcome.sh ]; then
    export SANDBOX_WELCOME_SHOWN=1
    bash /app/welcome.sh
fi
`;

/**
 * Message shown when the terminal WebSocket drops but a reconnect may still work
 * (replaces ttyd's bare "Press ⏎ to Reconnect").
 */
export const TERMINAL_DISCONNECT_MESSAGE = 'Connection lost — press ⏎ to reconnect';

/**
 * Message shown when a reconnect attempt fails — the Actor run has most likely
 * stopped (idle timeout, abort, run timeout, migration). Pressing ⏎ still retries.
 */
export const TERMINAL_FINISHED_MESSAGE = 'Actor probably finished — press ⏎ to retry';

/**
 * Browser script injected into ttyd's terminal page to explain *why* the session
 * ended, client-side.
 *
 * Why client-side: the terminal is proxied (browser ↔ Actor ↔ ttyd), and most
 * stops (run timeout, hard abort, platform scale-down) kill the container with a
 * signal — there is no advance Actor event and no time to flush a banner before
 * the process dies. The browser, however, can always see the socket drop and any
 * failed reconnect, so we relabel ttyd's own reconnect overlay here.
 *
 * ttyd (1.7.7) drives a single overlay <div> via `overlayAddon.showOverlay(text)`
 * (html/src/components/terminal/xterm/index.ts). On a drop it shows
 * "Press ⏎ to Reconnect"; a retry shows "Reconnecting..."; a fresh connection
 * shows "Reconnected". We watch those exact strings: the first prompt means the
 * link dropped (recoverable), but a prompt that follows a "Reconnecting..." means
 * the retry failed — so the Actor is probably gone. The relabel is cosmetic;
 * ttyd's Enter-to-reconnect handler stays intact, so retry still works.
 */
export const RECONNECT_OVERLAY_SCRIPT = `(function () {
    var LOST = ${JSON.stringify(TERMINAL_DISCONNECT_MESSAGE)};
    var FINISHED = ${JSON.stringify(TERMINAL_FINISHED_MESSAGE)};

    // ttyd's exact overlay strings; \\u23ce is the ⏎ glyph it uses.
    var PRESS_ENTER = 'Press \\u23ce to Reconnect';
    var RECONNECTING = 'Reconnecting...';
    var RECONNECTED = 'Reconnected';

    // True once a reconnect has been attempted since the last live connection. If
    // we then fall back to the reconnect prompt, the attempt failed.
    var triedReconnect = false;

    function relabel(el) {
        var text = el.textContent;
        if (text === RECONNECTING) {
            triedReconnect = true;
        } else if (text === RECONNECTED) {
            triedReconnect = false;
        } else if (text === PRESS_ENTER) {
            var msg = triedReconnect ? FINISHED : LOST;
            triedReconnect = false;
            if (el.textContent !== msg) el.textContent = msg;
        }
    }

    // The overlay text is set via textContent, so a change shows up as a childList
    // mutation on the overlay element (or as the element being (re)attached).
    function elementOf(node) {
        if (!node) return null;
        return node.nodeType === 3 ? node.parentNode : node;
    }

    var observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            var target = elementOf(r.target);
            if (target && target.nodeType === 1) relabel(target);
            for (var j = 0; j < r.addedNodes.length; j++) {
                var added = elementOf(r.addedNodes[j]);
                if (added && added.nodeType === 1) relabel(added);
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();`;

/**
 * Inject the reconnect-overlay script into ttyd's HTML page. The script only
 * reacts to overlay text that appears long after load, so placement isn't
 * critical — prefer right after <head>, falling back to <body>, then end of doc.
 *
 * @param html - The HTML document served by ttyd.
 * @returns The HTML with the script injected.
 */
export const injectTerminalReconnectScript = (html: string): string => {
    const tag = `<script>${RECONNECT_OVERLAY_SCRIPT}</script>`;
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => match + tag);
    if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (match) => match + tag);
    return html + tag;
};
