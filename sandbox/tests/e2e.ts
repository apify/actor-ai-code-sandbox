/**
 * E2E Platform Test for Apify AI Sandbox Actor
 *
 * This script:
 * 1. Deploys and starts the Actor on Apify platform
 * 2. Waits for the Actor to become healthy
 * 3. Runs comprehensive REST endpoint tests
 * 4. Cleans up by aborting the Actor run
 *
 * Usage:
 *   npm run test:e2e
 *   npx tsx tests/e2e.ts
 */

import { spawn } from 'node:child_process';

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
};

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
}

const results: TestResult[] = [];

// Track the apify call process so we can kill it on cleanup
let apifyCallProcess: ReturnType<typeof spawn> | null = null;

// ============================================================================
// Deployment & Platform Functions
// ============================================================================

async function deployActor(input: object): Promise<void> {
    console.log(`${colors.green}ℹ${colors.reset} Starting Actor on Apify platform...`);

    return new Promise((resolve, reject) => {
        apifyCallProcess = spawn('apify', ['call', '-f', '-'], {
            stdio: ['pipe', 'ignore', 'ignore'],
            detached: false, // Keep it attached so we can kill it
        });

        // Give it a moment to start, then resolve
        const timeoutId = setTimeout(() => {
            console.log(`${colors.green}✓${colors.reset} apify call started in background`);
            resolve();
        }, 1000);

        apifyCallProcess.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(new Error(`Failed to start apify call: ${err.message}`));
        });

        // Write input and immediately resolve (don't wait for process to finish)
        if (apifyCallProcess.stdin) {
            apifyCallProcess.stdin.write(JSON.stringify(input));
            apifyCallProcess.stdin.end();
        }
    });
}

function killApifyCallProcess(): void {
    if (apifyCallProcess && !apifyCallProcess.killed) {
        console.log(`${colors.green}ℹ${colors.reset} Killing apify call process...`);
        apifyCallProcess.kill('SIGTERM');
        apifyCallProcess = null;
    }
}

async function getLatestRunId(): Promise<string> {
    console.log(`${colors.green}ℹ${colors.reset} Getting run ID...`);

    // Wait for run to be registered
    console.log(`${colors.green}ℹ${colors.reset} Waiting 10 seconds for run to be registered...`);
    await new Promise((resolve) => {
        setTimeout(resolve, 10000);
    });

    console.log(`${colors.green}ℹ${colors.reset} Executing: apify runs ls --json --limit 1 --desc`);

    return new Promise((resolve, reject) => {
        const proc = spawn('apify', ['runs', 'ls', '--json', '--limit', '1', '--desc'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        // Timeout after 30 seconds
        const timeoutId = setTimeout(() => {
            if (!proc.killed) {
                proc.kill();
                reject(new Error('Command timed out after 30 seconds'));
            }
        }, 30000);

        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0 || stdout.trim()) {
                try {
                    const data = JSON.parse(stdout);
                    if (!data.items || data.items.length === 0) {
                        reject(new Error('No runs found'));
                        return;
                    }
                    const runId = data.items[0].id;
                    console.log(`${colors.green}✓${colors.reset} Run ID: ${runId}`);
                    resolve(runId);
                } catch (error) {
                    reject(new Error(`Failed to parse runs list: ${error}`));
                }
            } else {
                reject(new Error(`Command failed with code ${code}: ${stderr}`));
            }
        });

        proc.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(new Error(`Failed to execute apify command: ${error.message}`));
        });
    });
}

