import { Actor } from "apify";

await Actor.init();

// Get the target Actor name from environment variable
const sandboxActorName = process.env.SANDBOX_ACTOR_NAME;

if (!sandboxActorName) {
  console.error(
    "❌ Error: SANDBOX_ACTOR_NAME environment variable is not set.",
  );
  console.error(
    "Please configure the SANDBOX_ACTOR_NAME environment variable with the Actor to metamorph into.",
  );
  console.error("Example: SANDBOX_ACTOR_NAME=apify/ai-sandbox");
  await Actor.exit({
    statusMessage: "Missing SANDBOX_ACTOR_NAME environment variable",
  });
  process.exit(0);
}

const input = await Actor.getInput<Record<string, unknown>>();

// OpenClaw initialization script that installs and configures OpenClaw
const openclawInitScript = `#!/bin/bash
set -e
#############################################
# OpenClaw Unattended Docker Init Script
#############################################
# Install OpenClaw globally
npm install -g openclaw@latest
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
# openclaw.json (tools.exec, set above) and the host-local approvals file below.
openclaw exec-policy preset yolo || true
cat > ~/.openclaw/exec-approvals.json << 'APPROVEEOF'
{
  "version": 1,
  "defaults": { "security": "full", "ask": "off", "askFallback": "full" }
}
APPROVEEOF
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

console.log(`🔄 Metamorphing into: ${sandboxActorName}`);

// Metamorph into the configured Actor
await Actor.metamorph(sandboxActorName, mergedInput);

// Code below won't execute after metamorph
