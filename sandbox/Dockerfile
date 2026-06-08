# Stage 1: Builder - Compile TypeScript and ttyd
FROM node:24-trixie-slim AS builder

# Install build tools and dependencies for ttyd
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    libjson-c-dev \
    libwebsockets-dev \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Build ttyd from source, pinned for reproducible builds. The terminal page
# relabels ttyd's own reconnect overlay client-side (see RECONNECT_OVERLAY_SCRIPT
# in sandbox/src/templates/shell.ts), keyed off ttyd's exact overlay strings
# ("Press ⏎ to Reconnect", "Reconnecting...", "Reconnected"). Before bumping this
# version, confirm those strings are unchanged in ttyd's client:
# https://github.com/tsl0922/ttyd/blob/main/html/src/components/terminal/xterm/index.ts
ARG TTYD_VERSION=1.7.7
RUN git clone --branch "${TTYD_VERSION}" --depth 1 https://github.com/tsl0922/ttyd.git /tmp/ttyd \
    && cd /tmp/ttyd && mkdir build && cd build \
    && cmake .. \
    && make && make install

# Set working directory
WORKDIR /build

# Copy all source files
COPY . ./

# Install all dependencies (including dev dependencies for build)
RUN npm install

# Compile TypeScript to JavaScript
RUN npm run build

# Run unit tests (fast, no platform dependency). E2E tests are run separately
# via `npm run test:e2e` since they require a deployed Apify run.
# Skip if APIFY_IS_AT_HOME is set — defence-in-depth against accidentally
# running tests during an Actor run (Dockerfile RUN is build-time only, so
# this is belt-and-braces).
RUN [ -n "$APIFY_IS_AT_HOME" ] || npm run test:unit

# Stage 2: Runtime - Node.js image
FROM node:24-trixie-slim

# Install required dependencies for sandbox operations.
# ttyd is compiled from source in the builder stage and copied into this stage
# as a finished binary (see `COPY --from=builder .../ttyd` below), so the runtime
# only needs the shared libraries it uses — not the `-dev` packages, headers, and
# build toolchain that the compile step required:
#   - libjson-c5, libwebsockets19t64, libuv1t64: libraries ttyd links against
#     (the `t64` suffix reflects Debian trixie's 64-bit time_t transition).
#   - libwebsockets-evlib-uv: the libuv event-loop plugin that libwebsockets
#     dlopen()s when ttyd creates its context. It is NOT a link-time dependency,
#     so `ldd ttyd` and `ttyd --version` won't reveal it's missing — but without
#     it ttyd dies at runtime with "lws_create_context: failed to load evlib_uv"
#     and the interactive shell never starts. Keep it when trimming this list.
# We pass --no-install-recommends to drop the recommended-but-unused packages
# that otherwise bloated this layer. build-essential and openssh-client are
# recommends we DO want, so they are listed explicitly: build-essential lets
# sandboxed code compile native node-gyp / C modules at runtime, and
# openssh-client enables git-over-SSH. We intentionally omit python3-dev, so
# pip relies on prebuilt wheels and cannot build Python C extensions from
# source — add python3-dev (plus any package-specific -dev libs) if that ever
# becomes a requirement.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    wget \
    git \
    openssh-client \
    python3 \
    python3-venv \
    python3-pip \
    build-essential \
    ca-certificates \
    libjson-c5 \
    libwebsockets19t64 \
    libuv1t64 \
    libwebsockets-evlib-uv \
    libsecret-1-0 \
    procps \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install global CLI tooling in a single layer, then drop the npm cache so it
# doesn't bloat the image:
#   - tsx: TypeScript execution in the execute-code endpoint
#   - apify-cli: --ignore-scripts works around apify-client's `only-allow pnpm`
#     preinstall hook
#   - @apify/mcpc: Apify MCP CLI (binary: mcpc)
RUN npm install -g tsx \
    && npm install -g --ignore-scripts apify-cli \
    && npm install -g @apify/mcpc \
    && npm cache clean --force

