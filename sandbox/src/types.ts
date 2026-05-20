/**
 * Type definitions for the Apify AI Sandbox Actor
 */

/**
 * Proxy mapping configuration for routing requests to local servers
 */
export interface ProxyMapping {
    /** Exposed URL path on the container (e.g., /openclaw) */
    path: string;
    /** Full URL of the local service to proxy to (e.g., http://127.0.0.1:18789/openclaw) */
    target: string;
}

export interface ActorInput {
    /**
     * Skill packages to install for the AI coding agent
     * Skills are SKILL.md files that provide specialized instructions
     * Format: array of skill package names or URLs
     * Example: ["apify/agent-skills"]
     */
    skills?: string[];

    /**
     * Node.js dependencies for JavaScript and TypeScript code execution.
     * Accepts either npm CLI-style lines (one `package@version` per line, missing
     * `@version` defaults to `latest`) or a JSON object (`{ "pkg": "version" }`).
     */
    nodeDependencies?: string;

    /**
     * Python requirements in requirements.txt format for Python code execution
     * Format: one package per line with optional version specifiers
     * Example: "requests==2.31.0\npandas>=2.0.0\nnumpy"
     */
    pythonRequirementsTxt?: string;

    /**
     * Optional bash script to customize the sandbox environment
     * Runs after dependency installation in /sandbox directory
     */
    initShellScript?: string;

    /**
     * Secret environment variables exposed to the sandbox shell, init script,
     * and code execution. Accepts either dotenv-style KEY=VALUE lines or a JSON
     * object. Encrypted at rest by Apify (isSecret in input schema).
     */
    envVars?: string;

    /**
     * Graceful shutdown timeout in seconds if no activity is detected.
     * Activity includes HTTP requests and shell interaction.
     * @default 600 (10 minutes)
     */
    idleTimeoutSeconds?: number;

    /**
     * Proxy mappings for routing requests to local servers
     * Maps exposed paths to local service URLs
     * Example: [{ "path": "/openclaw", "target": "http://127.0.0.1:18789/openclaw" }]
     */
    proxyMappings?: ProxyMapping[];
}
