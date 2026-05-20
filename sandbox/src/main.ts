import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import http, { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Actor, log } from 'apify';
import type { Request, Response } from 'express';
import express from 'express';
import httpProxy from 'http-proxy';

import { SANDBOX_DIR } from './consts.js';
import { parseEnvVars } from './env-vars.js';
import { executeInitScript, setupExecutionEnvironment, setUserEnvVars } from './environment.js';
import { createMcpServer } from './mcp.js';
import { parseNodeDependencies } from './node-deps.js';
import {
    appendFile,
    createDirectory,
    createZipArchive,
    deleteFileOrDirectory,
    executeCode,
    listFilesDetailed,
    readFileBinary,
    runCommand,
    statPath,
    writeFileBinary,
} from './operations.js';
import { initializePersistence, restoreMigrationState, saveMigrationState } from './persistence.js';
import {
    initializeProxyConfig,
    getProxyMappings,
    saveProxyConfig,
    addProxyMapping,
    removeProxyMapping,
    onMappingsChange,
} from './proxy-config.js';
import { getLandingPageHTML, getLLMsMarkdown } from './templates/landing.js';
import { SANDBOX_BASHRC, WELCOME_SCRIPT } from './templates/shell.js';
import type { ActorInput, ProxyMapping } from './types.js';

// Track initialization state
let initializationComplete = false;
let initializationError: string | null = null;
let lastActivityAt = Date.now();

// Check if running in local mode
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

// Parse and register user-supplied environment variables. Apify decrypts the
// secret input at runtime; we never log values, only key names.
const userEnvVars = parseEnvVars(input?.envVars);
setUserEnvVars(userEnvVars);

const nodeDependencies = parseNodeDependencies(input?.nodeDependencies);

log.info('Actor input retrieved', {
    mode: isLocalMode ? 'local' : 'production',
    hasNodeDependencies: Object.keys(nodeDependencies).length > 0,
    hasPythonRequirements: !!input?.pythonRequirementsTxt?.trim().length,
    hasInitScript: !!input?.initShellScript?.trim().length,
    envVarKeys: Object.keys(userEnvVars),
});

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
let setupResult;
if (restoredFromMigration) {
    log.info('Skipping dependency installation (already restored from migration)');
    setupResult = {
        success: true,
        skillsSetup: { installed: [], failed: [] },
        nodeSetup: { installed: [], failed: [] },
        pythonSetup: { installed: [], failed: [] },
        errors: [],
    };
} else {
    log.info('Setting up execution environment...');
    setupResult = await setupExecutionEnvironment({
        skills: input?.skills,
        nodeDependencies,
        pythonRequirementsTxt: input?.pythonRequirementsTxt,
    });
}

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

