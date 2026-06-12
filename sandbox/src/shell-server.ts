/**
 * Interactive shell backend: supervises the ttyd process and proxies /shell
 * traffic (HTTP and WebSocket) to it.
 *
 * The pure decision logic lives in sibling modules so it can be unit-tested:
 *   - ttyd.ts          — restart backoff, crash detection, output capture
 *   - shell-launch.ts  — `?launch=<cmd>` → ttyd `?arg=...` URL translation
 *   - templates/shell.ts — bashrc/welcome scripts and the reconnect overlay
 *
 * There is deliberately no server-side shutdown banner. Most stops (run
 * timeout, hard abort, platform scale-down) kill the container with a signal
 * and no advance event — the Apify SDK installs no SIGTERM/SIGINT handlers,
 * it's driven by the platform events WebSocket — and a dying process can't
 * reliably flush a message to the browser anyway. Instead the terminal page
 * relabels ttyd's own reconnect overlay client-side; see
 * injectTerminalReconnectScript (it shows "Actor probably finished" when a
 * retry fails).
 */
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import http from 'node:http';
import type { Duplex } from 'node:stream';

import { log } from 'apify';
import type { Express, Request, Response } from 'express';
import httpProxy from 'http-proxy';

import { SANDBOX_DIR } from './consts.js';
import { touchActivity } from './idle.js';
import { translateLaunchParam } from './shell-launch.js';
import { injectTerminalReconnectScript, SANDBOX_BASHRC, WELCOME_SCRIPT } from './templates/shell.js';
import {
    appendTtydOutput,
    buildShellUnavailableMessage,
    isTtydStartupCrash,
    nextTtydRestartDelayMs,
    TTYD_RESTART_MIN_MS,
} from './ttyd.js';

const SHELL_PORT = 7681;

// ttyd's last words: the tail of its stdout/stderr (or a spawn error). Recorded
// so a crash — e.g. a missing shared library — shows up in the Actor log and in
// the /shell proxy response instead of a bare exit code. The delay grows as ttyd
// keeps failing to start (see nextTtydRestartDelayMs).
let lastTtydError = '';
let ttydRestartDelayMs = TTYD_RESTART_MIN_MS;

/**
 * Write the rcfile and welcome script that ttyd's bash sessions source.
 * Must run before spawnTtyd().
 */
const writeShellFiles = (): void => {
    try {
        log.info('Writing shell environment files...');
        mkdirSync('/app', { recursive: true });
        writeFileSync('/app/welcome.sh', WELCOME_SCRIPT);
        chmodSync('/app/welcome.sh', 0o755);
        writeFileSync('/app/sandbox_bashrc', SANDBOX_BASHRC);
        log.info('Shell environment files written successfully');
    } catch (err) {
        log.error('Failed to write shell environment files', { error: (err as Error).message });
    }
};

/** Spawn ttyd, restarting it whenever it exits (with backoff on startup crashes). */
const spawnTtyd = (): void => {
    log.info('Spawning ttyd process...', { port: SHELL_PORT });
    const startedAt = Date.now();

    // Run ttyd with custom bashrc for better UX and environment alignment. Pipe
    // its stdio (rather than ignoring it) so a startup failure is captured.
    const ttyd = spawn('ttyd', ['-p', SHELL_PORT.toString(), '-a', '-W', 'bash', '--rcfile', '/app/sandbox_bashrc'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: SANDBOX_DIR,
        env: { ...process.env },
    });

    // Keep only the tail of ttyd's output — its startup/error messages are short.
    let recentOutput = '';
    const capture = (chunk: Buffer): void => {
        recentOutput = appendTtydOutput(recentOutput, chunk.toString());
    };
    ttyd.stdout?.on('data', capture);
    ttyd.stderr?.on('data', capture);

    // Schedule exactly one restart per spawn: a failed spawn emits 'error' (no
    // 'exit'), a started process emits 'exit'; guard against both firing.
    let settled = false;
    const restartAfter = (crashed: boolean): void => {
        if (settled) return;
        settled = true;
        const delay = crashed ? ttydRestartDelayMs : TTYD_RESTART_MIN_MS;
        ttydRestartDelayMs = nextTtydRestartDelayMs(ttydRestartDelayMs, crashed);
        setTimeout(spawnTtyd, delay);
    };

    ttyd.on('error', (err) => {
        lastTtydError = err.message;
        log.error('Failed to start ttyd', { error: err.message });
        restartAfter(true);
    });

    ttyd.on('exit', (code, signal) => {
        const aliveMs = Date.now() - startedAt;
        const output = recentOutput.trim();
        if (output) lastTtydError = output;

        // A fast exit means ttyd never really came up (missing shared library,
        // port already bound, bad args). Shout, since the old fixed-5s retry with
        // no detail produced an invisible crash loop behind "Shell Proxy Error".
        const crashed = isTtydStartupCrash(aliveMs);
        if (crashed) {
            log.error('ttyd exited immediately — interactive shell is unavailable', {
                code,
                signal,
                aliveMs,
                output: output || '(no output captured)',
            });
        } else {
            log.warning('ttyd process exited; restarting', { code, signal, aliveMs });
        }
        restartAfter(crashed);
    });
};

