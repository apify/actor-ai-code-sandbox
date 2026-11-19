/**
 * Bridges Module
 *
 * Manages bridge configuration (exposed path → local service) with file
 * watching for live updates. A bridge exposes a local server running inside
 * the sandbox at a public URL path on the container. The live reverse proxies
 * that serve bridged traffic react to these changes via onBridgesChange (see
 * bridge-proxy.ts).
 *
 * Every bridge, whether it comes from the API, the Actor input or
 * /sandbox/.bridges.json, goes through normalizeBridge(), so the in-memory list
 * always holds normalized, validated entries.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { log } from 'apify';

import { BRIDGES_PATH } from './consts.js';
import type { Bridge } from './types.js';

/**
 * Paths served by the sandbox itself. A bridge on one of these (or below one)
 * would never receive traffic, because explicit endpoints are registered
 * before the bridge handler.
 */
export const RESERVED_BRIDGE_PATHS = ['/fs', '/exec', '/mcp', '/shell', '/bridges', '/health', '/browse', '/llms.txt'];

/** Thrown for a bridge definition that fails validation (a 400 at the API). */
export class BridgeValidationError extends Error {}

// Current bridges (in-memory cache)
let currentBridges: Bridge[] = [];

// Callbacks to notify when bridges change
const changeListeners: ((bridges: Bridge[]) => void)[] = [];

/**
 * Normalize an exposed bridge path: ensure a leading `/` and drop trailing
 * slashes, so `app/` and `/app` name the same bridge.
 */
