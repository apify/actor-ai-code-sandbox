# Codex

Run [OpenAI Codex CLI](https://github.com/openai/codex) on Apify infrastructure.

## 🔥 What is Codex?

Codex is OpenAI's terminal-based AI coding assistant that can:

- Edit files and navigate codebases
- Run shell commands and scripts
- Execute multi-step coding tasks autonomously
- Integrate with Git workflows

## ⚙️ How It Works

This Actor [metamorphs](https://docs.apify.com/platform/actors/development/programming-interface/metamorph) into the [AI Code Sandbox](https://apify.com/apify/ai-sandbox) and automatically launches Codex in the terminal.

## 🚀 Quick Start

1. Click **Start** on this Actor
2. Codex opens in the console terminal
3. Start coding

## 📦 Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `skills` | Skill packages to install (SKILLS.md files) | `["apify/agent-skills"]` |
| `initShellScript` | Bash script to run before Codex starts | - |
| `idleTimeoutSecs` | Shutdown after inactivity | 600 |

## 📚 Skills Support

This Actor supports [SKILLS.md](https://skills.sh/) files - specialized instructions that enhance AI coding agent capabilities. Skills are installed automatically at startup.

## 🎯 Use Cases

- Run Codex without local installation
- Execute AI coding tasks on Apify infrastructure
- Integrate Codex into automation workflows

## 🔗 Links

- [Codex CLI](https://github.com/openai/codex)
- [AI Code Sandbox](https://apify.com/apify/ai-sandbox)
