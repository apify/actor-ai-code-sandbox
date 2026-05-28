// Environment setup for code execution (Node.js and Python)
import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { log } from 'apify';

import { INIT_SCRIPT_TIMEOUT, JS_TS_CODE_DIR, PYTHON_CODE_DIR, SANDBOX_DIR } from './consts.js';

const execAsync = promisify(exec);

/**
 * Directories for code execution environments
 */
export const EXECUTION_DIRS = {
    NODE_MODULES: path.join(JS_TS_CODE_DIR, 'node_modules'),
    PYTHON_VENV: path.join(PYTHON_CODE_DIR, 'venv'),
    PYTHON_BIN: path.join(PYTHON_CODE_DIR, 'venv', 'bin'),
} as const;

/**
 * Initialize code execution directories
 * Creates /sandbox/py and /sandbox/js-ts directories with 755 permissions
 */
export const initializeCodeDirectories = async (): Promise<void> => {
    log.debug('Initializing code execution directories');
    try {
        // Create Python code directory
        await fs.mkdir(PYTHON_CODE_DIR, { recursive: true, mode: 0o755 });
        log.debug('Python code directory created', { path: PYTHON_CODE_DIR });

        // Create JS/TS code directory
        await fs.mkdir(JS_TS_CODE_DIR, { recursive: true, mode: 0o755 });
        log.debug('JavaScript/TypeScript code directory created', { path: JS_TS_CODE_DIR });

        log.debug('Code execution directories initialized successfully');
    } catch (error) {
        const err = error as Error;
        log.error('Failed to initialize code directories', { error: err.message });
        throw error;
    }
};

/**
 * Initialize Node.js execution environment
 * Checks if environment is already set up (from Dockerfile) before creating
 */
export const initializeNodeEnvironment = async (): Promise<void> => {
    log.debug('Initializing Node.js environment');
    try {
        // Check if environment is already set up (from Dockerfile)
        const packageJsonPath = path.join(JS_TS_CODE_DIR, 'package.json');
        const nodeModulesPath = EXECUTION_DIRS.NODE_MODULES;

        try {
            await fs.stat(packageJsonPath);
            await fs.stat(nodeModulesPath);
            log.info('Node.js environment already set up (pre-installed from Dockerfile)', {
                path: JS_TS_CODE_DIR,
                nodeModules: nodeModulesPath,
            });
            return;
        } catch {
            // Environment not fully set up, create it
            log.debug('Node.js environment not found, creating...');
        }

        // Initialize code directories first
        await initializeCodeDirectories();

        // Create node_modules directory inside js-ts
        await fs.mkdir(EXECUTION_DIRS.NODE_MODULES, { recursive: true, mode: 0o755 });
        log.debug('Node modules directory created', { path: EXECUTION_DIRS.NODE_MODULES });

        // Create package.json
        const packageJson = {
            name: 'apify-sandbox-js-ts',
            version: '1.0.0',
            description: 'Sandbox for JS/TS code execution',
            type: 'module',
        };
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        log.debug('Created package.json', { path: packageJsonPath });

        log.info('Node.js environment initialized successfully');
    } catch (error) {
        const err = error as Error;
        log.error('Failed to initialize Node.js environment', { error: err.message });
        throw error;
    }
};

/**
 * Initialize Python virtual environment
 * Checks if venv is already set up (from Dockerfile) before creating
 */
export const initializePythonEnvironment = async (): Promise<void> => {
    log.debug('Initializing Python virtual environment');
    try {
        // Check if venv already exists (pre-installed from Dockerfile)
        try {
            await fs.stat(EXECUTION_DIRS.PYTHON_VENV);
            await fs.stat(PYTHON_CODE_DIR);
            log.info('Python venv already set up (pre-installed from Dockerfile)', {
                path: EXECUTION_DIRS.PYTHON_VENV,
                codeDir: PYTHON_CODE_DIR,
            });
            return;
        } catch {
            // venv doesn't exist, create it
            log.debug('Python venv not found, creating...');
        }

        // Initialize code directories first
        await initializeCodeDirectories();

        // Create Python venv with clean environment to avoid conflicts
        log.debug('Creating Python venv', { path: EXECUTION_DIRS.PYTHON_VENV });

        // Create a clean environment without PYTHONHOME/VIRTUAL_ENV to prevent conflicts
        const cleanEnv: NodeJS.ProcessEnv = {};
        Object.keys(process.env).forEach((key) => {
            if (key !== 'PYTHONHOME' && key !== 'VIRTUAL_ENV') {
                cleanEnv[key] = process.env[key];
            }
        });
        // Explicitly set these to empty to override any inherited values
        cleanEnv.PYTHONHOME = '';
        cleanEnv.VIRTUAL_ENV = '';

        await execAsync(`python3 -m venv ${EXECUTION_DIRS.PYTHON_VENV}`, {
            env: cleanEnv,
        });

        log.info('Python virtual environment initialized successfully', {
            path: EXECUTION_DIRS.PYTHON_VENV,
        });
    } catch (error) {
        const err = error as Error;
        log.error('Failed to initialize Python environment', { error: err.message });
        throw error;
    }
};

