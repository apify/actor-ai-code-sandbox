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

/**
 * ttyd command byte for terminal output. ttyd's WebSocket subprotocol prefixes
 * every server→client message with a one-byte command; '0' (0x30) means "write
 * the rest straight to the terminal".
 */
const TTYD_OUTPUT_COMMAND = 0x30; // '0'

/** WebSocket header byte: FIN set, opcode 0x2 (binary frame). */
const WS_FIN_BINARY = 0x82;

/**
 * Encode text as a ttyd output message inside a single binary WebSocket frame,
 * ready to write straight to a browser's terminal socket.
 *
 * The terminal is served through a proxy (browser ↔ this Actor ↔ ttyd). When the
 * Actor stops, the proxy stops with it, so relaying a banner the long way round
 * (PTY → ttyd → proxy → browser) usually loses the race against process exit.
 * Writing a ready-made frame directly to the browser-facing socket hands the
 * bytes to the kernel immediately, so they reach the terminal even if the
 * process exits a moment later.
 *
 * Server→client frames are never masked (RFC 6455 §5.1), so the frame is just a
 * FIN+binary header, the payload length, and the payload (command byte + text).
 *
 * @param text - Text to display in the terminal. Use `\r\n` line breaks.
 * @returns The encoded WebSocket frame.
 */
export const encodeTtydOutputMessage = (text: string): Buffer => {
    const payload = Buffer.concat([Buffer.from([TTYD_OUTPUT_COMMAND]), Buffer.from(text, 'utf8')]);
    const len = payload.length;

    let header: Buffer;
    if (len < 126) {
        header = Buffer.from([WS_FIN_BINARY, len]);
    } else if (len < 0x10000) {
        // 126 signals a 16-bit length follows.
        // eslint-disable-next-line no-bitwise -- splitting the length into bytes needs shifts/masks
        header = Buffer.from([WS_FIN_BINARY, 126, (len >> 8) & 0xff, len & 0xff]);
    } else {
        // 127 signals a 64-bit length follows.
        header = Buffer.alloc(10);
        header[0] = WS_FIN_BINARY;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }

    return Buffer.concat([header, payload]);
};
