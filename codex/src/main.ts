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

const input = await Actor.getInput();

console.log(`🔄 Metamorphing into: ${sandboxActorName}`);

// Metamorph into the configured Actor
await Actor.metamorph(sandboxActorName, input);

// Code below won't execute after metamorph
