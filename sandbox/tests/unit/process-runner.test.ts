/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runProcess, TIMEOUT_EXIT_CODE, toExitCode } from '../../src/process-runner.js';

const sh = async (command: string, opts: { timeoutMs?: number; maxOutputBytes?: number } = {}) =>
    runProcess('/bin/sh', ['-c', command], { cwd: '/tmp', env: process.env, ...opts });

describe('toExitCode', () => {
    it('passes numeric exit statuses through', () => {
        assert.equal(toExitCode(0, null), 0);
        assert.equal(toExitCode(127, null), 127);
    });

    it('maps a signal death to 128 + signal number', () => {
        assert.equal(toExitCode(null, 'SIGKILL'), 137);
        assert.equal(toExitCode(null, 'SIGTERM'), 143);
    });

    it('defaults to 1 when neither is present', () => {
        assert.equal(toExitCode(null, null), 1);
    });
});

describe('runProcess', () => {
    it('captures stdout, stderr and the exit code', async () => {
        const result = await sh('echo out; echo err >&2; exit 3');
        assert.equal(result.stdout, 'out\n');
        assert.equal(result.stderr, 'err\n');
        assert.equal(result.exitCode, 3);
        assert.equal(result.timedOut, false);
    });

    it('truncates output beyond the cap instead of killing the command', async () => {
        const result = await sh('head -c 5000 /dev/zero | tr "\\0" a; echo done >&2', { maxOutputBytes: 1000 });
        assert.equal(result.exitCode, 0);
        assert.ok(result.stdout.startsWith('a'.repeat(1000)));
        assert.match(result.stdout, /\[output truncated: 4000 more bytes not shown\]/);
        assert.equal(result.stderr, 'done\n');
    });

    it('kills the whole process group on timeout', async () => {
        const started = Date.now();
        // The backgrounded sleep holds stdout open; without a group kill,
        // `close` would not fire until it exits.
        const result = await sh('sleep 30 & echo started; wait', { timeoutMs: 300 });
        assert.ok(Date.now() - started < 10_000, 'should not wait for the grandchild');
        assert.equal(result.timedOut, true);
        assert.equal(result.exitCode, TIMEOUT_EXIT_CODE);
        assert.equal(result.stdout, 'started\n');
        assert.match(result.stderr, /timed out after 0.3s/);
    });

    it('gives the child a closed stdin so reads do not hang', async () => {
        const result = await sh('cat; echo eof', { timeoutMs: 5_000 });
        assert.equal(result.timedOut, false);
        assert.equal(result.stdout, 'eof\n');
    });

    it('reports a spawn failure without throwing', async () => {
        const result = await runProcess('/bin/sh', ['-c', 'true'], { cwd: '/nonexistent-dir', env: process.env });
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /Failed to start process in \/nonexistent-dir/);
    });
});
