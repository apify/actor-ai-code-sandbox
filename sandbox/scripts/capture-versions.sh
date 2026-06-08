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

# Capture Apify CLI version (optional)
if apify --version > "$VERSION_DIR/apify.txt" 2>/dev/null; then
    echo "✅ Apify CLI: $(cat "$VERSION_DIR/apify.txt")"
else
    echo "not installed" > "$VERSION_DIR/apify.txt"
    echo "⚠️  Apify CLI: not installed"
fi

# Capture mcpc version (optional)
if mcpc --version > "$VERSION_DIR/mcpc.txt" 2>/dev/null; then
    echo "✅ mcpc: $(cat "$VERSION_DIR/mcpc.txt")"
else
    echo "not installed" > "$VERSION_DIR/mcpc.txt"
    echo "⚠️  mcpc: not installed"
fi

# Claude Code, OpenCode, and Codex are NOT captured here: they are installed
# lazily on first use (see agent-launchers.sh), so there is nothing to probe at
# build time. The shell welcome message detects them at runtime instead — it
# falls back to `<agent> --version` when the cached version file is absent — so
# it shows the real version once an agent has been installed, and "not installed"
# before that.

echo ""
echo "🎉 Version capture complete! Files stored in $VERSION_DIR"
echo "   This will make shell startup 30-120x faster!"
