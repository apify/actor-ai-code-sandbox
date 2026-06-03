/**
 * Supervision helpers for the ttyd process that backs the interactive /shell
 * terminal. The process is spawned and restarted in main.ts; the pure decision
 * logic lives here so it can be unit-tested without spawning a real process.
 *
 * Why this exists: ttyd used to be spawned with `stdio: 'ignore'` and restarted
 * on a fixed 5s timer, so a startup failure (e.g. a missing shared library —
 * the libuv regression that broke the shell) surfaced only as a repeating
 * "ttyd process exited {code:1}" with no reason, while the /shell proxy returned
 * an opaque 500 "Shell Proxy Error". These helpers support capturing ttyd's
 * output, backing off between restarts, and telling the user why the shell is
 * down.
 */

/** Restart backoff bounds (ms). */
export const TTYD_RESTART_MIN_MS = 1000;
export const TTYD_RESTART_MAX_MS = 30000;

/**
 * An exit within this window of startup means ttyd never really came up (bad
 * args, missing shared library, port already in use) rather than a long-lived
 * server that later died. We back off and log loudly in that case.
 */
export const TTYD_CRASH_WINDOW_MS = 2000;

/** How many characters of ttyd's recent stdout/stderr to retain for diagnostics. */
export const TTYD_OUTPUT_LIMIT = 2048;

/** True if ttyd exited fast enough to count as a startup crash rather than a normal exit. */
export const isTtydStartupCrash = (aliveMs: number): boolean => aliveMs < TTYD_CRASH_WINDOW_MS;

/**
 * The delay to use the next time ttyd needs restarting. Startup crashes back off
 * exponentially up to the cap, so a permanently broken ttyd doesn't spam the log;
 * a process that ran for a while before exiting resets to the minimum so it
 * recovers promptly.
 */
export const nextTtydRestartDelayMs = (currentDelayMs: number, isCrash: boolean): number => {
    if (!isCrash) return TTYD_RESTART_MIN_MS;
    const doubled = Math.max(currentDelayMs, TTYD_RESTART_MIN_MS) * 2;
    return Math.min(doubled, TTYD_RESTART_MAX_MS);
};

/** Append a chunk to the rolling output buffer, keeping only the last `limit` characters. */
export const appendTtydOutput = (buffer: string, chunk: string, limit = TTYD_OUTPUT_LIMIT): string =>
    (buffer + chunk).slice(-limit);

/**
 * Plain-text body returned by the /shell proxy when ttyd isn't reachable. Includes
 * ttyd's last output when we have it, so the cause (e.g. a missing shared library)
 * is visible in the browser instead of an opaque error.
 */
export const buildShellUnavailableMessage = (lastTtydOutput: string): string => {
    const lines = ['Interactive shell is not available — the terminal backend (ttyd) is not running.'];
    const detail = lastTtydOutput.trim();
    if (detail) {
        lines.push('', 'Last ttyd output:', detail);
    }
    lines.push(
        '',
        'The sandbox keeps trying to restart it — reload this page in a few seconds.',
        'If the problem persists, check the Actor run log.',
    );
    return `${lines.join('\n')}\n`;
};