// Execute init script if provided and not empty
if (input?.initShellScript && input.initShellScript.trim().length > 0) {
    log.info('Executing init script...');
    const initResult = await executeInitScript(input.initShellScript);
    if (initResult.exitCode !== 0) {
        log.error('Init script failed', {
            exitCode: initResult.exitCode,
            stderr: initResult.stderr,
            stdout: initResult.stdout,
        });
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

// Setup shell environment files
if (!isLocalMode) {
    try {
        log.info('Writing shell environment files...');
        mkdirSync('/app', { recursive: true });
        writeFileSync('/app/welcome.sh', WELCOME_SCRIPT);
        chmodSync('/app/welcome.sh', 0o755);
        writeFileSync('/app/sandbox_bashrc', SANDBOX_BASHRC);
        log.info('Shell environment files written successfully');
    } catch (err) {
        log.error('Failed to write shell environment files', { error: (err as Error).message });
    }
}

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
lastActivityAt = Date.now();
log.info('Actor startup complete - ready for requests');

// Initialize proxy configuration
initializeProxyConfig(input?.proxyMappings);

// Create Express app
const app = express();

// Activity tracking middleware
app.use((req, _res, next) => {
    const isHealth = req.path === '/health';
    const isProbe = !!req.headers['x-apify-container-server-readiness-probe'];

    // Debug: Log all incoming paths that start with /openclaw
    if (req.path.startsWith('/openclaw')) {
        log.info('DEBUG incoming request', {
            path: req.path,
            url: req.url,
            originalUrl: req.originalUrl,
        });
    }

    if (!isHealth && !isProbe) {
        lastActivityAt = Date.now();
    }
    next();
});

// Create HTTP server for WebSocket support
const server = createServer(app);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize language aliases to canonical form
 * @param lang - Language string (optional)
 * @returns Normalized language or null if invalid/not provided
 */
const normalizeLanguage = (lang?: string): 'js' | 'ts' | 'py' | 'shell' | null => {
    if (!lang) return null;
    const lower = lang.toLowerCase();
    const mapping: Record<string, 'js' | 'ts' | 'py' | 'shell'> = {
        js: 'js',
        javascript: 'js',
        ts: 'ts',
        typescript: 'ts',
        py: 'py',
        python: 'py',
        bash: 'shell',
        sh: 'shell',
    };
    return mapping[lower] || null;
};

// ============================================================================
// RESTful Filesystem Endpoints (/fs/*)
// IMPORTANT: These MUST come before app.use(express.json()) to handle raw bodies
// ============================================================================

// HEAD /fs and /fs/ - Root directory metadata (must come before wildcard route)
const handleHeadRoot = async (_req: Request, res: Response) => {
    try {
        const filePath = ''; // Empty string resolves to /sandbox
        log.info('REST HEAD /fs (root) request received', { path: filePath });

        const result = await statPath(filePath);

        if (!result.exists || result.error) {
            log.warning('REST HEAD /fs (root) failed', { path: filePath, error: result.error });
            res.status(404).end();
            return;
        }

        // Set metadata headers
        res.setHeader('X-File-Type', result.type);
        res.setHeader('X-Path', result.path);

        if (result.mtime) {
            res.setHeader('Last-Modified', result.mtime.toUTCString());
        }

        log.info('REST HEAD /fs (root) completed successfully', { path: result.path, type: result.type });
        res.status(200).end();
    } catch (error) {
        log.error('REST HEAD /fs (root) error', { error });
        res.status(500).end();
    }
};

app.head('/fs', handleHeadRoot);
app.head('/fs/', handleHeadRoot);

// GET /fs and /fs/ - List root directory (must come before wildcard route)
const handleGetRoot = async (req: Request, res: Response) => {
    try {
        const filePath = ''; // Empty string resolves to /sandbox
        const download = req.query.download === '1';

        log.info('REST GET /fs (root) request received', { path: filePath, download });

        // Check if path exists and get type
        const statResult = await statPath(filePath);

        if (!statResult.exists || statResult.error) {
            log.warning('REST GET /fs (root) failed', { path: filePath, error: statResult.error });
            res.status(404).json({ error: statResult.error || 'Path not found', path: filePath });
            return;
        }

        if (statResult.type === 'directory') {
            // Directory: either return JSON listing or ZIP download
            if (download) {
                // Download directory as ZIP
                const zipResult = await createZipArchive(filePath);

                if (zipResult.error || !zipResult.stream) {
                    log.warning('REST GET /fs (root) ZIP creation failed', { path: filePath, error: zipResult.error });
                    res.status(500).json({ error: zipResult.error || 'Failed to create ZIP archive' });
                    return;
                }

                // Extract directory name for filename
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', 'attachment; filename="sandbox.zip"');

                log.info('REST GET /fs (root) streaming ZIP', { path: zipResult.path });
                zipResult.stream.pipe(res);
            } else {
                // Return JSON directory listing
                const listResult = await listFilesDetailed(filePath);

                if (listResult.error) {
                    log.warning('REST GET /fs (root) directory listing failed', {
                        path: filePath,
                        error: listResult.error,
                    });
                    res.status(500).json({ error: listResult.error, path: filePath });
                    return;
                }

                log.info('REST GET /fs (root) directory listing completed', {
                    path: listResult.path,
                    entryCount: listResult.entries.length,
                });
                res.json(listResult);
            }
        }
    } catch (error) {
        log.error('REST GET /fs (root) error', { error });
        const err = error as Error;
        res.status(500).json({ error: err.message });
    }
};

app.get('/fs', handleGetRoot);
app.get('/fs/', handleGetRoot);

// HEAD /fs/* - Get file or directory metadata
app.head('/fs/*path', async (req: Request, res: Response) => {
    try {
        const filePath = String(req.params.path || '/');

        log.info('REST HEAD /fs/* request received', { path: filePath });

        const result = await statPath(filePath);

        if (!result.exists || result.error) {
            log.warning('REST HEAD /fs/* failed', { path: filePath, error: result.error });
            res.status(404).end();
            return;
        }

        // Set metadata headers
        res.setHeader('X-File-Type', result.type);
        res.setHeader('X-Path', result.path);

        if (result.mtime) {
            res.setHeader('Last-Modified', result.mtime.toUTCString());
        }

        if (result.type === 'file' && result.size !== undefined) {
            res.setHeader('Content-Length', result.size.toString());
            // Detect MIME type from file extension
            const mimeResult = await readFileBinary(filePath);
            if (mimeResult.mimeType) {
                res.setHeader('Content-Type', mimeResult.mimeType);
            }
        }

        log.info('REST HEAD /fs/* completed successfully', { path: result.path, type: result.type });
        res.status(200).end();
    } catch (error) {
        log.error('REST HEAD /fs/* error', { error });
        res.status(500).end();
    }
});

// GET /fs/* - Read file or list directory
app.get('/fs/*path', async (req: Request, res: Response) => {
    try {
        const filePath = String(req.params.path || '/');
        const download = req.query.download === '1';

        log.info('REST GET /fs/* request received', { path: filePath, download });

        // Check if path exists and get type
        const statResult = await statPath(filePath);

        if (!statResult.exists || statResult.error) {
            log.warning('REST GET /fs/* failed', { path: filePath, error: statResult.error });
            res.status(404).json({ error: statResult.error || 'Path not found', path: filePath });
            return;
        }

        if (statResult.type === 'directory') {
            // Directory: either return JSON listing or ZIP download
            if (download) {
                // Download directory as ZIP
                const zipResult = await createZipArchive(filePath);

                if (zipResult.error || !zipResult.stream) {
                    log.warning('REST GET /fs/* ZIP creation failed', { path: filePath, error: zipResult.error });
                    res.status(500).json({ error: zipResult.error || 'Failed to create ZIP archive' });
                    return;
                }

                // Extract directory name for filename
                const dirName = filePath.split('/').filter(Boolean).pop() || 'archive';
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="${dirName}.zip"`);

                log.info('REST GET /fs/* streaming ZIP', { path: zipResult.path });
                zipResult.stream.pipe(res);
            } else {
                // Return JSON directory listing
                const listResult = await listFilesDetailed(filePath);

                if (listResult.error) {
                    log.warning('REST GET /fs/* directory listing failed', { path: filePath, error: listResult.error });
                    res.status(500).json({ error: listResult.error, path: filePath });
                    return;
                }

                log.info('REST GET /fs/* directory listing completed', {
                    path: listResult.path,
                    entryCount: listResult.entries.length,
                });
                res.json(listResult);
            }
        } else {
            // File: return raw bytes with appropriate Content-Type
            const fileResult = await readFileBinary(filePath);

            if (fileResult.error || !fileResult.content) {
                log.warning('REST GET /fs/* file read failed', { path: filePath, error: fileResult.error });
                res.status(404).json({ error: fileResult.error || 'Failed to read file', path: filePath });
                return;
            }

            // Set Content-Type
            res.setHeader('Content-Type', fileResult.mimeType || 'application/octet-stream');

            // Set Content-Disposition for download
            if (download) {
                const fileName = filePath.split('/').filter(Boolean).pop() || 'file';
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            }

            log.info('REST GET /fs/* file read completed', {
                path: fileResult.path,
                size: fileResult.size,
                mimeType: fileResult.mimeType,
            });
            res.send(fileResult.content);
        }
    } catch (error) {
        log.error('REST GET /fs/* error', { error });
        const err = error as Error;
        res.status(500).json({ error: err.message });
    }
});

// PUT /fs/* - Write/replace file
app.put('/fs/*path', express.raw({ type: '*/*', limit: '500mb' }), async (req: Request, res: Response) => {
    try {
        const filePath = String(req.params.path || '');
        const content = req.body;

        log.info('REST PUT /fs/* request received', {
            path: filePath,
            contentLength: content?.length,
            contentType: req.headers['content-type'],
        });

        if (!filePath || filePath === '/') {
            log.warning('REST PUT /fs/*: cannot write to root directory');
            res.status(400).json({ error: 'Cannot write to root directory' });
            return;
        }

        if (!content) {
            log.warning('REST PUT /fs/*: content is required');
            res.status(400).json({ error: 'Content is required' });
            return;
        }

        const result = await writeFileBinary(filePath, content);

        if (!result.success) {
            log.warning('REST PUT /fs/* failed', { path: filePath, error: result.error });
            res.status(500).json({ error: result.error, path: filePath });
            return;
        }

        log.info('REST PUT /fs/* completed successfully', { path: result.path, size: result.size });
        res.status(200).json({ success: true, path: result.path, size: result.size });
    } catch (error) {
        log.error('REST PUT /fs/* error', { error });
        const err = error as Error;
        res.status(500).json({ error: err.message });
    }
});

// POST /fs/* - Create directory or append to file
app.post('/fs/*path', express.raw({ type: '*/*', limit: '500mb' }), async (req: Request, res: Response) => {
    try {
        const filePath = String(req.params.path || '');
        const mkdir = req.query.mkdir === '1';
        const append = req.query.append === '1';

        log.info('REST POST /fs/* request received', { path: filePath, mkdir, append });

        if (!filePath || filePath === '/') {
            log.warning('REST POST /fs/*: cannot operate on root directory');
            res.status(400).json({ error: 'Cannot operate on root directory' });
            return;
        }

        if (!mkdir && !append) {
            log.warning('REST POST /fs/*: either mkdir=1 or append=1 query parameter is required');
            res.status(400).json({ error: 'Either mkdir=1 or append=1 query parameter is required' });
            return;
        }

        if (mkdir && append) {
            log.warning('REST POST /fs/*: cannot use both mkdir and append');
            res.status(400).json({ error: 'Cannot use both mkdir=1 and append=1' });
            return;
        }

        if (mkdir) {
            // Create directory
            const result = await createDirectory(filePath);

            if (!result.success) {
                log.warning('REST POST /fs/* mkdir failed', { path: filePath, error: result.error });
                res.status(500).json({ error: result.error, path: filePath });
                return;
            }

            log.info('REST POST /fs/* mkdir completed successfully', { path: result.path });
            res.status(201).json({ success: true, path: result.path, type: 'directory' });
        } else {
            // Append to file
            const content = req.body;

            if (!content) {
                log.warning('REST POST /fs/* append: content is required');
                res.status(400).json({ error: 'Content is required for append operation' });
                return;
            }

            const result = await appendFile(filePath, content);

            if (!result.success) {
                log.warning('REST POST /fs/* append failed', { path: filePath, error: result.error });
                res.status(500).json({ error: result.error, path: filePath });
                return;
            }

            log.info('REST POST /fs/* append completed successfully', { path: result.path, size: result.size });
            res.status(200).json({ success: true, path: result.path, size: result.size });
        }
    } catch (error) {
        log.error('REST POST /fs/* error', { error });
        const err = error as Error;
        res.status(500).json({ error: err.message });
    }
});

// DELETE /fs/* - Delete file or directory
app.delete('/fs/*path', async (req: Request, res: Response) => {
    try {
        const filePath = String(req.params.path || '');
        const recursive = req.query.recursive === '1';

        log.info('REST DELETE /fs/* request received', { path: filePath, recursive });

        if (!filePath || filePath === '/') {
            log.warning('REST DELETE /fs/*: cannot delete root directory');
            res.status(400).json({ error: 'Cannot delete root directory' });
            return;
        }

        const result = await deleteFileOrDirectory(filePath, recursive);

        if (!result.success) {
            // Check if error is due to non-empty directory
            if (result.error?.includes('not empty')) {
                log.warning('REST DELETE /fs/* failed - directory not empty', { path: filePath, error: result.error });
                res.status(409).json({ error: result.error, path: filePath, code: 'DIRECTORY_NOT_EMPTY' });
                return;
            }

            log.warning('REST DELETE /fs/* failed', { path: filePath, error: result.error });
            res.status(500).json({ error: result.error, path: filePath });
            return;
        }

        log.info('REST DELETE /fs/* completed successfully', { path: result.path });
        res.status(200).json({ success: true, path: result.path, deleted: true });
    } catch (error) {
        log.error('REST DELETE /fs/* error', { error });
        const err = error as Error;
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// JSON-based REST Endpoints (require express.json middleware)
// ============================================================================

// Middleware for JSON parsing (applied to routes below)
app.use(express.json({ limit: '50mb' }));

// Landing page endpoint
app.get('/', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
        getLandingPageHTML({
            serverUrl,
            isLocalMode,
        }),
    );
});

// Favicon endpoint
app.get('/favicon.ico', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const faviconPath = join(dirname(fileURLToPath(import.meta.url)), 'templates', 'favicon.ico');
    res.sendFile(faviconPath);
});

// LLMs.txt endpoint (Markdown documentation for LLMs)
app.get('/llms.txt', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(getLLMsMarkdown({ serverUrl }));
});

// ============================================================================
// Proxy Mappings Configuration Endpoints
// ============================================================================

// GET /proxy-config - Get current proxy mappings
app.get('/proxy-config', (_req: Request, res: Response) => {
    try {
        const mappings = getProxyMappings();
        res.json({ mappings });
    } catch (error) {
        log.error('Failed to get proxy config', { error: (error as Error).message });
        res.status(500).json({ error: (error as Error).message });
    }
});

// PUT /proxy-config - Replace all proxy mappings
app.put('/proxy-config', (req: Request, res: Response) => {
    try {
        const { mappings } = req.body;

        if (!Array.isArray(mappings)) {
            res.status(400).json({ error: 'mappings must be an array' });
            return;
        }

        // Validate each mapping
        for (const mapping of mappings) {
            if (!mapping.path || typeof mapping.path !== 'string') {
                res.status(400).json({ error: 'Each mapping must have a path string' });
                return;
            }
            if (!mapping.target || typeof mapping.target !== 'string') {
                res.status(400).json({ error: 'Each mapping must have a target string (full URL like http://127.0.0.1:3000/myapp)' });
                return;
            }
        }

        saveProxyConfig(mappings);
        log.info('Proxy config updated via API', { count: mappings.length });
        res.json({ success: true, mappings: getProxyMappings() });
    } catch (error) {
        log.error('Failed to update proxy config', { error: (error as Error).message });
        res.status(500).json({ error: (error as Error).message });
    }
});

// POST /proxy-config - Add a single proxy mapping
app.post('/proxy-config', (req: Request, res: Response) => {
    try {
        const { path, target } = req.body;

        if (!path || typeof path !== 'string') {
            res.status(400).json({ error: 'path is required (e.g., /myapp)' });
            return;
        }
        if (!target || typeof target !== 'string') {
            res.status(400).json({ error: 'target is required (full URL like http://127.0.0.1:3000/myapp)' });
            return;
        }

        addProxyMapping({ path, target });
        log.info('Proxy mapping added via API', { path, target });
        res.json({ success: true, mappings: getProxyMappings() });
    } catch (error) {
        log.error('Failed to add proxy mapping', { error: (error as Error).message });
        res.status(500).json({ error: (error as Error).message });
    }
});

// DELETE /proxy-config/:path - Remove a proxy mapping
app.delete('/proxy-config/*path', (req: Request, res: Response) => {
    try {
        const pathToRemove = '/' + String(req.params.path || '');

        const removed = removeProxyMapping(pathToRemove);
        if (removed) {
            log.info('Proxy mapping removed via API', { path: pathToRemove });
            res.json({ success: true, removed: pathToRemove, mappings: getProxyMappings() });
        } else {
            res.status(404).json({ error: 'Mapping not found', path: pathToRemove });
        }
    } catch (error) {
        log.error('Failed to remove proxy mapping', { error: (error as Error).message });
        res.status(500).json({ error: (error as Error).message });
    }
});

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

    res.json({ status: 'healthy' });
});

// MCP endpoint using proper StreamableHTTPServerTransport
app.post('/mcp', async (req: Request, res: Response) => {
    log.info('MCP request received', { body: req.body });
    const mcpServer = createMcpServer();
    try {
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on('close', () => {
            log.info('MCP request closed');
            void transport.close();
            void mcpServer.close();
        });
    } catch (error) {
        log.error('MCP request error', { error });
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error',
                },
                id: null,
            });
        }
    }
});

// Execute shell command or code (unified endpoint)
app.post('/exec', async (req: Request, res: Response) => {
    try {
        const { command, language, cwd, timeoutSecs } = req.body;

        log.info('REST /exec request received', { command: command?.substring(0, 100), language, cwd, timeoutSecs });

        // Validate command is required
        if (!command) {
            log.debug('REST /exec: command is required');
            res.status(400).json({
                error: 'Command is required',
            });
            return;
        }

        // Normalize language aliases
        const normalizedLang = normalizeLanguage(language);

        // Validate language if provided
        if (language && !normalizedLang) {
            log.debug('REST /exec: invalid language', { language });
            res.status(400).json({
                error: `Invalid language: ${language}. Supported: js, javascript, ts, typescript, py, python, bash, sh`,
            });
            return;
        }

        // Convert timeout from seconds to milliseconds
        const timeoutMs = timeoutSecs ? timeoutSecs * 1000 : undefined;

        let result;

        // Route to appropriate executor based on language
        if (!normalizedLang || normalizedLang === 'shell') {
            // Shell command execution
            log.debug('REST /exec: executing shell command', { cwd, timeoutMs });
            result = await runCommand(command, cwd, timeoutMs);
            result = { ...result, language: 'shell' };
        } else {
            // Code execution (js, ts, py)
            log.debug('REST /exec: executing code', { language: normalizedLang, cwd, timeoutMs });
            result = await executeCode(command, normalizedLang, timeoutMs, cwd);
        }

        // Return appropriate status code
        if (result.exitCode !== 0) {
            log.debug('REST /exec completed with error', { language: result.language, exitCode: result.exitCode });
            res.status(500).json(result);
            return;
        }

        log.info('REST /exec completed successfully', { language: result.language });
        res.json(result);
    } catch (error) {
        log.error('REST /exec error', { error });
        const err = error as Error;
        res.status(500).json({
            error: err.message,
            stdout: '',
            stderr: '',
            exitCode: 1,
            language: 'shell',
        });
    }
});

// ============================================================================
// Shell (ttyd) Implementation
// ============================================================================
const shellPort = 7681;

// Spawn ttyd process
const spawnTtyd = () => {
    log.info('Spawning ttyd process...', { port: shellPort });

    // Run ttyd with custom bashrc for better UX and environment alignment
    const ttyd = spawn('ttyd', ['-p', shellPort.toString(), '-a', '-W', 'bash', '--rcfile', '/app/sandbox_bashrc'], {
        stdio: 'ignore',
        cwd: SANDBOX_DIR,
        env: { ...process.env },
    });

    ttyd.on('error', (err) => {
        log.error('Failed to start ttyd', { error: err.message });
    });

    ttyd.on('exit', (code) => {
        log.warning('ttyd process exited', { code });
        setTimeout(spawnTtyd, 5000);
    });
};

if (!isLocalMode) {
    spawnTtyd();
}

// Manual HTTP Proxy for ttyd
app.all('/shell{*rest}', (req, res) => {
    let path = req.url.replace(/^\/shell/, '') || '/';
    // Ensure path starts with / (handle query strings like ?arg=...)
    if (path.startsWith('?')) {
        path = `/${  path}`;
    }
    const options = {
        hostname: '127.0.0.1',
        port: shellPort,
        path,
        method: req.method,
        headers: req.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
        if (proxyRes.statusCode) {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
        }
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        log.error('Manual proxy error', { error: err.message });
        if (!res.headersSent) {
            res.status(500).send('Shell Proxy Error');
        }
    });

    req.pipe(proxyReq);
});

// Manual WebSocket Proxy for ttyd
const wsProxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:${shellPort}`,
    ws: true,
});

server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/shell')) {
        req.url = req.url.replace(/^\/shell/, '') || '/';
        log.info('Proxying shell WebSocket upgrade', { url: req.url });

        // Track activity on WebSocket data
        socket.on('data', () => {
            lastActivityAt = Date.now();
        });

        wsProxy.ws(req, socket as Duplex, head);
    } else {
        // Check dynamic proxy mappings
        let matchedMapping: ProxyMapping | null = null;
        let matchedPath = '';

        const reqPath = req.url || '/';
        // Extract just the path without query string for matching
        const pathOnly = reqPath.split('?')[0];
        
        for (const mapping of getProxyMappings()) {
            if (pathOnly.startsWith(mapping.path) && mapping.path.length > matchedPath.length) {
                matchedMapping = mapping;
                matchedPath = mapping.path;
            }
        }

        if (matchedMapping && dynamicProxies.has(matchedMapping.path)) {
            const entry = dynamicProxies.get(matchedMapping.path)!;

            // Get the extra path after the exposed path
            let extraPath = pathOnly.slice(matchedMapping.path.length) || '';
            const queryString = reqPath.includes('?') ? reqPath.slice(reqPath.indexOf('?')) : '';
            
            // Build the new URL: targetPath + extraPath + query string
            // Avoid double slashes when joining paths
            let finalPath = entry.targetPath;
            if (extraPath) {
                if (finalPath.endsWith('/') && extraPath.startsWith('/')) {
                    extraPath = extraPath.slice(1);
                }
                if (!finalPath.endsWith('/') && !extraPath.startsWith('/')) {
                    finalPath += '/';
                }
                finalPath += extraPath;
            }
            
            req.url = finalPath + queryString;
            if (!req.url.startsWith('/')) {
                req.url = '/' + req.url;
            }

            log.info('Proxying dynamic WebSocket upgrade', {
                exposedPath: matchedMapping.path,
                targetUrl: entry.targetOrigin + req.url,
            });

            // Track activity
            socket.on('data', () => {
                lastActivityAt = Date.now();
            });

            entry.proxy.ws(req, socket as Duplex, head);
        }
    }
});

// ============================================================================
// Dynamic Proxy Mappings for Local Servers
// ============================================================================

// Store for dynamic proxy instances - stores { proxy, targetOrigin, targetPath }
interface ProxyEntry {
    proxy: ReturnType<typeof httpProxy.createProxyServer>;
    targetOrigin: string;
    targetPath: string;
}
const dynamicProxies = new Map<string, ProxyEntry>();

/**
 * Create or update proxy for a mapping
 */
const setupProxyForMapping = (mapping: ProxyMapping): void => {
    // Normalize target URL
    let targetUrl = mapping.target;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = `http://${targetUrl}`;
    }

    // Parse the target URL to extract origin and path
    let targetOrigin: string;
    let targetPath: string;
    try {
        const url = new URL(targetUrl);
        targetOrigin = `${url.protocol}//${url.host}`;
        targetPath = url.pathname || '/';
        // Keep the target path as-is (preserve trailing slash if present)
    } catch {
        log.error('Invalid target URL', { target: targetUrl });
        return;
    }

    // Remove existing proxy if any
    if (dynamicProxies.has(mapping.path)) {
        const oldEntry = dynamicProxies.get(mapping.path);
        oldEntry?.proxy.close();
    }

    // Create new proxy targeting just the origin
    const proxy = httpProxy.createProxyServer({
        target: targetOrigin,
        changeOrigin: true,
        // Don't rewrite redirects - we handle path mapping ourselves
        autoRewrite: false,
    });

    proxy.on('error', (err, _req, res) => {
        log.error('Dynamic proxy error', { path: mapping.path, target: targetUrl, error: err.message });
        if (res && 'writeHead' in res && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(`Proxy error: target server at ${targetUrl} not available`);
        }
    });

    // Rewrite Location headers in redirects to map target paths back to exposed paths
    proxy.on('proxyRes', (proxyRes) => {
        const location = proxyRes.headers['location'];
        if (location && typeof location === 'string') {
            log.info('Proxy response with Location header', { 
                statusCode: proxyRes.statusCode,
                location,
                targetPath,
                exposedPath: mapping.path
            });
            // If the location starts with the target path, rewrite it to the exposed path
            if (location.startsWith(targetPath)) {
                const newLocation = mapping.path + location.slice(targetPath.length);
                proxyRes.headers['location'] = newLocation;
                log.info('Rewrote redirect Location header', { 
                    original: location, 
                    rewritten: newLocation,
                });
            }
        }
    });

    dynamicProxies.set(mapping.path, { proxy, targetOrigin, targetPath });
    log.info('Proxy configured', { exposedPath: mapping.path, targetOrigin, targetPath });
};

/**
 * Remove proxy for a path
 */
const removeProxyForPath = (path: string): void => {
    if (dynamicProxies.has(path)) {
        const entry = dynamicProxies.get(path);
        entry?.proxy.close();
        dynamicProxies.delete(path);
        log.info('Proxy removed', { path });
    }
};

// Initialize proxies from current config
for (const mapping of getProxyMappings()) {
    setupProxyForMapping(mapping);
}

// Listen for config changes and update proxies
onMappingsChange((newMappings) => {
    // Find removed mappings
    const newPaths = new Set(newMappings.map((m) => m.path));
    for (const path of dynamicProxies.keys()) {
        if (!newPaths.has(path)) {
            removeProxyForPath(path);
        }
    }

    // Add/update mappings
    for (const mapping of newMappings) {
        setupProxyForMapping(mapping);
    }
});

// Dynamic proxy route handler - must be added BEFORE the 404 handler
// This catches all requests to mapped paths
app.use((req: Request, res: Response, next) => {
    // Find matching proxy mapping (longest path match)
    let matchedMapping: ProxyMapping | null = null;
    let matchedPath = '';

    for (const mapping of getProxyMappings()) {
        if (req.path.startsWith(mapping.path) && mapping.path.length > matchedPath.length) {
            matchedMapping = mapping;
            matchedPath = mapping.path;
        }
    }

    if (matchedMapping && dynamicProxies.has(matchedMapping.path)) {
        const entry = dynamicProxies.get(matchedMapping.path)!;

        // Get the extra path after the exposed path (e.g., /openclaw/foo -> /foo)
        let extraPath = req.path.slice(matchedMapping.path.length) || '';
        
        // Build the new URL: targetPath + extraPath + query string
        const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        
        // Avoid double slashes when joining paths
        let finalPath = entry.targetPath;
        if (extraPath) {
            // If targetPath ends with / and extraPath starts with /, remove one
            if (finalPath.endsWith('/') && extraPath.startsWith('/')) {
                extraPath = extraPath.slice(1);
            }
            // If neither has a slash between them, add one
            if (!finalPath.endsWith('/') && !extraPath.startsWith('/')) {
                finalPath += '/';
            }
            finalPath += extraPath;
        }
        
        req.url = finalPath + queryString;
        
        // Ensure URL starts with /
        if (!req.url.startsWith('/')) {
            req.url = '/' + req.url;
        }

        log.info('Proxying request', {
            originalPath: req.path,
            exposedPath: matchedMapping.path,
            extraPath,
            targetPath: entry.targetPath,
            finalUrl: req.url,
            targetUrl: entry.targetOrigin + req.url,
        });

        // Track activity
        lastActivityAt = Date.now();

        entry.proxy.web(req, res);
    } else {
        next();
    }
});

// Start server
server.listen(port, () => {
    log.info(`Apify AI Sandbox listening on port ${port}`);
    log.info(`Server URL: ${serverUrl}`);

    // Print startup information
    console.log('\n=====================================');
    console.log('🚀 Apify AI Sandbox Started');
    console.log('=====================================\n');

    console.log('🏠 Landing page (open first):');
    console.log(`   GET ${serverUrl}/`);
    console.log('       Connection details, quick links, and endpoint URLs\n');

    // Shell terminal endpoint
    console.log(`   GET ${serverUrl}/shell/`);
    console.log(`       Interactive shell terminal\n`);

    // MCP Server URL
    console.log('📡 MCP Server Endpoint:');
    console.log(`        ${serverUrl}/mcp\n`);

    // REST API Endpoints
    console.log('🔧 Available REST Endpoints:');
    console.log(`   POST ${serverUrl}/exec`);
    console.log(`       Execute shell commands or code (JavaScript, TypeScript, Python)`);
    console.log(`       Body: { command: string, language?: string, cwd?: string, timeoutSecs?: number }`);
    console.log(`       Languages: js, javascript, ts, typescript, py, python, bash, sh (omit for shell)\n`);

    console.log(`   GET ${serverUrl}/health`);
    console.log(`       Health check\n`);

    // RESTful Filesystem Endpoints
    console.log('🗂️  RESTful Filesystem Endpoints:');
    console.log(`   GET ${serverUrl}/fs/{path}`);
    console.log(`       Read file or list directory (add ?download=1 to download)`);
    console.log(`       Example: GET /fs/app/output/log.txt\n`);

    console.log(`   PUT ${serverUrl}/fs/{path}`);
    console.log(`       Write/replace file with request body`);
    console.log(`       Example: PUT /fs/app/config.json\n`);

    console.log(`   POST ${serverUrl}/fs/{path}?mkdir=1`);
    console.log(`       Create directory`);
    console.log(`       Example: POST /fs/app/data?mkdir=1\n`);

    console.log(`   POST ${serverUrl}/fs/{path}?append=1`);
    console.log(`       Append to file with request body`);
    console.log(`       Example: POST /fs/app/log.txt?append=1\n`);

    console.log(`   DELETE ${serverUrl}/fs/{path}`);
    console.log(`       Delete file or directory (add ?recursive=1 for non-empty dirs)`);
    console.log(`       Example: DELETE /fs/app/temp?recursive=1\n`);

    console.log(`   HEAD ${serverUrl}/fs/{path}`);
    console.log(`       Get file/directory metadata in headers\n`);

    console.log('=====================================\n');

    // Start idle timeout check
    const idleTimeoutSecs = input?.idleTimeoutSeconds ?? 600;
    if (idleTimeoutSecs > 0) {
        log.info(`Idle timeout monitor started (${idleTimeoutSecs}s)`);
        setInterval(async () => {
            const idleTimeMs = Date.now() - lastActivityAt;
            if (idleTimeMs > idleTimeoutSecs * 1000) {
                const message = `Actor shut down after ${Math.floor(idleTimeoutSecs / 60)} minutes of inactivity.`;
                log.warning(message);
                await Actor.exit({ statusMessage: message });
            }
        }, 30000); // Check every 30 seconds
    }
});
