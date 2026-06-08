/**
 * Application Constants
 */

/**
 * Default sandbox working directory
 */
export const SANDBOX_DIR = '/sandbox';

/**
 * Python code execution directory
 */
export const PYTHON_CODE_DIR = '/sandbox/py';

/**
 * JavaScript/TypeScript code execution directory
 */
export const JS_TS_CODE_DIR = '/sandbox/js-ts';

/**
 * Node.js modules directory (inside js-ts for language isolation)
 */
export const NODE_MODULES_DIR = '/sandbox/js-ts/node_modules';

/**
 * Python virtual environment directory (inside py for language isolation)
 */
export const PYTHON_VENV_DIR = '/sandbox/py/venv';

/**
 * Python binary directory (inside venv)
 */
export const PYTHON_BIN_DIR = '/sandbox/py/venv/bin';

/**
 * Default idle timeout in seconds (15 minutes). The container shuts down
 * automatically after this much inactivity unless overridden via the
 * `idleTimeoutSecs` input. Set to 0 to disable.
 */
export const DEFAULT_IDLE_TIMEOUT_SECS = 900;

/**
 * Init script execution timeout (5 minutes)
 */
export const INIT_SCRIPT_TIMEOUT_MS = 300000;

/**
 * How often to log a heartbeat while the init script is running (30 seconds),
 * so long, quiet steps (e.g. `npm install`) don't look like a hang.
 */
export const INIT_SCRIPT_HEARTBEAT_INTERVAL_MS = 30000;

/**
 * Migration persistence constants
 */

/**
 * Startup marker file to track filesystem changes
 */
export const STARTUP_MARKER_PATH = '/tmp/.actor_startup_marker';

/**
 * Key-Value Store keys for migration state
 */
export const KV_MIGRATION_MANIFEST = 'migration-manifest';
export const KV_MIGRATION_TARBALL = 'migration-tarball';

/**
 * Baseline package files (created at Docker build time)
 */
export const BASELINE_PIP_FREEZE = '/app/.baseline-pip-freeze.txt';
export const BASELINE_DPKG = '/app/.baseline-dpkg.txt';

/**
 * Paths to exclude from migration backup
 */
export const MIGRATION_EXCLUDED_PATHS = [
    '/proc',
    '/sys',
    '/dev',
    '/run',
    '/tmp',
    '/var/cache/apt',
    '/var/lib/apt/lists',
    '/var/lib/dpkg', // Exclude dpkg database - we reinstall packages from apt history instead
    '/sandbox/js-ts/node_modules',
    '/sandbox/py/venv',
];

/**
 * Bridges configuration file path
 */
export const BRIDGES_PATH = '/sandbox/.bridges.json';
