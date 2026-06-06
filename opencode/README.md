# OpenCode

Run [OpenCode](https://opencode.ai) on Apify infrastructure.

## 🔥 What is OpenCode?

OpenCode is an open-source AI coding agent with:

- Open-source and free to use
- Support for multiple AI models (Claude, GPT, Gemini, local models)
- Free built-in models available

## ⚙️ How It Works

This Actor [metamorphs](https://docs.apify.com/platform/actors/development/programming-interface/metamorph) into the [AI Sandbox](https://apify.com/apify/ai-sandbox) and automatically launches OpenCode in the terminal.

## 🚀 Quick Start

1. Click **Start** on this Actor
2. OpenCode opens in the console terminal
3. Start coding

## 📦 Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `agentSkills` | Skill packages to install (SKILLS.md files), one per line or JSON array | `apify/agent-skills` |
| `initShellScript` | Bash script to run before OpenCode starts | - |
| `idleTimeoutSeconds` | Shutdown after inactivity | 900 |

## 📚 Skills Support

This Actor supports [SKILLS.md](https://skills.sh/) files - specialized instructions that enhance AI coding agent capabilities. Skills are installed automatically at startup.

## 🎯 Use Cases

- Run OpenCode without local installation
- Use free AI models for coding tasks
- Integrate OpenCode into automation workflows

## 🔗 Links

- [OpenCode](https://opencode.ai)
- [OpenCode GitHub](https://github.com/anomalyco/opencode)
- [AI Sandbox](https://apify.com/apify/ai-sandbox)