/**
 * Install Node.js libraries via npm
 * Note: apify-client is pre-installed from Dockerfile
 * Dependencies object format: { "package-name": "version", ... }
 * Example: { "zod": "^3.0", "axios": "latest" }
 */
export const installNodeLibraries = async (
    dependencies: Record<string, string> | undefined,
): Promise<{
    success: boolean;
    installed: string[];
    failed: { library: string; error: string }[];
}> => {
    if (!dependencies || Object.keys(dependencies).length === 0) {
        log.debug('No Node.js dependencies to install');
        return { success: true, installed: [], failed: [] };
    }

    const packageSpecs = Object.entries(dependencies).map(([pkg, version]) => `${pkg}@${version}`);
    log.info('Installing Node.js dependencies', { count: packageSpecs.length, packages: packageSpecs });

    const installed: string[] = [];
    const failed: { library: string; error: string }[] = [];

    for (const [packageName, version] of Object.entries(dependencies)) {
        const packageSpec = `${packageName}@${version}`;
        try {
            log.debug('Installing Node.js dependency', { package: packageSpec });
            // Install packages in /sandbox/js-ts/node_modules
            await execAsync(`npm install --save ${packageSpec}`, {
                cwd: JS_TS_CODE_DIR,
                timeout: 120000, // 2 minutes per library
                env: {
                    ...process.env,
                    NODE_PATH: EXECUTION_DIRS.NODE_MODULES,
                },
            });

            installed.push(packageSpec);
            log.debug('Node.js dependency installed successfully', { package: packageSpec });
        } catch (error) {
            const err = error as Error;
            log.warning('Failed to install Node.js dependency', { package: packageSpec, error: err.message });
            failed.push({ library: packageSpec, error: err.message });
        }
    }

    const success = failed.length === 0;
    log.info('Node.js dependencies installation completed', { installed: installed.length, failed: failed.length });

    return { success, installed, failed };
};

/**
 * Install Python libraries via pip
 * Note: apify-client is pre-installed from Dockerfile
 * Requirements format: requirements.txt style string with one package per line
 * Example: "requests==2.31.0\npandas>=2.0.0\nnumpy"
 */
export const installPythonLibraries = async (
    requirementsTxt: string | undefined,
): Promise<{
    success: boolean;
    installed: string[];
    failed: { library: string; error: string }[];
}> => {
    if (!requirementsTxt || requirementsTxt.trim().length === 0) {
        log.debug('No Python requirements to install');
        return { success: true, installed: [], failed: [] };
    }

    // Parse requirements.txt format
    const requirements = requirementsTxt
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));

    if (requirements.length === 0) {
        log.debug('No Python requirements to install (after parsing)');
        return { success: true, installed: [], failed: [] };
    }

    log.info('Installing Python requirements', { count: requirements.length, requirements });

    const installed: string[] = [];
    const failed: { library: string; error: string }[] = [];

    // Ensure Python venv exists
    await initializePythonEnvironment();

    const pipBinary = path.join(EXECUTION_DIRS.PYTHON_BIN, 'pip');

    for (const requirement of requirements) {
        try {
            log.debug('Installing Python requirement', { requirement });
            await execAsync(`${pipBinary} install ${requirement}`, {
                timeout: 120000, // 2 minutes per requirement
            });

            installed.push(requirement);
            log.debug('Python requirement installed successfully', { requirement });
        } catch (error) {
            const err = error as Error;
            log.warning('Failed to install Python requirement', { requirement, error: err.message });
            failed.push({ library: requirement, error: err.message });
        }
    }

    const success = failed.length === 0;
    log.info('Python requirements installation completed', { installed: installed.length, failed: failed.length });

    return { success, installed, failed };
};