export const normalizeBridgePath = (path: string): string => {
    const trimmed = path.trim().replace(/\/+$/, '');
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

/** True if `path` is a reserved sandbox endpoint or lies below one. */
const isReservedPath = (path: string): boolean => {
    // Express routing is case-insensitive, so `/FS` would hit the /fs router.
    const lower = path.toLowerCase();
    // `/shell{*rest}` matches any path starting with `/shell`, not just `/shell/...`.
    if (lower.startsWith('/shell')) return true;
    return RESERVED_BRIDGE_PATHS.some((reserved) => lower === reserved || lower.startsWith(`${reserved}/`));
};

/**
 * Validate and normalize one bridge definition.
 * @param input - Untrusted bridge object (API body, Actor input or config file entry)
 * @throws BridgeValidationError when the path or target is unusable
 */
export const normalizeBridge = (input: unknown): Bridge => {
    const { path, target } = (input ?? {}) as Record<string, unknown>;

    if (typeof path !== 'string' || !path.trim()) {
        throw new BridgeValidationError('path is required (e.g., /myapp)');
    }
    const normalizedPath = normalizeBridgePath(path);
    if (normalizedPath === '/') {
        throw new BridgeValidationError('path must not be the root path "/"');
    }
    if (/[?#\s]/.test(normalizedPath)) {
        throw new BridgeValidationError(`path must not contain whitespace, "?" or "#": ${normalizedPath}`);
    }
    if (isReservedPath(normalizedPath)) {
        throw new BridgeValidationError(
            `path ${normalizedPath} is reserved by the sandbox (${RESERVED_BRIDGE_PATHS.join(', ')})`,
        );
    }

    if (typeof target !== 'string' || !target.trim()) {
        throw new BridgeValidationError('target is required (full URL like http://127.0.0.1:3000/myapp)');
    }
    let normalizedTarget = target.trim();
    if (!/^https?:\/\//i.test(normalizedTarget)) {
        normalizedTarget = `http://${normalizedTarget}`;
    }
    try {
        // Parse only to validate; keep the user's spelling (e.g. trailing slash).
        new URL(normalizedTarget); // eslint-disable-line no-new
    } catch {
        throw new BridgeValidationError(`target is not a valid URL: ${target}`);
    }

    return { path: normalizedPath, target: normalizedTarget };
};

/** Keep the last definition for each path, preserving first-seen order. */
const dedupeByPath = (bridges: Bridge[]): Bridge[] => {
    const byPath = new Map<string, Bridge>();
    for (const bridge of bridges) {
        byPath.set(bridge.path, bridge);
    }
    return [...byPath.values()];
};

/**
 * Strictly parse a full bridge list (PUT /bridges): any invalid entry rejects
 * the whole list.
 * @throws BridgeValidationError naming the offending entry
 */
export const parseBridgeList = (input: unknown): Bridge[] => {
    if (!Array.isArray(input)) {
        throw new BridgeValidationError('bridges must be an array');
    }
    return dedupeByPath(
        input.map((entry, index) => {
            try {
                return normalizeBridge(entry);
            } catch (error) {
                throw new BridgeValidationError(`bridges[${index}]: ${(error as Error).message}`);
            }
        }),
    );
};

/**
 * Leniently parse a bridge list from the config file or Actor input: invalid
 * entries are skipped with a warning so one bad entry doesn't drop the rest.
 * @throws Error when the value is not an array at all
 */
const loadBridgeList = (input: unknown, source: string): Bridge[] => {
    if (!Array.isArray(input)) {
        throw new Error(`${source}: expected an array of bridges`);
    }
    const bridges: Bridge[] = [];
    for (const [index, entry] of input.entries()) {
        try {
            bridges.push(normalizeBridge(entry));
        } catch (error) {
            log.warning('Skipping invalid bridge', { source, index, error: (error as Error).message });
        }
    }
    return dedupeByPath(bridges);
};

const readBridgesFile = (): Bridge[] => loadBridgeList(JSON.parse(readFileSync(BRIDGES_PATH, 'utf-8')), BRIDGES_PATH);

/**
 * Notify all listeners of bridge changes
 */
const notifyListeners = (): void => {
    for (const listener of changeListeners) {
        try {
            listener([...currentBridges]);
        } catch (error) {
            log.error('Error in bridges change listener', { error: (error as Error).message });
        }
    }
};

/**
 * Save already-normalized bridges to the config file and notify listeners.
 * Writes to a temp file and renames it into place, so the file watcher never
 * reads a half-written file.
 * @param bridges - Bridges to save
 */
const saveBridges = (bridges: Bridge[]): void => {
    try {
        // Ensure directory exists
        const dir = dirname(BRIDGES_PATH);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        const tmpPath = `${BRIDGES_PATH}.${process.pid}.tmp`;
        writeFileSync(tmpPath, JSON.stringify(bridges, null, 2));
        renameSync(tmpPath, BRIDGES_PATH);
        currentBridges = bridges;
        log.info('Saved bridges to config file', {
            count: bridges.length,
            path: BRIDGES_PATH,
        });

        // Notify listeners
        notifyListeners();
    } catch (error) {
        log.error('Failed to save bridges', { error: (error as Error).message });
        throw error;
    }
};

/**
 * Start watching the config file for external changes
 */
const startBridgesWatcher = (): void => {
    // Ensure directory exists before watching
    const dir = dirname(BRIDGES_PATH);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const fileName = basename(BRIDGES_PATH);

    // Debounce timeout
    let debounceTimer: NodeJS.Timeout | null = null;

    try {
        // Editors and our own saveBridges() replace the file atomically, which
        // shows up as 'rename' rather than 'change', so react to both.
        watch(dir, (_eventType, filename) => {
            if (filename !== fileName) return;

            // Debounce rapid changes
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            debounceTimer = setTimeout(() => {
                try {
                    // A deletion (or the first half of a rename) leaves nothing to load.
                    if (!existsSync(BRIDGES_PATH)) return;
                    const newBridges = readBridgesFile();

                    // Only update if actually changed
                    if (JSON.stringify(newBridges) !== JSON.stringify(currentBridges)) {
                        currentBridges = newBridges;
                        log.info('Bridges config file changed, reloading', {
                            count: currentBridges.length,
                        });
                        notifyListeners();
                    }
                } catch (error) {
                    log.error('Error reloading bridges config, keeping current bridges', {
                        error: (error as Error).message,
                    });
                }
            }, 100);
        });

        log.info('Started watching bridges config file for changes', { path: BRIDGES_PATH });
    } catch (error) {
        log.warning('Failed to start bridges config file watcher', { error: (error as Error).message });
    }
};

/**
 * Initialize bridges from input and start file watching
 * @param initialBridges - Initial bridges from Actor input
 */
export const initializeBridges = (initialBridges?: unknown[]): void => {
    const inputBridges = (): Bridge[] => {
        if (!initialBridges) return [];
        try {
            return loadBridgeList(initialBridges, 'Actor input');
        } catch (error) {
            log.warning('Ignoring invalid bridges input', { error: (error as Error).message });
            return [];
        }
    };

    // First try to load from config file (persisted state)
    if (existsSync(BRIDGES_PATH)) {
        try {
            currentBridges = readBridgesFile();
            log.info('Loaded bridges from config file', {
                count: currentBridges.length,
                bridges: currentBridges,
            });
        } catch (error) {
            log.warning('Failed to load bridges config file, using input bridges', {
                error: (error as Error).message,
            });
            currentBridges = inputBridges();
        }
    } else {
        const bridges = inputBridges();
        if (bridges.length > 0) {
            // Use input bridges and save to config file
            saveBridges(bridges);
            log.info('Initialized bridges from Actor input', {
                count: currentBridges.length,
                bridges: currentBridges,
            });
        }
    }

    // Start watching config file for changes
    startBridgesWatcher();
};

/**
 * Get current bridges
 */
export const getBridges = (): Bridge[] => {
    return [...currentBridges];
};

/**
 * Replace all bridges.
 * @param input - Untrusted bridge list
 * @throws BridgeValidationError when any entry is invalid (nothing is saved)
 */
export const replaceBridges = (input: unknown): void => {
    saveBridges(parseBridgeList(input));
};

/**
 * Add a bridge, or update the one already exposed at the same path.
 * @param input - Untrusted bridge with path and target URL
 * @throws BridgeValidationError when the bridge is invalid
 */
export const addBridge = (input: unknown): void => {
    const bridge = normalizeBridge(input);
    const exists = currentBridges.some((b) => b.path === bridge.path);
    saveBridges(
        exists ? currentBridges.map((b) => (b.path === bridge.path ? bridge : b)) : [...currentBridges, bridge],
    );
};

/**
 * Remove a bridge by path
 * @param path - Path to remove
 */
export const removeBridge = (path: string): boolean => {
    const normalizedPath = normalizeBridgePath(path);
    const remaining = currentBridges.filter((b) => b.path !== normalizedPath);

    if (remaining.length < currentBridges.length) {
        saveBridges(remaining);
        return true;
    }
    return false;
};

/**
 * Register a callback to be called when bridges change
 * @param callback - Function to call with new bridges
 */
export const onBridgesChange = (callback: (bridges: Bridge[]) => void): void => {
    changeListeners.push(callback);
};
