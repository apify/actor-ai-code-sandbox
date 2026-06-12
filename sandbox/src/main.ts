/**
 * Actor entrypoint: runs the startup sequence (input parsing, migration
 * restore, dependency installation, init script), then assembles and starts
 * the HTTP server.
 *
 * Feature logic lives in dedicated modules — routes/* for the HTTP API,
 * shell-server.ts for the interactive terminal, bridge-proxy.ts for exposing
 * local servers, idle.ts for the inactivity shutdown. This file is the
 * sequence and the wiring, top to bottom.
 */
import { createServer } from 'node:http';

import { Actor, log } from 'apify';
import type { Request, Response } from 'express';
import express from 'express';

import { bridgeRequestHandler, handleBridgeUpgrade, initializeBridgeProxies } from './bridge-proxy.js';
import { initializeBridges } from './bridges.js';
import { parseEnvVars } from './env-vars.js';
import { executeInitScript, setupExecutionEnvironment, setUserEnvVars } from './environment.js';
import { configureIdleTimeout, getIdleTimeoutSecs, getRemainingSecs, startIdleMonitor, touchActivity } from './idle.js';
import { configureAgentMcpServers } from './mcp-agent-config.js';
import { writeMcpConfig } from './mcp-connections.js';
import { parseNodeDependencies } from './node-deps.js';
import { initializePersistence, restoreMigrationState, saveMigrationState } from './persistence.js';
import { createBridgesRouter } from './routes/bridges.js';
import { handleExec } from './routes/exec.js';
import { createFsRouter } from './routes/fs.js';
import { handleMcp } from './routes/mcp.js';
import { handleShellUpgrade, registerShellRoutes, startShellBackend } from './shell-server.js';
import { parseSkills } from './skills.js';
import { setStatusMessage } from './status.js';
import { getBrowsePageHTML } from './templates/browse.js';
import { getLandingPageHTML, getLLMsMarkdown } from './templates/landing.js';
import type { ActorInput } from './types.js';

// ============================================================================
// Startup sequence
// ============================================================================

// Track initialization state for the /health endpoint
let initializationComplete = false;
let initializationError: string | null = null;

// In local mode (MODE=local) the sandbox directories, dependency installation,
// init script, and ttyd are all skipped — only the HTTP server runs.
const isLocalMode = process.env.MODE === 'local';
if (isLocalMode) {
    log.info('🔧 Running in LOCAL MODE - Sandbox directories and environment setup will be skipped');
}

// The init() call configures the Actor for its environment. It's recommended to start every Actor with an init()
await Actor.init();

// Get the port from environment variables or Actor config
const port = parseInt(process.env.ACTOR_WEB_SERVER_PORT || '', 10) || Actor.config.get('standbyPort') || 3000;

// Get the server URL from environment variable or construct it
const serverUrl = process.env.ACTOR_WEB_SERVER_URL || `http://localhost:${port}`;

// Retrieve Actor input
const input = await Actor.getInput<ActorInput>();
configureIdleTimeout(input?.idleTimeoutSecs);

// Parse and register user-supplied environment variables. Apify decrypts the
// secret input at runtime; we never log values, only key names.
const userEnvVars = parseEnvVars(input?.envVars);
setUserEnvVars(userEnvVars);

const nodeDependencies = parseNodeDependencies(input?.nodeDependencies);
const skills = parseSkills(input?.agentSkills);

log.info('Actor input retrieved', {
    mode: isLocalMode ? 'local' : 'production',
    hasSkills: skills.length > 0,
    hasNodeDependencies: Object.keys(nodeDependencies).length > 0,
    hasPythonRequirements: !!input?.pythonRequirements?.trim().length,
    hasInitScript: !!input?.initBashScript?.trim().length,
    envVarKeys: Object.keys(userEnvVars),
    mcpConnectorCount: input?.mcpConnectors?.length ?? 0,
});

// Write /sandbox/mcp.json with the configured MCP Connector proxies so
// tools like `mcpc connect` find them as soon as the shell opens, then load the
// same servers into Claude Code, Codex, and OpenCode so they appear as tools the
// moment an agent launches (no `claude mcp add` / `mcpc connect` step needed).
if (!isLocalMode) {
    const mcpConfig = writeMcpConfig(input?.mcpConnectors);
    configureAgentMcpServers(mcpConfig);
}

// Check for migration state and restore if available
let restoredFromMigration = false;
if (!isLocalMode) {
    log.info('Checking for migration state to restore...');
    restoredFromMigration = await restoreMigrationState();

    if (restoredFromMigration) {
        log.info('Successfully restored from migration state');
    }
}

// Setup execution environment with dependencies (skip if restored from migration)
if (restoredFromMigration) {
    log.info('Skipping dependency installation (already restored from migration)');
} else {
    log.info('Setting up execution environment...');
    const setupResult = await setupExecutionEnvironment({
        skills,
        nodeDependencies,
        pythonRequirements: input?.pythonRequirements,
    });

    if (!setupResult.success) {
        log.warning('Some dependencies failed to install', {
            skillsInstalled: setupResult.skillsSetup.installed,
            skillsFailed: setupResult.skillsSetup.failed,
            nodeInstalled: setupResult.nodeSetup.installed,
            nodeFailed: setupResult.nodeSetup.failed,
            pythonInstalled: setupResult.pythonSetup.installed,
            pythonFailed: setupResult.pythonSetup.failed,
        });
    } else {
        log.info('All dependencies and skills installed successfully');
    }
}

