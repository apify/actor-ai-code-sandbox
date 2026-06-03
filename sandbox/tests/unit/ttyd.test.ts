/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    appendTtydOutput,
    buildShellUnavailableMessage,
    isTtydStartupCrash,
    nextTtydRestartDelayMs,
    TTYD_CRASH_WINDOW_MS,
    TTYD_OUTPUT_LIMIT,
    TTYD_RESTART_MAX_MS,
    TTYD_RESTART_MIN_MS,
} from '../../src/ttyd.js';

describe('isTtydStartupCrash', () => {
    it('treats a fast exit as a startup crash', () => {
        assert.equal(isTtydStartupCrash(0), true);
        assert.equal(isTtydStartupCrash(TTYD_CRASH_WINDOW_MS - 1), true);
    });

    it('treats a long-lived process exit as a normal exit', () => {
        assert.equal(isTtydStartupCrash(TTYD_CRASH_WINDOW_MS), false);
        assert.equal(isTtydStartupCrash(60_000), false);
    });
});

describe('nextTtydRestartDelayMs', () => {
    it('doubles the delay on each crash, capped at the maximum', () => {
        let delay = TTYD_RESTART_MIN_MS;
        const seen: number[] = [];
        for (let i = 0; i < 8; i++) {
            seen.push(delay);
            delay = nextTtydRestartDelayMs(delay, true);
        }
        assert.deepEqual(seen, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
        assert.ok(seen.every((d) => d <= TTYD_RESTART_MAX_MS));
    });

    it('resets to the minimum after a normal exit', () => {
        assert.equal(nextTtydRestartDelayMs(TTYD_RESTART_MAX_MS, false), TTYD_RESTART_MIN_MS);
    });
});

describe('appendTtydOutput', () => {
    it('appends chunks', () => {
        assert.equal(appendTtydOutput('foo', 'bar'), 'foobar');
    });

    it('keeps only the last `limit` characters', () => {
        assert.equal(appendTtydOutput('abcd', 'ef', 3), 'def');
    });

    it('defaults to the output limit and never grows unbounded', () => {
        const out = appendTtydOutput('x'.repeat(TTYD_OUTPUT_LIMIT), 'y'.repeat(100));
        assert.equal(out.length, TTYD_OUTPUT_LIMIT);
        assert.ok(out.endsWith('y'.repeat(100)));
    });
});

describe('buildShellUnavailableMessage', () => {
    it('includes ttyd output when available', () => {
        const msg = buildShellUnavailableMessage('ttyd: error while loading shared libraries: libuv.so.1');
        assert.match(msg, /terminal backend \(ttyd\) is not running/);
        assert.match(msg, /Last ttyd output:/);
        assert.match(msg, /libuv\.so\.1/);
    });

    it('omits the output section when there is nothing to show', () => {
        const msg = buildShellUnavailableMessage('   ');
        assert.doesNotMatch(msg, /Last ttyd output:/);
        assert.match(msg, /reload this page/);
    });
});