# NOTE: The AI coding agent CLIs (Claude Code, OpenCode, Codex) are deliberately
# NOT installed here. They are installed lazily on first use — when the user
# clicks a launch button on the landing page or types `claude`/`opencode`/`codex`
# in the shell — by the functions in agent-launchers.sh (copied in below and
# sourced from the shell rcfile). This keeps the image small and always pulls
# the latest agent release. Their configuration overrides are still baked in
# below, so each agent starts pre-configured the moment it is installed.

# Create sandbox directory for operations
RUN mkdir -p /sandbox && chmod 755 /sandbox

# Create Python sandbox directory with venv and pre-install apify-client
RUN mkdir -p /sandbox/py && chmod 755 /sandbox/py && \
    python3 -m venv /sandbox/py/venv && \
    /sandbox/py/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /sandbox/py/venv/bin/pip install --no-cache-dir apify-client && \
    echo "apify-client pre-installed in Python venv"

# Create JS/TS sandbox directory with proper package.json and pre-install apify-client
RUN mkdir -p /sandbox/js-ts && chmod 755 /sandbox/js-ts && \
    cd /sandbox/js-ts && \
    echo '{"name":"apify-sandbox-js-ts","version":"1.0.0","description":"Sandbox for JS/TS code execution","type":"module","dependencies":{"apify-client":"*"}}' > package.json && \
    npm install --ignore-scripts && \
    npm cache clean --force && \
    echo "apify-client pre-installed in Node.js environment"

# Copy AGENTS.md to sandbox for AI coding agents
COPY --from=builder /build/artifacts/AGENTS.md /sandbox/AGENTS.md
COPY --from=builder /build/artifacts/AGENTS.md /sandbox/CLAUDE.md

# Capture baseline package state for migration persistence
RUN mkdir -p /app && \
    /sandbox/py/venv/bin/pip freeze > /app/.baseline-pip-freeze.txt && \
    dpkg --get-selections > /app/.baseline-dpkg.txt && \
    echo "Baseline package state captured"

# Set working directory
WORKDIR /app

# Copy compiled dist folder from builder
COPY --from=builder /build/dist /app/dist

# Copy ttyd binary from builder
COPY --from=builder /usr/local/bin/ttyd /usr/local/bin/ttyd

# Smoke-test that ttyd actually starts its server — not just that it loads
# (`ttyd --version`). Creating the libwebsockets context dlopen()s the libuv
# event-loop plugin (libwebsockets-evlib-uv), which `--version` never exercises,
# so a missing plugin or runtime lib fails the build here instead of breaking the
# shell at run time. ttyd is a long-running server, so cap it with `timeout` and
# assert it reached "Listening on port".
RUN OUTPUT="$(timeout 5 ttyd -p 7681 -a -W bash 2>&1 || true)"; \
    echo "$OUTPUT"; \
    echo "$OUTPUT" | grep -q "Listening on port"

# Copy package.json and production node_modules from builder
COPY --from=builder /build/package.json /app/package.json
COPY --from=builder /build/package-lock.json /app/package-lock.json

# Copy OpenCode configuration
RUN mkdir -p /root/.config/opencode
COPY --from=builder /build/artifacts/opencode.json /root/.config/opencode/opencode.json

# Install production dependencies only
RUN npm install --production && npm cache clean --force

# Add local bin to PATH for CLI tools (Claude at ~/.local/bin, OpenCode at ~/.opencode/bin)
ENV PATH="/root/.local/bin:/root/.opencode/bin:$PATH"

# Mark the container as a trusted sandbox.
# Claude Code refuses to run in bypassPermissions / --dangerously-skip-permissions
# mode as root unless IS_SANDBOX is exactly "1", so this is what lets the
# pre-configured bypass mode below actually take effect for the root user.
ENV IS_SANDBOX=1

# Tell Claude Code it is running inside a trusted sandbox so it auto-trusts every
# working directory and never shows the interactive "Do you trust this folder?"
# safety prompt on startup. This flag only affects the folder-trust check.
ENV CLAUDE_CODE_SANDBOXED=1

# Set Claude Code max output tokens
ENV CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000

