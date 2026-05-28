# Claude Code

Run [Claude Code](https://code.claude.com) on Apify infrastructure.

## 🔥 What is Claude Code?

Claude Code is Anthropic's terminal-based AI coding assistant that can:

- Edit files and navigate codebases
- Run shell commands and scripts
- Execute multi-step coding tasks autonomously
- Integrate with Git workflows

## ⚙️ How It Works

This Actor [metamorphs](https://docs.apify.com/platform/actors/development/programming-interface/metamorph) into the [AI Sandbox](https://apify.com/apify/ai-sandbox) and automatically launches Claude Code in the terminal.

## 🚀 Quick Start

1. Click **Start** on this Actor
2. Claude Code opens in the console terminal
3. Start coding

## 📦 Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `skills` | Skill packages to install (SKILLS.md files), one per line or JSON array | `apify/agent-skills` |
| `initShellScript` | Bash script to run before Claude Code starts | - |
| `idleTimeoutSecs` | Shutdown after inactivity | 900 |

## 📚 Skills Support

This Actor supports [SKILLS.md](https://skills.sh/) files - specialized instructions that enhance AI coding agent capabilities. Skills are installed automatically at startup.

## 🎯 Use Cases

- Run Claude Code without local installation
- Execute AI coding tasks on Apify infrastructure
- Integrate Claude Code into automation workflows

## 🔗 Links

- [Claude Code](https://code.claude.com)
- [Claude Code Documentation](https://code.claude.com/docs/en/overview)
- [AI Sandbox](https://apify.com/apify/ai-sandbox)