async function waitForHealth(runId: string, timeoutSeconds = 180): Promise<string> {
    console.log(
        `${colors.green}ℹ${colors.reset} Waiting for Actor to be ready (dependencies installing, init script running)...`,
    );

    const pollInterval = 5000; // 5 seconds
    const startTime = Date.now();

    // First, get the container URL
    let containerUrl = '';
    while (!containerUrl && Date.now() - startTime < 30000) {
        try {
            containerUrl = await new Promise<string>((resolve) => {
                const proc = spawn('apify', ['runs', 'info', runId, '--json'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                let stdout = '';

                proc.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                // Timeout after 10 seconds
                const timeoutId = setTimeout(() => {
                    if (!proc.killed) {
                        proc.kill();
                        resolve('');
                    }
                }, 10000);

                proc.on('close', () => {
                    clearTimeout(timeoutId);
                    try {
                        const data = JSON.parse(stdout);
                        resolve(data.containerUrl || '');
                    } catch {
                        resolve('');
                    }
                });

                proc.on('error', () => {
                    clearTimeout(timeoutId);
                    resolve('');
                });
            });
        } catch {
            // Ignore errors and retry
        }
        if (!containerUrl) {
            await new Promise((resolve) => {
                setTimeout(resolve, 2000);
            });
        }
    }

    if (!containerUrl) {
        throw new Error('Could not get container URL');
    }

    console.log(`${colors.green}✓${colors.reset} Container URL obtained: ${containerUrl}`);

    // Now wait for /health endpoint to return 200
    const healthCheckStartTime = Date.now();
    while (Date.now() - healthCheckStartTime < timeoutSeconds * 1000) {
        try {
            const response = await fetch(`${containerUrl}/health`);
            if (response.status === 200) {
                console.log(`${colors.green}✓${colors.reset} Actor is healthy`);
                return containerUrl;
            }
            if (response.status === 503) {
                const data = (await response.json()) as { status?: string };
                const status = data.status || 'unknown';
                const elapsed = Math.floor((Date.now() - healthCheckStartTime) / 1000);
                console.log(`${colors.green}ℹ${colors.reset} Actor status: ${status} (${elapsed}s elapsed)`);
            }
        } catch {
            // Network errors, retry
        }

        await new Promise((resolve) => {
            setTimeout(resolve, pollInterval);
        });
    }

    throw new Error(`Timeout waiting for Actor to become healthy after ${timeoutSeconds}s`);
}

async function abortRun(runId: string): Promise<void> {
    console.log(`${colors.green}ℹ${colors.reset} Cleaning up: Aborting Actor run...`);

    return new Promise((resolve) => {
        const proc = spawn('apify', ['runs', 'abort', runId, '-f'], {
            stdio: 'ignore',
        });

        // Timeout after 10 seconds
        const timeoutId = setTimeout(() => {
            if (!proc.killed) {
                proc.kill();
                console.log(`${colors.yellow}⚠${colors.reset} Abort command timed out`);
                killApifyCallProcess();
                resolve();
            }
        }, 10000);

        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
                console.log(`${colors.green}✓${colors.reset} Run aborted`);
            } else {
                console.log(`${colors.yellow}⚠${colors.reset} Could not abort run (exit code: ${code})`);
            }
            // Kill the apify call process
            killApifyCallProcess();
            resolve();
        });

        proc.on('error', () => {
            clearTimeout(timeoutId);
            console.log(`${colors.yellow}⚠${colors.reset} Could not abort run`);
            killApifyCallProcess();
            resolve();
        });
    });
}

// ============================================================================
// Test Helper Functions
// ============================================================================