# Skip Claude Code's first-run onboarding wizard (theme/login picker) so the CLI
# starts straight into a session.
RUN echo '{"hasCompletedOnboarding": true}' > /root/.claude.json

# Pre-configure Claude Code with sandbox-friendly defaults so the user never has
# to answer interactive prompts on launch:
#   - permissions.defaultMode=bypassPermissions  -> run tools without asking
#   - skipDangerousModePermissionPrompt=true      -> skip the one-time "Bypass
#     Permissions mode" disclaimer. This is required: without it Claude silently
#     downgrades bypassPermissions in non-interactive sessions, so tools would
#     still prompt for approval.
RUN mkdir -p /root/.claude && \
    echo '{"permissions":{"defaultMode":"bypassPermissions"},"skipDangerousModePermissionPrompt":true}' > /root/.claude/settings.json

# Configure Codex CLI to use the Apify OpenRouter proxy — the same proxy that backs
# Claude Code and OpenCode — and to auto-approve everything (safe inside the sandbox).
# Codex reads the bearer token from APIFY_TOKEN at runtime, and custom providers
# default to requires_openai_auth=false, so Codex starts straight into a session with
# no "Sign in with ChatGPT" prompt. Bare keys must precede the [table] headers so the
# MCP-connector block appended at runtime (see src/mcp-agent-config.ts) stays valid TOML.
# wire_api MUST be "responses": Codex removed support for the older "chat"
# (chat/completions) wire protocol, and the Apify OpenRouter proxy speaks the
# OpenAI Responses API, so Codex talks to it at <base_url>/responses.
# model is pinned to OpenRouter's "openai/gpt-5.5", OpenAI's current flagship.
# Pinning the concrete version rather than the "~openai/gpt-latest" floating
# alias lets Codex resolve its bundled model metadata (context window etc.) by
# matching the "gpt-5.5" slug suffix, so it no longer warns that metadata is
# "not found" and silently falls back to defaults that mis-size the context
# window. Bump this when a newer flagship ships.
# [projects."/sandbox"] pre-trusts the sandbox working dir (ttyd starts shells
# there) so Codex skips its interactive "Do you trust this directory?" prompt on
# first launch; Codex has no global trust-all switch.
RUN mkdir -p /root/.codex && \
    printf '%s\n' \
        'model = "openai/gpt-5.5"' \
        'model_provider = "apify-openrouter"' \
        'approval_policy = "never"' \
        'sandbox_mode = "danger-full-access"' \
        '' \
        '[model_providers.apify-openrouter]' \
        'name = "apify/openrouter Actor"' \
        'base_url = "https://openrouter.apify.actor/api/v1"' \
        'env_key = "APIFY_TOKEN"' \
        'requires_openai_auth = false' \
        'wire_api = "responses"' \
        '' \
        '[projects."/sandbox"]' \
        'trust_level = "trusted"' \
        > /root/.codex/config.toml

# Lazy-install launchers for the coding agents. Sourced by the shell rcfile (see
# SANDBOX_BASHRC in src/templates/shell.ts) so a launch button or a plain
# `claude`/`opencode`/`codex` installs the agent on first use, then runs it.
# Validate the script at build time — both that it parses and that it actually
# defines the three functions — so a broken launcher fails the build instead of
# the user's first launch.
COPY scripts/agent-launchers.sh /app/agent-launchers.sh
RUN bash -n /app/agent-launchers.sh \
    && bash -c '. /app/agent-launchers.sh; for f in claude opencode codex; do \
        [ "$(type -t "$f")" = function ] || { echo "agent-launchers.sh did not define function: $f"; exit 1; }; \
    done'

# Capture tool versions at build time for fast shell startup
COPY scripts/capture-versions.sh /tmp/capture-versions.sh
RUN chmod +x /tmp/capture-versions.sh && /tmp/capture-versions.sh && rm /tmp/capture-versions.sh

# Run as root user (required for sandbox execution)
USER root

# Use Node.js to execute the compiled application
ENTRYPOINT ["node", "/app/dist/main.js"]