/** Write the shell environment files and start (and keep restarting) ttyd. */
export const startShellBackend = (): void => {
    writeShellFiles();
    spawnTtyd();
};

/** Strip the /shell prefix and translate `?launch=` into ttyd's `?arg=` form. */
const toTtydUrl = (url: string): string => {
    let path = url.replace(/^\/shell/, '') || '/';
    // Ensure path starts with / (handle query strings like ?arg=...)
    if (path.startsWith('?')) {
        path = `/${path}`;
    }
    return translateLaunchParam(path);
};

/** Manual HTTP proxy handler for ttyd. */
const proxyShellRequest = (req: Request, res: Response): void => {
    // Ask ttyd for an uncompressed response so the terminal HTML can be rewritten
    // (see injectTerminalReconnectScript below). ttyd's assets are tiny, so losing
    // gzip here is negligible.
    const headers = { ...req.headers, 'accept-encoding': 'identity' };
    const options = {
        hostname: '127.0.0.1',
        port: SHELL_PORT,
        path: toTtydUrl(req.url),
        method: req.method,
        headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
        // Inject the client-side reconnect notice into ttyd's terminal page. The
        // server can't reliably push a shutdown message as the container is killed,
        // so the browser relabels ttyd's reconnect overlay instead. Only the HTML
        // document is rewritten; every other asset and status is piped through.
        const isHtml = (proxyRes.headers['content-type'] || '').includes('text/html');
        if (!isHtml) {
            if (proxyRes.statusCode) {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
            }
            proxyRes.pipe(res);
            return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
            const html = injectTerminalReconnectScript(Buffer.concat(chunks).toString('utf8'));
            const outHeaders = { ...proxyRes.headers };
            // The body length changed and is now fixed: drop any stale length/
            // encoding framing and set the real one.
            delete outHeaders['content-encoding'];
            delete outHeaders['transfer-encoding'];
            outHeaders['content-length'] = Buffer.byteLength(html).toString();
            res.writeHead(proxyRes.statusCode || 200, outHeaders);
            res.end(html);
        });
        proxyRes.on('error', (err) => {
            log.error('Shell proxy response error', { error: err.message });
            if (!res.headersSent) res.status(502).type('text/plain').send('Shell proxy error');
        });
    });

    proxyReq.on('error', (err) => {
        // ECONNREFUSED means ttyd isn't listening — it almost always crashed on
        // startup (see spawnTtyd, which records its last output in lastTtydError).
        // Surface that as a 503 instead of an opaque 500 so the cause is visible.
        const ttydDown = (err as NodeJS.ErrnoException).code === 'ECONNREFUSED';
        log.error('Shell proxy error', { error: err.message, ttydDown });
        if (!res.headersSent) {
            if (ttydDown) {
                res.status(503).type('text/plain').send(buildShellUnavailableMessage(lastTtydError));
            } else {
                res.status(502).type('text/plain').send(`Shell proxy error: ${err.message}`);
            }
        }
    });

    req.pipe(proxyReq);
};

/** Register the /shell HTTP proxy routes on the Express app. */
export const registerShellRoutes = (app: Express): void => {
    app.all('/shell{*rest}', proxyShellRequest);
};

// WebSocket proxy for ttyd's terminal connection. Without the error handler, a
// WebSocket upgrade to a down ttyd emits an 'error' with no listener, which
// Node escalates to an uncaught exception that can take down the whole server.
// ttyd is restarted by spawnTtyd; just close the browser socket so the terminal
// shows its reconnect overlay and retries.
const wsProxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:${SHELL_PORT}`,
    ws: true,
});

wsProxy.on('error', (err, _req, resOrSocket) => {
    log.warning('Shell WebSocket proxy error', { error: (err as Error).message });
    const socket = resOrSocket as Duplex | undefined;
    if (socket && typeof socket.destroy === 'function' && !socket.destroyed) {
        socket.destroy();
    }
});

/**
 * Proxy a /shell WebSocket upgrade to ttyd. Returns false (untouched request)
 * for non-shell URLs so the caller can try other upgrade handlers.
 */
export const handleShellUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    if (!req.url?.startsWith('/shell')) return false;

    req.url = toTtydUrl(req.url);
    log.info('Proxying shell WebSocket upgrade', { url: req.url });

    // Terminal keystrokes count as sandbox activity.
    socket.on('data', touchActivity);

    wsProxy.ws(req, socket, head);
    return true;
};
