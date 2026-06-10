#!/bin/bash
# Version Capture Script
# Captures tool versions at Docker build time and stores them in text files
# This dramatically speeds up shell welcome message by avoiding runtime --version calls

set -e  # Exit on any error

VERSION_DIR="/app/.versions"

echo "📦 Capturing tool versions at build time..."

# Create version directory
mkdir -p "$VERSION_DIR"

# Capture Node.js version (CRITICAL - fail if not found)
if ! node -v > "$VERSION_DIR/node.txt" 2>&1; then
    echo "❌ ERROR: Node.js not found - this is a critical dependency"
    exit 1
fi
echo "✅ Node.js: $(cat "$VERSION_DIR/node.txt")"

# Capture Python version (CRITICAL - fail if not found)
if ! python3 --version > "$VERSION_DIR/python.txt" 2>&1; then
    echo "❌ ERROR: Python3 not found - this is a critical dependency"
    exit 1
fi
echo "✅ Python: $(cat "$VERSION_DIR/python.txt")"

# The Apify CLI, mcpc, Claude Code, OpenCode, and Codex are NOT captured here:
# they are installed lazily on first use (see cli-shims.sh for the CLIs and
# agent-launchers.sh for the agents), so there is nothing to probe at build
# time. Probing `apify`/`mcpc` here would actually trigger their shims and
# install ~220 MB into the image. The shell welcome message detects all of
# them at runtime instead, showing the real version once a tool has been
# installed and an "installs on first use" hint before that.

echo ""
echo "🎉 Version capture complete! Files stored in $VERSION_DIR"
echo "   This will make shell startup 30-120x faster!"
