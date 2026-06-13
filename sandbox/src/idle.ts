/**
 * Activity tracking and idle auto-shutdown.
 *
 * Every part of the server that counts as "someone is using the sandbox" —
 * HTTP requests, shell WebSocket traffic, bridged requests — calls
 * touchActivity(). Once the idle monitor is started, the Actor exits after
 * the configured period with no activity (0 disables the shutdown entirely).
 */
import { Actor, log } from 'apify';

import { DEFAULT_IDLE_TIMEOUT_SECS } from './consts.js';
import { setStatusMessage } from './status.js';

/** How often the idle monitor checks for inactivity. */
const IDLE_CHECK_INTERVAL_MS = 30000;

let lastActivityAt = Date.now();
let idleTimeoutSecs = DEFAULT_IDLE_TIMEOUT_SECS;

/** Record activity now, pushing back the idle-shutdown timer. */
export const touchActivity = (): void => {
    lastActivityAt = Date.now();
};

/** Set the idle timeout (seconds; 0 disables auto-shutdown). Call once at startup. */
export const configureIdleTimeout = (secs: number | undefined): void => {
    idleTimeoutSecs = secs ?? DEFAULT_IDLE_TIMEOUT_SECS;
};

/** The configured idle timeout in seconds (0 = disabled). */
export const getIdleTimeoutSecs = (): number => idleTimeoutSecs;

/** Seconds left until idle shutdown, or null when auto-shutdown is disabled. */
export const getRemainingSecs = (): number | null => {
    if (idleTimeoutSecs <= 0) return null;
    const elapsedSecs = Math.floor((Date.now() - lastActivityAt) / 1000);
    return Math.max(0, idleTimeoutSecs - elapsedSecs);
};

/**
 * Start the periodic inactivity check that exits the Actor once the timeout
 * elapses. No-op when the timeout is disabled.
 */
export const startIdleMonitor = (): void => {
    if (idleTimeoutSecs <= 0) return;

    log.info(`Idle timeout monitor started (${idleTimeoutSecs}s)`);
    touchActivity();
    setInterval(async () => {
        const idleTimeMs = Date.now() - lastActivityAt;
        if (idleTimeMs > idleTimeoutSecs * 1000) {
            const message = `Sandbox shut down after ${Math.round(idleTimeoutSecs)} seconds of inactivity.`;
            log.warning(message);
            await setStatusMessage('Sandbox is shutting down');
            await Actor.exit({ statusMessage: message });
        }
    }, IDLE_CHECK_INTERVAL_MS);
};