async function testEndpoint(
    baseUrl: string,
    method: string,
    endpoint: string,
    body: unknown,
    expectedStatus: number,
    testName: string,
): Promise<void> {
    try {
        const url = `${baseUrl}${endpoint}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (response.status === expectedStatus) {
            console.log(`${colors.green}✓${colors.reset} ${testName}`);
            results.push({ name: testName, passed: true });
        } else {
            const errorMsg = `Expected status ${expectedStatus}, got ${response.status}`;
            console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
            results.push({ name: testName, passed: false, error: errorMsg });
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
        results.push({ name: testName, passed: false, error: errorMsg });
    }
}

async function testEndpointWithOutputValidation(
    baseUrl: string,
    method: string,
    endpoint: string,
    body: unknown,
    expectedStatus: number,
    expectedOutputContent: string,
    testName: string,
): Promise<void> {
    try {
        const url = `${baseUrl}${endpoint}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const data = (await response.json()) as { stdout?: string; stderr?: string };

        if (response.status !== expectedStatus) {
            const errorMsg = `Expected status ${expectedStatus}, got ${response.status}`;
            console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
            results.push({ name: testName, passed: false, error: errorMsg });
            return;
        }

        const output = data.stdout || '';
        if (output.includes(expectedOutputContent)) {
            console.log(`${colors.green}✓${colors.reset} ${testName}`);
            results.push({ name: testName, passed: true });
        } else {
            const errorMsg = `Expected output to contain "${expectedOutputContent}", got: "${output}"`;
            console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
            results.push({ name: testName, passed: false, error: errorMsg });
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
        results.push({ name: testName, passed: false, error: errorMsg });
    }
}

/**
 * Run a /exec command and assert that the secret value does NOT appear in the
 * output. Used to verify envVars are stripped from the runtime execution
 * context after the init script. The command should print the env var wrapped
 * in markers (e.g. `<<value>>`) so we can distinguish leak from absent value.
 */
async function testEndpointWithLeakAssertion(
    baseUrl: string,
    body: unknown,
    forbiddenValue: string,
    testName: string,
): Promise<void> {
    try {
        const url = `${baseUrl}/exec`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = (await response.json()) as { stdout?: string; stderr?: string };

        if (response.status !== 200) {
            const errorMsg = `Expected status 200, got ${response.status}`;
            console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
            results.push({ name: testName, passed: false, error: errorMsg });
            return;
        }

        const combined = `${data.stdout ?? ''}\n${data.stderr ?? ''}`;
        if (combined.includes(forbiddenValue)) {
            const errorMsg = `Forbidden value "${forbiddenValue}" leaked into output: "${combined.trim()}"`;
            console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
            results.push({ name: testName, passed: false, error: errorMsg });
        } else {
            console.log(`${colors.green}✓${colors.reset} ${testName}`);
            results.push({ name: testName, passed: true });
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
        results.push({ name: testName, passed: false, error: errorMsg });
    }
}

async function testFsEndpoint(
    baseUrl: string,
    method: string,
    endpoint: string,
    body: string | Uint8Array | null,
    expectedStatus: number,
    testName: string,
): Promise<void> {
    try {
        const url = `${baseUrl}${endpoint}`;
        const headers: HeadersInit = {};

        // Set Content-Type for binary data
        if (body instanceof Uint8Array) {
            headers['Content-Type'] = 'application/octet-stream';
        }

        const response = await fetch(url, {
            method,
            headers,
            body: (body as BodyInit) ?? undefined,
        });

        if (response.status === expectedStatus) {
            console.log(`${colors.green}✓${colors.reset} ${testName}`);
            results.push({ name: testName, passed: true });
        } else {
            const errorMsg = `Expected status ${expectedStatus}, got ${response.status}`;
            console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
            results.push({ name: testName, passed: false, error: errorMsg });
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`${colors.red}✗${colors.reset} ${testName}: ${errorMsg}`);
        results.push({ name: testName, passed: false, error: errorMsg });
    }
}

// ============================================================================
// Comprehensive Test Suite
// ============================================================================

async function runAllTests(baseUrl: string): Promise<void> {
    console.log(`\n${colors.blue}Testing Apify AI Sandbox REST Endpoints${colors.reset}`);
    console.log(`Base URL: ${baseUrl}\n`);

    // Health check
    await testEndpoint(baseUrl, 'GET', '/health', null, 200, 'Health check (GET /health)');

    // ========================================================================
    // Init Script Verification
    // ========================================================================

    // Verify init script created the directory and file
    await testFsEndpoint(
        baseUrl,
        'GET',
        '/fs/test-e2e-init/status.txt',
        null,
        200,
        'Init script - Verify status file exists',
    );

    // Verify init script file content
    try {
        const url = `${baseUrl}/fs/test-e2e-init/status.txt`;
        const response = await fetch(url);
        const content = await response.text();

        if (response.status === 200 && content.includes('E2E test init script executed')) {
            console.log(`${colors.green}✓${colors.reset} Init script - Verify file content`);
            results.push({ name: 'Init script - Verify file content', passed: true });
        } else {
            const errorMsg = `Expected content to contain "E2E test init script executed", got: "${content}"`;
            console.log(`${colors.red}✗${colors.reset} Init script - Verify file content: ${errorMsg}`);
            results.push({ name: 'Init script - Verify file content', passed: false, error: errorMsg });
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`${colors.red}✗${colors.reset} Init script - Verify file content: ${errorMsg}`);
        results.push({ name: 'Init script - Verify file content', passed: false, error: errorMsg });
    }

    // ========================================================================
    // envVars Lifecycle: visible to init script, deleted from runtime context
    // ========================================================================

    // Init script must have seen TEST_E2E_SECRET — proves envVars are exposed
    // to the install/init phase as documented.
    try {
        const url = `${baseUrl}/fs/test-e2e-init/init-saw-secret.txt`;
        const response = await fetch(url);
        const content = (await response.text()).trim();

        if (response.status === 200 && content === 'hunter2-do-not-leak') {
            console.log(`${colors.green}✓${colors.reset} envVars - Init script received TEST_E2E_SECRET`);
            results.push({ name: 'envVars - Init script received TEST_E2E_SECRET', passed: true });
        } else {
            const errorMsg = `Expected init script to write "hunter2-do-not-leak", got: "${content}" (status ${response.status})`;
            console.log(`${colors.red}✗${colors.reset} envVars - Init script received TEST_E2E_SECRET: ${errorMsg}`);
            results.push({ name: 'envVars - Init script received TEST_E2E_SECRET', passed: false, error: errorMsg });
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`${colors.red}✗${colors.reset} envVars - Init script received TEST_E2E_SECRET: ${errorMsg}`);
        results.push({ name: 'envVars - Init script received TEST_E2E_SECRET', passed: false, error: errorMsg });
    }

    // Shell /exec must NOT see the secret. We print a marker before/after so
    // we can distinguish "empty value" from "command failed". A leaked value
    // would appear between the markers.
    await testEndpointWithLeakAssertion(
        baseUrl,
        // eslint-disable-next-line no-template-curly-in-string -- shell interpolation, not JS
        { command: 'printf "<<%s>>" "${TEST_E2E_SECRET}"' },
        'hunter2-do-not-leak',
        'envVars - Shell /exec does not see TEST_E2E_SECRET',
    );

    // Node /exec must NOT see the secret either (different code path: node
    // child_process inherits process.env from the server).
    await testEndpointWithLeakAssertion(
        baseUrl,
        {
            command: 'console.log("<<" + (process.env.TEST_E2E_SECRET ?? "") + ">>")',
            language: 'js',
        },
        'hunter2-do-not-leak',
        'envVars - Node /exec does not see TEST_E2E_SECRET',
    );

    // Execute command - success
    await testEndpoint(
        baseUrl,
        'POST',
        '/exec',
        { command: 'echo "Hello, World!"' },
        200,
        'Execute command - echo success',
    );

    // Execute command - error
    await testEndpoint(baseUrl, 'POST', '/exec', { command: 'exit 1' }, 500, 'Execute command - exit with error');

    // Execute command - missing command
    await testEndpoint(baseUrl, 'POST', '/exec', {}, 400, 'Execute command - missing command field');

    // Execute /exec - JavaScript code
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'console.log("Hello from JS")', language: 'js' },
        200,
        'Hello from JS',
        'Execute /exec - JavaScript code',
    );

    // Execute /exec - JavaScript with language alias
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'console.log(42)', language: 'javascript' },
        200,
        '42',
        'Execute /exec - JavaScript with language alias',
    );

    // Execute /exec - TypeScript code
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'const x: number = 42;\nconsole.log(x);', language: 'ts' },
        200,
        '42',
        'Execute /exec - TypeScript code',
    );

    // Execute /exec - TypeScript with language alias
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'const y: string = "typescript";\nconsole.log(y);', language: 'typescript' },
        200,
        'typescript',
        'Execute /exec - TypeScript with language alias',
    );

    // Execute /exec - Python code
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'print("Hello from Python")', language: 'py' },
        200,
        'Hello from Python',
        'Execute /exec - Python code',
    );

    // Execute /exec - Python with language alias
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'x = 99\nprint(x)', language: 'python' },
        200,
        '99',
        'Execute /exec - Python with language alias',
    );

    // Execute /exec - bash alias (should work like shell)
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'echo "bash alias test"', language: 'bash' },
        200,
        'bash alias test',
        'Execute /exec - bash language alias',
    );

    // Execute /exec - sh alias (should work like shell)
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'echo "sh alias test"', language: 'sh' },
        200,
        'sh alias test',
        'Execute /exec - sh language alias',
    );

    // Execute /exec - with timeoutSecs parameter
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'console.log("timeout test")', language: 'js', timeoutSecs: 5 },
        200,
        'timeout test',
        'Execute /exec - JavaScript with timeoutSecs',
    );

    // Execute /exec - invalid language
    await testEndpoint(
        baseUrl,
        'POST',
        '/exec',
        { command: 'print("test")', language: 'ruby' },
        400,
        'Execute /exec - invalid language',
    );

    // Execute /exec - JavaScript error
    await testEndpoint(
        baseUrl,
        'POST',
        '/exec',
        { command: 'throw new Error("Test error")', language: 'js' },
        500,
        'Execute /exec - JavaScript error',
    );

    // Execute /exec - Python error
    await testEndpoint(
        baseUrl,
        'POST',
        '/exec',
        { command: 'raise ValueError("Test error")', language: 'py' },
        500,
        'Execute /exec - Python error',
    );

    // Execute /exec - JavaScript default working directory (should be /sandbox/js-ts)
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        {
            command:
                'import { execSync } from "node:child_process";\nconst cwd = execSync("pwd").toString().trim();\nconsole.log(cwd);',
            language: 'js',
        },
        200,
        '/sandbox/js-ts',
        'Execute /exec - JavaScript default working directory',
    );

    // Execute /exec - Python default working directory (should be /sandbox/py)
    await testEndpointWithOutputValidation(
        baseUrl,
        'POST',
        '/exec',
        { command: 'import os\nprint(os.getcwd())', language: 'py' },
        200,
        '/sandbox/py',
        'Execute /exec - Python default working directory',
    );

    // ========================================================================
    // Filesystem Endpoints Tests (GET/PUT/POST/DELETE /fs/*)
    // ========================================================================

    // PUT /fs/* - Create new text file
    const testFsFile = '/test-fs-file.txt';
    const testFsContent = 'Hello from filesystem API!';
    await testFsEndpoint(baseUrl, 'PUT', `/fs${testFsFile}`, testFsContent, 200, 'PUT /fs/* - Create new text file');

    // GET /fs/* - Read text file
    await testFsEndpoint(baseUrl, 'GET', `/fs${testFsFile}`, null, 200, 'GET /fs/* - Read text file');

    // PUT /fs/* - Replace existing file
    await testFsEndpoint(
        baseUrl,
        'PUT',
        `/fs${testFsFile}`,
        'Updated content',
        200,
        'PUT /fs/* - Replace existing file',
    );

    // POST /fs/* - Create directory with mkdir=1
    const testFsDir = '/test-fs-dir';
    await testFsEndpoint(baseUrl, 'POST', `/fs${testFsDir}?mkdir=1`, null, 201, 'POST /fs/* - Create directory');

    // POST /fs/* - Create nested directory
    const testFsNestedDir = '/test-fs-parent/test-fs-child';
    await testFsEndpoint(
        baseUrl,
        'POST',
        `/fs${testFsNestedDir}?mkdir=1`,
        null,
        201,
        'POST /fs/* - Create nested directory',
    );

    // GET /fs/* - List directory as JSON
    await testFsEndpoint(baseUrl, 'GET', '/fs/', null, 200, 'GET /fs/* - List root directory as JSON');

    // GET /fs/* - List nested directory
    await testFsEndpoint(baseUrl, 'GET', '/fs/test-fs-parent', null, 200, 'GET /fs/* - List nested directory as JSON');

    // PUT /fs/* - Create file in nested directory
    const testFsNestedFile = '/test-fs-parent/nested-file.txt';
    await testFsEndpoint(
        baseUrl,
        'PUT',
        `/fs${testFsNestedFile}`,
        'Nested file content',
        200,
        'PUT /fs/* - Create file in nested directory',
    );

    // POST /fs/* - Append to file with append=1
    await testFsEndpoint(
        baseUrl,
        'POST',
        `/fs${testFsFile}?append=1`,
        ' Appended text!',
        200,
        'POST /fs/* - Append to existing file',
    );

    // POST /fs/* - Append to non-existent file (should create)
    const testFsAppendNewFile = '/test-fs-append-new.txt';
    await testFsEndpoint(
        baseUrl,
        'POST',
        `/fs${testFsAppendNewFile}?append=1`,
        'Created by append',
        200,
        'POST /fs/* - Append to non-existent file (creates file)',
    );

    // HEAD /fs/* - Get file metadata
    await testFsEndpoint(baseUrl, 'HEAD', `/fs${testFsFile}`, null, 200, 'HEAD /fs/* - Get file metadata');

    // HEAD /fs/* - Get directory metadata
    await testFsEndpoint(baseUrl, 'HEAD', `/fs${testFsDir}`, null, 200, 'HEAD /fs/* - Get directory metadata');

    // HEAD /fs/* - 404 for non-existent path
    await testFsEndpoint(
        baseUrl,
        'HEAD',
        '/fs/non-existent-xyz.txt',
        null,
        404,
        'HEAD /fs/* - Non-existent file (404)',
    );

    // GET /fs/* - 404 for non-existent file
    await testFsEndpoint(baseUrl, 'GET', '/fs/non-existent-file-xyz.txt', null, 404, 'GET /fs/* - Non-existent file');

    // GET /fs/* - 404 for non-existent directory
    await testFsEndpoint(baseUrl, 'GET', '/fs/non-existent-dir-xyz', null, 404, 'GET /fs/* - Non-existent directory');

    // POST /fs/* - Missing mkdir/append parameter (400)
    await testFsEndpoint(
        baseUrl,
        'POST',
        '/fs/test-missing-param',
        'content',
        400,
        'POST /fs/* - Missing mkdir/append parameter',
    );

    // POST /fs/* - Both mkdir and append (400)
    await testFsEndpoint(
        baseUrl,
        'POST',
        '/fs/test-both-params?mkdir=1&append=1',
        'content',
        400,
        'POST /fs/* - Cannot use both mkdir and append',
    );

    // DELETE /fs/* - Delete file successfully
    await testFsEndpoint(baseUrl, 'DELETE', `/fs${testFsAppendNewFile}`, null, 200, 'DELETE /fs/* - Delete file');

    // DELETE /fs/* - Delete non-existent file (should fail)
    await testFsEndpoint(
        baseUrl,
        'DELETE',
        '/fs/non-existent-to-delete.txt',
        null,
        500,
        'DELETE /fs/* - Delete non-existent file',
    );

    // DELETE /fs/* - Delete empty directory
    await testFsEndpoint(baseUrl, 'DELETE', `/fs${testFsDir}`, null, 200, 'DELETE /fs/* - Delete empty directory');

    // DELETE /fs/* - Delete non-empty directory without recursive (409)
    await testFsEndpoint(
        baseUrl,
        'DELETE',
        '/fs/test-fs-parent',
        null,
        409,
        'DELETE /fs/* - Non-empty directory without recursive (409)',
    );

    // DELETE /fs/* - Delete non-empty directory with recursive=1
    await testFsEndpoint(
        baseUrl,
        'DELETE',
        '/fs/test-fs-parent?recursive=1',
        null,
        200,
        'DELETE /fs/* - Delete non-empty directory with recursive',
    );

    // PUT /fs/* - Create binary-like file
    const testFsBinaryFile = '/test-binary.bin';
    const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
    await testFsEndpoint(baseUrl, 'PUT', `/fs${testFsBinaryFile}`, binaryData, 200, 'PUT /fs/* - Create binary file');

    // GET /fs/* - Read binary file
    await testFsEndpoint(baseUrl, 'GET', `/fs${testFsBinaryFile}`, null, 200, 'GET /fs/* - Read binary file');

    // DELETE /fs/* - Cleanup binary file
    await testFsEndpoint(baseUrl, 'DELETE', `/fs${testFsBinaryFile}`, null, 200, 'DELETE /fs/* - Delete binary file');

    // POST /fs/* - Create directory that already exists (idempotent)
    const testFsIdempotentDir = '/test-idempotent-dir';
    await testFsEndpoint(
        baseUrl,
        'POST',
        `/fs${testFsIdempotentDir}?mkdir=1`,
        null,
        201,
        'POST /fs/* - Create directory (first time)',
    );
    await testFsEndpoint(
        baseUrl,
        'POST',
        `/fs${testFsIdempotentDir}?mkdir=1`,
        null,
        201,
        'POST /fs/* - Create directory (already exists, idempotent)',
    );

    // DELETE /fs/* - Cleanup idempotent directory
    await testFsEndpoint(
        baseUrl,
        'DELETE',
        `/fs${testFsIdempotentDir}`,
        null,
        200,
        'DELETE /fs/* - Delete idempotent directory',
    );

    // GET /fs/* - Test file with special characters in name
    const testFsSpecialFile = '/test-file-with-spaces and-special_chars.txt';
    await testFsEndpoint(
        baseUrl,
        'PUT',
        `/fs${testFsSpecialFile}`,
        'Special filename',
        200,
        'PUT /fs/* - Create file with special characters',
    );
    await testFsEndpoint(
        baseUrl,
        'GET',
        `/fs${testFsSpecialFile}`,
        null,
        200,
        'GET /fs/* - Read file with special characters',
    );
    await testFsEndpoint(
        baseUrl,
        'DELETE',
        `/fs${testFsSpecialFile}`,
        null,
        200,
        'DELETE /fs/* - Delete file with special characters',
    );

    // Cleanup - Delete test files
    await testFsEndpoint(baseUrl, 'DELETE', `/fs${testFsFile}`, null, 200, 'Cleanup - Delete test-fs-file.txt');
}

