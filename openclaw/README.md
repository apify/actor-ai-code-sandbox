# OpenClaw Assistant

Run [OpenClaw](https://openclaw.ai/) on Apify infrastructure.

## 🔥 What is OpenClaw?

Clears your inbox, sends emails, manages your calendar, checks you in for flights. All from Apify platform.

## ⚙️ How It Works

This Actor [metamorphs](https://docs.apify.com/platform/actors/development/programming-interface/metamorph) into the [AI Sandbox](https://apify.com/apify/ai-sandbox) and automatically launches OpenClaw TUI in the terminal.

On startup, it:
1. Installs OpenClaw globally via npm
2. Configures OpenClaw to use Apify OpenRouter proxy with Kimi K2.5 model
3. Runs non-interactive onboarding
4. Starts the OpenClaw gateway on port 18789
5. Opens OpenClaw TUI in the browser terminal

## 🚀 Quick Start

1. Click **Start** on this Actor
2. OpenClaw TUI opens in the console terminal
3. Start coding

## 📦 Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `skills` | Skill packages to install (SKILLS.md files), one per line or JSON array | `apify/agent-skills` |
| `initShellScript` | Bash script to run before OpenClaw starts | - |
| `idleTimeoutSecs` | Shutdown after inactivity (0 = disabled) | 0 |

## 📚 Skills Support

This Actor supports [SKILLS.md](https://skills.sh/) files - specialized instructions that enhance AI coding agent capabilities. Skills are installed automatically at startup.

## 🎯 Use Cases

- Run OpenClaw without local installation
- AI-powered task automation via chat interfaces
- Integrate OpenClaw into Apify workflows

## 🔗 Links

- [AI Sandbox](https://apify.com/apify/ai-sandbox)
- [Apify OpenRouter](https://apify.com/apify/openrouter)
