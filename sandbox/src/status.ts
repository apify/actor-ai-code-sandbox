// Run status message reporting for the Apify Console.
import { Actor, log } from 'apify';

const isLocalMode = process.env.MODE === 'local';

/**
 * Update the Actor run's status message shown in the Apify Console so each
 * lifecycle stage is visible at a glance (installing dependencies, running the
 * setup script, live, shutting down).
 *
 * Best-effort by design: a failed status update — or running locally with no
 * platform run to report to — must never interrupt startup or shutdown, so the
 * call is swallowed and only logged.
 */
export const setStatusMessage = async (message: string): Promise<void> => {
    if (isLocalMode) return;
    try {
        await Actor.setStatusMessage(message);
    } catch (err) {
        log.warning('Failed to set Actor status message', { message, error: (err as Error).message });
    }
};