// ============================================================================
// Main E2E Test Flow
// ============================================================================

async function main(): Promise<void> {
    console.log('===================================');
    console.log('🚀 Apify AI Sandbox E2E Platform Test');
    console.log('===================================\n');

    let runId: string | null = null;
    let containerUrl: string | null = null;

    try {
        // Step 1: Prepare input with dependencies
        console.log(`${colors.green}ℹ${colors.reset} Step 1: Preparing Actor input with dependencies...`);

        const input = {
            nodeDependencies: 'zod@^3.22.0',
            pythonRequirementsTxt: 'numpy>=1.24.0',
            envVars: 'TEST_E2E_SECRET=hunter2-do-not-leak',
            initShellScript: [
                '#!/bin/bash',
                'mkdir -p /sandbox/test-e2e-init',
                "echo 'E2E test init script executed' > /sandbox/test-e2e-init/status.txt",
                // Capture whether the secret was visible to the init script. We write
                // the value (not just a flag) so the e2e suite can confirm it matched.
                // eslint-disable-next-line no-template-curly-in-string -- shell interpolation, not JS
                'echo "${TEST_E2E_SECRET:-<unset>}" > /sandbox/test-e2e-init/init-saw-secret.txt',
            ].join('\n'),
        };

        console.log(
            `${colors.green}✓${colors.reset} Input prepared with zod (Node.js) and numpy (Python) dependencies\n`,
        );

        // Step 2: Deploy Actor
        await deployActor(input);

        // Step 3: Get run ID
        runId = await getLatestRunId();

        // Step 4: Wait for Actor to become healthy
        containerUrl = await waitForHealth(runId);

        console.log();

        // Step 5: Run comprehensive test suite
        console.log(`${colors.green}ℹ${colors.reset} Step 5: Running comprehensive REST endpoint test suite...`);
        console.log(`${colors.blue}================================================================${colors.reset}\n`);

        await runAllTests(containerUrl);

        console.log(
            `\n${colors.blue}================================================================${colors.reset}\n`,
        );

        // Summary
        console.log(`${colors.blue}Test Summary${colors.reset}`);
        const passed = results.filter((r) => r.passed).length;
        const total = results.length;
        const percentage = Math.round((passed / total) * 100);

        console.log(`Passed: ${colors.green}${passed}${colors.reset}/${total} (${percentage}%)`);

        if (passed < total) {
            console.log(`\n${colors.red}Failed tests:${colors.reset}`);
            results
                .filter((r) => !r.passed)
                .forEach((r) => {
                    console.log(`  - ${r.name}: ${r.error}`);
                });
        }

        console.log();

        // Step 6: Cleanup
        if (runId) {
            await abortRun(runId);
        }

        console.log('\n===================================');
        if (passed === total) {
            console.log(`${colors.green}✓${colors.reset} E2E Platform Test PASSED ✨`);
        } else {
            console.log(`${colors.red}✗${colors.reset} E2E Platform Test FAILED`);
        }
        console.log('===================================\n');

        console.log('Summary:');
        console.log('  ✓ Actor deployed and started on Apify platform');
        console.log('  ✓ Dependencies installed (zod, numpy)');
        console.log('  ✓ Init script executed');
        if (passed === total) {
            console.log(`  ✓ All ${total} REST endpoint tests passed`);
        } else {
            console.log(`  ✗ Some REST endpoint tests failed`);
        }
        console.log();
        console.log(`Run ID: ${runId}`);
        console.log(`Container URL: ${containerUrl}`);
        console.log();

        process.exit(passed === total ? 0 : 1);
    } catch (error) {
        console.error(`\n${colors.red}✗${colors.reset} E2E test error:`, error);

        // Attempt cleanup even on error
        if (runId) {
            await abortRun(runId);
        }

        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    killApifyCallProcess();
    process.exit(1);
});
