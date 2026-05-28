# Minimal Dockerfile for Claude Code Sandbox Actor
# This Actor just metamorphs into the main sandbox, so we only need basic Node.js

# Stage 1: Builder - Compile TypeScript
FROM node:24-slim AS builder

WORKDIR /build

# Copy all source files
COPY . ./

# Install all dependencies (including dev dependencies for build)
RUN npm install

# Compile TypeScript to JavaScript
RUN npm run build

# Stage 2: Runtime
FROM apify/actor-node:24

WORKDIR /usr/src/app

# Copy compiled dist folder from builder
COPY --from=builder /build/dist ./dist

# Copy package files
COPY --from=builder /build/package.json ./package.json
COPY --from=builder /build/package-lock.json ./package-lock.json

# Install production dependencies only
RUN npm --quiet set progress=false \
    && npm install --only=prod --no-optional \
    && echo "Installed NPM packages:" \
    && (npm list --only=prod --no-optional --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Run the compiled Actor
CMD npm start --silent
