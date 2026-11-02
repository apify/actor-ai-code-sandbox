import { Actor } from "apify";

// Hardcoded rather than read from an env var: a stale env var in Console
// (`apify/ai-sandbox`, since renamed) made every run fail with a 404.
const SANDBOX_ACTOR_NAME = "apify/ai-code-sandbox";

await Actor.init();

const input = await Actor.getInput<Record<string, unknown>>();

// OpenClaw initialization script that installs and configures OpenClaw
const openclawInitScript = `#!/bin/bash
set -e
#############################################
# OpenClaw Unattended Docker Init Script
#############################################
# Install OpenClaw globally. Pinned: releases from 2026.10.6 on require
# Node >=26.12.1, newer than the Node in the published ai-code-sandbox image.
npm install -g openclaw@2026.10.5
# Create config directory
mkdir -p ~/.openclaw
# Write the configuration file
cat > ~/.openclaw/openclaw.json << 'CLAWEOF'
{
  "agents": {
    "defaults": {
      "model": { "primary": "apify-openrouter/moonshotai/kimi-k2.5" },
      "workspace": "~/.openclaw/workspace"
    }
  },
  "tools": {
    "exec": {
      "host": "gateway",
      "security": "full",
      "ask": "off"
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "apify-openrouter": {
        "baseUrl": "https://openrouter.apify.actor/api/v1",
        "apiKey": "\${APIFY_TOKEN}",
        "api": "openai-completions",
        "models": [
          { "id": "moonshotai/kimi-k2.5", "name": "Kimi K2.5" }
        ]
      }
    }
  },
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "port": 18789,
    "controlUi": {
      "enabled": true,
      "basePath": "/openclaw"
    }
  }
}
CLAWEOF
# Run non-interactive onboarding
openclaw onboard \\
  --non-interactive \\
  --accept-risk \\
  --auth-choice skip \\
  --gateway-bind loopback \\
  --gateway-port 18789 \\
  --skip-daemon \\
  --skip-health
# Auto-approve all tool actions (YOLO) — safe inside the sandbox. The effective
# policy is the stricter of two layers, so open both: the requested policy in
# openclaw.json (tools.exec, set above) and the host approvals, which the preset
# writes to OpenClaw's state DB. Don't write ~/.openclaw/exec-approvals.json:
# OpenClaw treats it as legacy and refuses every agent turn while it exists.
openclaw exec-policy preset yolo || true
nohup openclaw gateway run --bind loopback --port 18789 > /tmp/openclaw-gateway.log 2>&1 &
sleep 3
echo "OpenClaw started: http://127.0.0.1:18789/openclaw/"`;

// Combine OpenClaw init script with any user-provided init script
const userInitScript = (input as Record<string, unknown>)?.initBashScript as string | undefined;
const combinedInitScript = userInitScript
  ? `${openclawInitScript}\n\n# User-provided init script\n${userInitScript}`
  : openclawInitScript;

// Build the merged input, injecting the OpenClaw init script
const mergedInput = {
  ...((input as Record<string, unknown>) || {}),
  initBashScript: combinedInitScript,
};

console.log(`🔄 Metamorphing into: ${SANDBOX_ACTOR_NAME}`);

// Metamorph into the configured Actor
await Actor.metamorph(SANDBOX_ACTOR_NAME, mergedInput);

// Code below won't execute after metamorph
