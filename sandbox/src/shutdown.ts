/**
 * Terminal shutdown notifications.
 *
 * The browser terminal is served by ttyd, which spawns bash on a PTY (one slave
 * device under /dev/pts per connected browser). When the container stops, ttyd
 * dies and the WebSocket drops, at which point the client only shows its
 * "Press ⏎ to Reconnect" overlay. To tell the user *why* the session ended, we
 * write a banner to the PTY slave devices first: bytes written there reach the
 * PTY master, which ttyd forwards to the browser, so the text shows up in the
 * live terminal before it disconnects.
 */

import { closeSync, constants, openSync, readdirSync, writeSync } from 'node:fs';

/** Directory holding PTY slave devices for connected terminal sessions. */
const PTS_DIR = '/dev/pts';

/**
 * Write a message to every active terminal session.
 *
 * Safe to call when nothing is connected: if the directory is missing or empty
 * (e.g. no open terminals) it is a no-op. Individual write failures are ignored
 * so one stuck terminal can't block the others or the shutdown itself.
 *
 * @param message - Raw bytes to write. Use `\r\n` line breaks: terminals are in
 *   raw mode, so a bare `\n` would not return the cursor to column 0.
 * @param ptsDir - PTY device directory; overridable for testing.
 */
export const broadcastToTerminals = (message: string, ptsDir: string = PTS_DIR): void => {
    let entries: string[];
    try {
        entries = readdirSync(ptsDir);
    } catch {
        // No /dev/pts (or unreadable) — nothing to notify.
        return;
    }

    for (const entry of entries) {
        // Slave devices are numeric (e.g. "0", "1"); skip "ptmx" and anything else.
        if (!/^\d+$/.test(entry)) continue;

        try {
            // O_NONBLOCK so a terminal whose buffer is full can't stall shutdown.
            // eslint-disable-next-line no-bitwise -- combining open() flags requires bitwise OR
            const fd = openSync(`${ptsDir}/${entry}`, constants.O_WRONLY | constants.O_NONBLOCK);
            try {
                writeSync(fd, message);
            } finally {
                closeSync(fd);
            }
        } catch {
            // Terminal may have disconnected between readdir and write — ignore.
        }
    }
};

/**
 * Build the banner shown in open terminals when the Actor stops.
 *
 * @param reason - Human-readable explanation of why the Actor is stopping.
 * @param runId - Actor run ID used to build a "restart" link (omitted if absent).
 * @returns ANSI-styled text with `\r\n` line breaks, ready to write to a terminal.
 */
export const buildShutdownBanner = (reason: string, runId?: string): string => {
    const BOLD_YELLOW = '\x1b[1;33m';
    const CYAN = '\x1b[0;36m';
    const DIM = '\x1b[2m';
    const RESET = '\x1b[0m';
    const RULE = '='.repeat(52);

    const lines: string[] = [
        '',
        `${BOLD_YELLOW}${RULE}${RESET}`,
        `${BOLD_YELLOW}Apify AI Sandbox is shutting down${RESET}`,
        '',
        reason,
    ];

    if (runId) {
        lines.push(
            '',
            `${DIM}Restart the Actor to start a new session:${RESET}`,
            `${CYAN}https://console.apify.com/view/runs/${runId}${RESET}`,
        );
    }

    lines.push(`${BOLD_YELLOW}${RULE}${RESET}`, '');

    return `${lines.join('\r\n')}\r\n`;
};