/**
 * Install skills via npx skills CLI
 * Skills are SKILL.md files that provide specialized instructions for AI agents
 * Uses: npx -y skills add --global --yes --all <skill>
 */
export const installSkills = async (
    skills: string[] | undefined,
): Promise<{
    success: boolean;
    installed: string[];
    failed: { skill: string; error: string }[];
}> => {
    if (!skills || skills.length === 0) {
        log.debug('No skills to install');
        return { success: true, installed: [], failed: [] };
    }

    log.info('Installing skills', { count: skills.length, skills });

    const installed: string[] = [];
    const failed: { skill: string; error: string }[] = [];

    for (const skill of skills) {
        try {
            log.debug('Installing skill', { skill });
            await execAsync(`npx -y skills add --global --yes --all ${skill}`, {
                timeout: 120000, // 2 minutes per skill
                cwd: SANDBOX_DIR,
            });

            installed.push(skill);
            log.debug('Skill installed successfully', { skill });
        } catch (error) {
            const err = error as Error;
            log.warning('Failed to install skill', { skill, error: err.message });
            failed.push({ skill, error: err.message });
        }
    }

    const success = failed.length === 0;
    log.info('Skills installation completed', { installed: installed.length, failed: failed.length });

    return { success, installed, failed };
};

/**
 * Setup complete execution environment
 * Initializes both Node.js and Python environments and installs specified dependencies and skills
 * In local mode (MODE=local), skips sandbox initialization
 */
export const setupExecutionEnvironment = async (input: {
    skills?: string[];
    nodeDependencies?: Record<string, string>;
    pythonRequirements?: string;
}): Promise<{
    success: boolean;
    skillsSetup: { success: boolean; installed: string[]; failed: { skill: string; error: string }[] };
    nodeSetup: { success: boolean; installed: string[]; failed: { library: string; error: string }[] };
    pythonSetup: { success: boolean; installed: string[]; failed: { library: string; error: string }[] };
    errors: string[];
}> => {
    const isLocalMode = process.env.MODE === 'local';

    log.info('Setting up complete execution environment', { mode: isLocalMode ? 'local' : 'production' });

    // In local mode, skip sandbox initialization and just return success
    if (isLocalMode) {
        log.info('Local mode detected - skipping sandbox environment setup');
        return {
            success: true,
            skillsSetup: { success: true, installed: [], failed: [] },
            nodeSetup: { success: true, installed: [], failed: [] },
            pythonSetup: { success: true, installed: [], failed: [] },
            errors: [],
        };
    }

    const errors: string[] = [];

    try {
        // Initialize both environments
        await Promise.all([initializeNodeEnvironment(), initializePythonEnvironment()]);
    } catch (error) {
        const err = error as Error;
        errors.push(`Environment initialization failed: ${err.message}`);
        log.error('Environment initialization failed', { error: err.message });
    }

    // Install skills and dependencies
    const [skillsSetup, nodeSetup, pythonSetup] = await Promise.all([
        installSkills(input.skills),
        installNodeLibraries(input.nodeDependencies),
        installPythonLibraries(input.pythonRequirements),
    ]);

    const success = errors.length === 0 && skillsSetup.success && nodeSetup.success && pythonSetup.success;

    log.info('Execution environment setup completed', {
        success,
        skillsInstalled: skillsSetup.installed.length,
        skillsFailed: skillsSetup.failed.length,
        nodeDependenciesInstalled: nodeSetup.installed.length,
        nodeDependenciesFailed: nodeSetup.failed.length,
        pythonRequirementsInstalled: pythonSetup.installed.length,
        pythonRequirementsFailed: pythonSetup.failed.length,
    });

    return {
        success,
        skillsSetup,
        nodeSetup,
        pythonSetup,
        errors,
    };
};

/**
 * User-supplied environment variables (parsed from the secret `envVars` input).
 * Held in module scope so all execution paths share the same source of truth.
 */
let userEnvVars: Record<string, string> = {};

/**
 * Set the user-supplied environment variables. Called once during startup
 * after parsing the actor input.
 */