// Execute init script if provided and not empty
if (input?.initBashScript && input.initBashScript.trim().length > 0) {
    log.info('Executing init script...');
    await setStatusMessage('Running setup script');
    const initResult = await executeInitScript(input.initBashScript);
    if (initResult.exitCode !== 0) {
        // The output and failure summary were already streamed by executeInitScript;
        // record the reason so the /health endpoint can report it.
        initializationError = `Init script failed with exit code ${initResult.exitCode}`;
    }
} else {
    log.debug('No init script provided or init script is empty');
}

// Drop user-supplied envVars after the init script. They were exposed only
// to the install/init bash script; downstream code execution and the shell
// must not see them.
for (const key of Object.keys(userEnvVars)) {
    delete userEnvVars[key];
}
setUserEnvVars({});

// Initialize persistence system (create startup marker for tracking changes)
// Only needed on fresh starts — after migration restore, the marker is already
// set with the correct timestamp by restoreStartupMarkerTimestamp() inside
// restoreMigrationState(). This ensures `find -newer marker` catches both
// restored files (which have their original mtimes from tar) and any new files.
if (!isLocalMode && !restoredFromMigration) {
    try {
        initializePersistence();
    } catch (err) {
        log.error('Failed to initialize persistence system', { error: (err as Error).message });
    }
}

// Register persist state event handler
if (!isLocalMode) {
    Actor.on('persistState', async () => {
        log.info('Saving Actor state...');
        try {
            await saveMigrationState();
        } catch (err) {
            log.error('Failed to save state', { error: (err as Error).message });
        }
    });
}

// Mark initialization as complete
initializationComplete = true;
touchActivity();
log.info('Actor startup complete - ready for requests');
await setStatusMessage('Sandbox is live');

// Load the bridge configuration (Actor input or persisted file) and start
// watching it for changes.
initializeBridges(input?.bridges);

// ============================================================================
// HTTP server assembly
// ============================================================================

const app = express();
// HTTP server wrapper is needed to handle WebSocket upgrades (shell, bridges)
const server = createServer(app);

// Any non-health request — including doc fetches like /llms.txt — counts as
// activity and pushes back the idle-shutdown timer. Only /health and the
// readiness probe are excluded, since they fire automatically.
app.use((req, _res, next) => {
    const isHealth = req.path === '/health';
    const isProbe = !!req.headers['x-apify-container-server-readiness-probe'];
    if (!isHealth && !isProbe) {
        touchActivity();
    }
    next();
});

// RESTful filesystem API. MUST be mounted before express.json() so PUT/POST
// bodies stay raw (the JSON parser would consume them).
app.use('/fs', createFsRouter());

// Middleware for JSON parsing (applied to routes below)
app.use(express.json({ limit: '50mb' }));

// Landing page
app.get('/', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
        getLandingPageHTML({
            serverUrl,
            isLocalMode,
            idleTimeoutSecs: getIdleTimeoutSecs(),
        }),
    );
});

// Interactive filesystem browser. SPA fetches the /fs/* JSON endpoints to
// render directory listings and file previews.
const handleBrowse = (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getBrowsePageHTML());
};
app.get('/browse', handleBrowse);
app.get('/browse/', handleBrowse);
app.get('/browse/*path', handleBrowse);

// LLMs.txt endpoint (Markdown documentation for LLMs)
app.get('/llms.txt', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(getLLMsMarkdown({ serverUrl, idleTimeoutSecs: getIdleTimeoutSecs() }));
});

// Bridges configuration API
app.use('/bridges', createBridgesRouter());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
    if (!initializationComplete) {
        res.status(503).json({
            status: 'initializing',
            message: 'Actor is initializing dependencies and running init script',
        });
        return;
    }

    if (initializationError) {
        res.status(503).json({
            status: 'unhealthy',
            message: initializationError,
        });
        return;
    }

    const body: Record<string, unknown> = { status: 'healthy', idleTimeoutSecs: getIdleTimeoutSecs() };
    const remainingSecs = getRemainingSecs();
    if (remainingSecs !== null) {
        body.remainingSecs = remainingSecs;
    }
    res.json(body);
});

// MCP endpoint (Streamable HTTP transport)
app.post('/mcp', handleMcp);

// Execute shell command or code (unified endpoint)
app.post('/exec', handleExec);

// Interactive shell: /shell HTTP traffic is proxied to ttyd; the ttyd process
// itself only runs in production mode (the proxy then reports it unavailable).
registerShellRoutes(app);
if (!isLocalMode) {
    startShellBackend();
}

// Bridges: forward requests on exposed paths to local servers. Registered
// last so explicit endpoints always win over bridged paths.
initializeBridgeProxies();
app.use(bridgeRequestHandler);

// WebSocket upgrades go to the shell or a bridge; anything else is refused.
server.on('upgrade', (req, socket, head) => {
    if (handleShellUpgrade(req, socket, head)) return;
    if (handleBridgeUpgrade(req, socket, head)) return;
    socket.destroy();
});

// ============================================================================
// Start
// ============================================================================

server.listen(port, () => {
    log.info(`Apify AI Code Sandbox listening on port ${port}`);
    log.info(`Server URL: ${serverUrl}`);

    // Print startup information
    console.log('\n=====================================');
    console.log('🚀 Apify AI Code Sandbox Started');
    console.log('=====================================\n');

    console.log('🏠 Sandbox home page:');
    console.log(`   ${serverUrl}/\n`);

    // LLMs.txt documentation endpoint
    console.log('📄 Documentation for LLMs in Markdown:');
    console.log(`   ${serverUrl}/llms.txt\n`);

    console.log('🗂  File browser:');
    console.log(`   GET ${serverUrl}/browse`);
    console.log('       Interactive web UI for navigating /sandbox\n');

    // Shell terminal endpoint
    console.log('🖥️  Shell terminal:');
    console.log(`   ${serverUrl}/shell\n`);

    console.log('=====================================\n');

    startIdleMonitor();
});
