import { Actor } from "apify";

// Hardcoded rather than read from an env var: a stale env var in Console
// (`apify/ai-sandbox`, since renamed) made every run fail with a 404.
const SANDBOX_ACTOR_NAME = "apify/ai-code-sandbox";

await Actor.init();

const input = await Actor.getInput();

console.log(`🔄 Metamorphing into: ${SANDBOX_ACTOR_NAME}`);

await Actor.metamorph(SANDBOX_ACTOR_NAME, input);

// Code below won't execute after metamorph
