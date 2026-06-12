/**
 * Bridges Module
 *
 * Manages bridge configuration (exposed path → local service) with file
 * watching for live updates. A bridge exposes a local server running inside
 * the sandbox at a public URL path on the container. The live reverse proxies
 * that serve bridged traffic react to these changes via onBridgesChange (see
 * bridge-proxy.ts).
 */

import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { log } from 'apify';

import { BRIDGES_PATH } from './consts.js';
import type { Bridge } from './types.js';

// Current bridges (in-memory cache)
let currentBridges: Bridge[] = [];

// Callbacks to notify when bridges change
const changeListeners: ((bridges: Bridge[]) => void)[] = [];

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
 * Save bridges to config file
 * @param bridges - Bridges to save
 */
export const saveBridges = (bridges: Bridge[]): void => {
    try {
        // Ensure directory exists
        const dir = dirname(BRIDGES_PATH);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        writeFileSync(BRIDGES_PATH, JSON.stringify(bridges, null, 2));
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

    // Debounce timeout
    let debounceTimer: NodeJS.Timeout | null = null;

    try {
        watch(dir, (eventType, filename) => {
            if (filename === '.bridges.json' && eventType === 'change') {
                // Debounce rapid changes
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }

                debounceTimer = setTimeout(() => {
                    try {
                        if (existsSync(BRIDGES_PATH)) {
                            const fileContent = readFileSync(BRIDGES_PATH, 'utf-8');
                            const newBridges = JSON.parse(fileContent);

                            // Only update if actually changed
                            if (JSON.stringify(newBridges) !== JSON.stringify(currentBridges)) {
                                currentBridges = newBridges;
                                log.info('Bridges config file changed, reloading', {
                                    count: currentBridges.length,
                                });
                                notifyListeners();
                            }
                        }
                    } catch (error) {
                        log.error('Error reloading bridges config', { error: (error as Error).message });
                    }
                }, 100);
            }
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
export const initializeBridges = (initialBridges?: Bridge[]): void => {
    // First try to load from config file (persisted state)
    if (existsSync(BRIDGES_PATH)) {
        try {
            const fileContent = readFileSync(BRIDGES_PATH, 'utf-8');
            currentBridges = JSON.parse(fileContent);
            log.info('Loaded bridges from config file', {
                count: currentBridges.length,
                bridges: currentBridges,
            });
        } catch (error) {
            log.warning('Failed to load bridges config file, using input bridges', {
                error: (error as Error).message,
            });
            currentBridges = initialBridges || [];
        }
    } else if (initialBridges && initialBridges.length > 0) {
        // Use input bridges and save to config file
        currentBridges = initialBridges;
        saveBridges(currentBridges);
        log.info('Initialized bridges from Actor input', {
            count: currentBridges.length,
            bridges: currentBridges,
        });
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
 * Add a bridge
 * @param bridge - Bridge with path and target URL
 */
export const addBridge = (bridge: Bridge): void => {
    // Normalize path to ensure it starts with /
    const normalizedPath = bridge.path.startsWith('/') ? bridge.path : `/${bridge.path}`;

    // Normalize target URL - add http:// if no protocol
    let normalizedTarget = bridge.target.trim();
    if (!normalizedTarget.startsWith('http://') && !normalizedTarget.startsWith('https://')) {
        normalizedTarget = `http://${normalizedTarget}`;
    }

    const normalizedBridge = { path: normalizedPath, target: normalizedTarget };

    // Check for duplicate paths
    const existingIndex = currentBridges.findIndex((b) => b.path === normalizedPath);
    if (existingIndex >= 0) {
        // Update existing bridge
        currentBridges[existingIndex] = normalizedBridge;
    } else {
        currentBridges.push(normalizedBridge);
    }

    saveBridges(currentBridges);
};

/**
 * Remove a bridge by path
 * @param path - Path to remove
 */
export const removeBridge = (path: string): boolean => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const initialLength = currentBridges.length;
    currentBridges = currentBridges.filter((b) => b.path !== normalizedPath);

    if (currentBridges.length < initialLength) {
        saveBridges(currentBridges);
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