export const setUserEnvVars = (vars: Record<string, string>): void => {
    userEnvVars = { ...vars };
};

/**
 * Get the parsed user-supplied environment variables (read-only copy).
 */
export const getUserEnvVars = (): Record<string, string> => ({ ...userEnvVars });

/**
 * Get environment variables for code execution
 * Returns environment with paths to Python venv and Node modules
 */
export const getExecutionEnvironment = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {};

    // Copy all environment variables
    Object.keys(process.env).forEach((key) => {
        env[key] = process.env[key];
    });

    // Layer in user-supplied vars before our infra paths so the sandbox
    // PATH/NODE_PATH/VIRTUAL_ENV/PYTHONHOME below always win.
    Object.assign(env, userEnvVars);

    // Add Python venv to PATH
    const currentPath = env.PATH || '';
    env.PATH = `${EXECUTION_DIRS.PYTHON_BIN}:${currentPath}`;

    // Add Node modules to PATH
    env.PATH = `${path.join(EXECUTION_DIRS.NODE_MODULES, '.bin')}:${env.PATH}`;

    // Set Node.js to find modules in js-ts/node_modules
    env.NODE_PATH = EXECUTION_DIRS.NODE_MODULES;

    // Set Python to use the venv
    env.VIRTUAL_ENV = EXECUTION_DIRS.PYTHON_VENV;
    env.PYTHONHOME = '';

    return env;
};

/**
 * Execute initialization bash script
 * Runs custom bash script in /sandbox directory to setup environment
 * In local mode (MODE=local), skips script execution
 */
export const executeInitScript = async (
    script: string,
): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}> => {
    const isLocalMode = process.env.MODE === 'local';
    log.debug('Executing init script', { scriptLength: script.length, mode: isLocalMode ? 'local' : 'production' });

    // In local mode, skip init script execution
    if (isLocalMode) {
        log.info('Local mode detected - skipping init script execution');
        return {
            success: true,
            stdout: '(skipped in local mode)',
            stderr: '',
            exitCode: 0,
        };
    }

    const tempFiles: string[] = [];

    try {
        // Validate script is not empty
        if (!script || script.trim().length === 0) {
            log.warning('Init script is empty');
            return {
                success: true,
                stdout: '',
                stderr: '',
                exitCode: 0,
            };
        }

        // Create temp file for script with unique ID
        const crypto = await import('node:crypto');
        const uniqueId = crypto.randomBytes(6).toString('hex');
        const tempFile = path.join('/tmp', `init-script-${uniqueId}.sh`);

        // Write script to temp file
        await fs.writeFile(tempFile, script, 'utf8');
        await fs.chmod(tempFile, 0o755);
        tempFiles.push(tempFile);

        log.debug('Init script written to temp file', { path: tempFile });

        // Execute script
        const execOptions: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {
            cwd: SANDBOX_DIR,
            timeout: INIT_SCRIPT_TIMEOUT,
            env: getExecutionEnvironment(),
        };

        const { stdout, stderr } = await execAsync(`bash ${tempFile}`, execOptions);

        log.info('Init script execution completed');
        log.info('-----------------------------------------');
        log.info(stdout || '(no output)');
        if (stderr) {
            log.warning(stderr);
        }
        log.info('-----------------------------------------');

        return {
            success: true,
            stdout,
            stderr,
            exitCode: 0,
        };
    } catch (error) {
        const err = error as { message: string; stdout?: string; stderr?: string; code?: number };
        log.error('Init script execution failed', { exitCode: err.code || 1 });
        log.error('-----------------------------------------');
        if (err.stdout) {
            log.error(err.stdout);
        }
        if (err.stderr) {
            log.error(err.stderr);
        }
        if (!err.stdout && !err.stderr) {
            log.error(err.message);
        }
        log.error('-----------------------------------------');

        return {
            success: false,
            stdout: err.stdout || '',
            stderr: err.stderr || err.message || 'Init script execution failed',
            exitCode: err.code || 1,
        };
    } finally {
        // Clean up temporary files
        for (const tempFile of tempFiles) {
            try {
                await fs.unlink(tempFile);
                log.debug('Cleaned up temp init script', { path: tempFile });
            } catch {
                log.debug('Failed to clean up temp init script', { path: tempFile });
            }
        }
    }
};
