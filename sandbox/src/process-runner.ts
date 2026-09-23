/**
 * Child-process runner for /exec and the MCP `execute` tool.
 *
 * Replaces `child_process.exec`, which has two problems for this use:
 * - its `maxBuffer` (1 MB by default) KILLS the command once output exceeds
 *   it, so a chatty build or a large `cat` fails outright;
 * - its `timeout` signals only the direct child (`/bin/sh`), so grandchildren
 *   such as `sleep infinity` or a spawned server keep running and keep the
 *   stdio pipes open.
 *
 * Here output beyond the cap is drained and dropped (with a marker) while the
 * command keeps running, and the child is started as its own process-group
 * leader so a timeout kills the whole tree.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';

/** Default timeout when the caller does not pass one: the platform's 5-minute request ceiling. */
export const DEFAULT_EXEC_TIMEOUT_MS = 300_000;

/** Per-stream cap on captured stdout / stderr. */
export const MAX_EXEC_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Exit code reported for a timed-out run (same convention as GNU `timeout`). */
export const TIMEOUT_EXIT_CODE = 124;

/** Delay between SIGTERM and SIGKILL to the process group on timeout. */
const KILL_GRACE_MS = 2_000;

/**
 * After SIGKILL, give up waiting for the stdio pipes to close after this long.
 * A descendant that escaped the process group (e.g. via `setsid`) can hold
 * them open indefinitely; we must still respond.
 */
const CLOSE_AFTER_KILL_MS = 2_000;

export interface RunProcessOptions {
    cwd: string;
    env: NodeJS.ProcessEnv;
    /** Defaults to DEFAULT_EXEC_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Defaults to MAX_EXEC_OUTPUT_BYTES. */
    maxOutputBytes?: number;
}

export interface RunProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
}

/** Collects a stream's bytes up to `limit`, counting (but discarding) the rest. */
class CappedBuffer {
    private readonly chunks: Buffer[] = [];
    private kept = 0;
    private dropped = 0;

    constructor(private readonly limit: number) {}

    push(chunk: Buffer): void {
        const room = this.limit - this.kept;
        if (room >= chunk.length) {
            this.chunks.push(chunk);
            this.kept += chunk.length;
            return;
        }
        if (room > 0) {
            this.chunks.push(chunk.subarray(0, room));
            this.kept += room;
        }
        this.dropped += chunk.length - Math.max(room, 0);
    }

    toString(): string {
        const text = Buffer.concat(this.chunks).toString('utf8');
        if (this.dropped === 0) return text;
        return `${text}\n[output truncated: ${this.dropped} more bytes not shown]\n`;
    }
}

/**
 * Exit code for a finished process, using the shell's convention for signal
 * deaths (128 + signal number) so a caller can tell `kill -9` from `exit 1`.
 */
export const toExitCode = (code: number | null, signal: NodeJS.Signals | null): number => {
    if (typeof code === 'number') return code;
    const signum = signal ? os.constants.signals[signal] : undefined;
    return signum ? 128 + signum : 1;
};

/** Signal the child's whole process group, falling back to the child alone. */
const killGroup = (pid: number | undefined, signal: NodeJS.Signals): void => {
    if (!pid) return;
    try {
        process.kill(-pid, signal);
    } catch {
        try {
            process.kill(pid, signal);
        } catch {
            // Already gone.
        }
    }
};

/**
 * Run `file` with `args` and collect its output. Never rejects: spawn errors,
 * timeouts and non-zero exits are all reported through the result.
 */
export const runProcess = async (
    file: string,
    args: string[],
    options: RunProcessOptions,
): Promise<RunProcessResult> => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const stdout = new CappedBuffer(options.maxOutputBytes ?? MAX_EXEC_OUTPUT_BYTES);
    const stderr = new CappedBuffer(options.maxOutputBytes ?? MAX_EXEC_OUTPUT_BYTES);

    return new Promise((resolve) => {
        let settled = false;
        let timedOut = false;
        let spawnError: Error | undefined;
        const timers: NodeJS.Timeout[] = [];

        // `detached` makes the child a process-group leader, so killGroup()
        // reaches everything it spawns. stdin is closed: nothing can feed it,
        // and an inherited open pipe would make `cat` or `read` hang forever.
        const child = spawn(file, args, {
            cwd: options.cwd,
            env: options.env,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
            if (settled) return;
            settled = true;
            for (const timer of timers) clearTimeout(timer);

            let stderrText = stderr.toString();
            let exitCode = toExitCode(code, signal);
            if (spawnError) {
                // ENOENT here can also mean a missing cwd, so don't claim 127.
                stderrText += `Failed to start process in ${options.cwd}: ${spawnError.message}`;
                exitCode = 1;
            }
            if (timedOut) {
                stderrText += `${stderrText && !stderrText.endsWith('\n') ? '\n' : ''}[timed out after ${timeoutMs / 1000}s, process killed]\n`;
                exitCode = TIMEOUT_EXIT_CODE;
            }
            resolve({ stdout: stdout.toString(), stderr: stderrText, exitCode, timedOut });
        };

        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

        child.on('error', (err) => {
            // Spawn failure (e.g. ENOENT). `close` normally follows; settle
            // here too in case it does not.
            spawnError = err;
            if (child.pid === undefined) finish(null, null);
        });

        child.on('close', finish);

        timers.push(
            setTimeout(() => {
                timedOut = true;
                killGroup(child.pid, 'SIGTERM');
                timers.push(
                    setTimeout(() => {
                        killGroup(child.pid, 'SIGKILL');
                        timers.push(
                            setTimeout(() => {
                                child.stdout.destroy();
                                child.stderr.destroy();
                                finish(null, 'SIGKILL');
                            }, CLOSE_AFTER_KILL_MS),
                        );
                    }, KILL_GRACE_MS),
                );
            }, timeoutMs),
        );
    });
};
