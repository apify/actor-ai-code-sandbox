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

# Build ttyd from source, pinned for reproducible builds. The shutdown banner
# writes ttyd's own WebSocket output frames directly to the browser terminal
# (see sandbox/src/shutdown.ts, encodeTtydOutputMessage), so a protocol change
# could silently stop the banner from rendering. Before bumping this version,
# confirm terminal OUTPUT is still command byte '0' in ttyd's client protocol:
# https://github.com/tsl0922/ttyd/blob/main/html/src/components/terminal/xterm/index.ts (the Command enum).
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

# Install required dependencies for sandbox operations
RUN apt-get update && apt-get install -y \
    bash \
    curl \
    wget \
    git \
    python3 \
    python3-venv \
    python3-pip \
    ca-certificates \
    libjson-c-dev \
    libwebsockets-dev \
    libsecret-1-0 \
    procps \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install tsx globally for TypeScript execution in execute-code endpoint
RUN npm install -g tsx

# Install Apify CLI globally
# --ignore-scripts works around apify-client's `only-allow pnpm` preinstall hook
RUN npm install -g --ignore-scripts apify-cli

# Install Apify MCP CLI globally (package: @apify/mcpc, binary: mcpc)
RUN npm install -g @apify/mcpc

# Install AI coding agent CLIs via npm. All three ship platform-specific
# native binaries through optional deps; --include=optional ensures the
# Linux binary is fetched. Claude Code uses Node as a launcher; Codex and
# OpenCode bundle their own runtimes (Rust / Bun) inside the binary.
RUN npm install -g --include=optional \
        @anthropic-ai/claude-code \
        @openai/codex \
        opencode-ai

# Create sandbox directory for operations
RUN mkdir -p /sandbox && chmod 755 /sandbox

# Create Python sandbox directory with venv and pre-install apify-client
RUN mkdir -p /sandbox/py && chmod 755 /sandbox/py && \
    python3 -m venv /sandbox/py/venv && \
    /sandbox/py/venv/bin/pip install --upgrade pip && \
    /sandbox/py/venv/bin/pip install apify-client && \
    echo "apify-client pre-installed in Python venv"

# Create JS/TS sandbox directory with proper package.json and pre-install apify-client
RUN mkdir -p /sandbox/js-ts && chmod 755 /sandbox/js-ts && \
    cd /sandbox/js-ts && \
    echo '{"name":"apify-sandbox-js-ts","version":"1.0.0","description":"Sandbox for JS/TS code execution","type":"module","dependencies":{"apify-client":"*"}}' > package.json && \
    npm install --ignore-scripts && \
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

# Copy package.json and production node_modules from builder
COPY --from=builder /build/package.json /app/package.json
COPY --from=builder /build/package-lock.json /app/package-lock.json

# Copy OpenCode configuration
RUN mkdir -p /root/.config/opencode
COPY --from=builder /build/artifacts/opencode.json /root/.config/opencode/opencode.json

# Install production dependencies only
RUN npm install --production

# Add local bin to PATH for CLI tools (Claude at ~/.local/bin, OpenCode at ~/.opencode/bin)
ENV PATH="/root/.local/bin:/root/.opencode/bin:$PATH"

# Set IS_SANDBOX environment variable globally
ENV IS_SANDBOX=1

# Set Claude Code max output tokens to 64000
ENV CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000

# Pre-accept Claude Code's first-run onboarding so the CLI starts immediately.
# Permission prompts are bypassed via --dangerously-skip-permissions in the shell
# wrapper (see SANDBOX_BASHRC); settings.json bypass mode triggers a blocking
# confirmation dialog, so we deliberately don't set it here.
RUN echo '{"hasCompletedOnboarding": true}' > /root/.claude.json

# Configure Codex CLI to auto-approve everything — safe inside the sandbox.
RUN mkdir -p /root/.codex && \
    printf 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n' > /root/.codex/config.toml

# Capture tool versions at build time for fast shell startup
COPY scripts/capture-versions.sh /tmp/capture-versions.sh
RUN chmod +x /tmp/capture-versions.sh && /tmp/capture-versions.sh && rm /tmp/capture-versions.sh

# Run as root user (required for sandbox execution)
USER root

# Use Node.js to execute the compiled application
ENTRYPOINT ["node", "/app/dist/main.js"]
