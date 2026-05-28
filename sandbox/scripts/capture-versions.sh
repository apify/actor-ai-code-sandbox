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

# Capture MCP CLI version (optional)
if mcpc --version > "$VERSION_DIR/mcpc.txt" 2>/dev/null; then
    echo "✅ MCP CLI: $(cat "$VERSION_DIR/mcpc.txt")"
else
    echo "not installed" > "$VERSION_DIR/mcpc.txt"
    echo "⚠️  MCP CLI: not installed"
fi

# Capture Claude CLI version (optional)
if claude --version > "$VERSION_DIR/claude.txt" 2>/dev/null; then
    echo "✅ Claude: $(cat "$VERSION_DIR/claude.txt")"
else
    echo "not installed" > "$VERSION_DIR/claude.txt"
    echo "⚠️  Claude: not installed"
fi

# Capture OpenCode CLI version (optional)
if opencode --version > "$VERSION_DIR/opencode.txt" 2>/dev/null; then
    echo "✅ OpenCode: $(cat "$VERSION_DIR/opencode.txt")"
else
    echo "not installed" > "$VERSION_DIR/opencode.txt"
    echo "⚠️  OpenCode: not installed"
fi

# Capture Codex CLI version (optional)
if codex --version > "$VERSION_DIR/codex.txt" 2>/dev/null; then
    echo "✅ Codex: $(cat "$VERSION_DIR/codex.txt")"
else
    echo "not installed" > "$VERSION_DIR/codex.txt"
    echo "⚠️  Codex: not installed"
fi

echo ""
echo "🎉 Version capture complete! Files stored in $VERSION_DIR"
echo "   This will make shell startup 30-120x faster!"
