/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toExitCode } from '../../src/operations.js';

describe('toExitCode', () => {
    it('passes numeric exit statuses through', () => {
        assert.equal(toExitCode({ message: '', code: 0 }), 0);
        assert.equal(toExitCode({ message: '', code: 127 }), 127);
    });

    it('maps a signal kill (code null, e.g. timeout) to 1', () => {
        assert.equal(toExitCode({ message: '', code: null, signal: 'SIGTERM' }), 1);
    });

    it('maps a string error code (e.g. maxBuffer exceeded) to 1 instead of leaking the string', () => {
        assert.equal(
            toExitCode({ message: 'stdout maxBuffer length exceeded', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }),
            1,
        );
    });

    it('defaults to 1 when no code is present', () => {
        assert.equal(toExitCode({ message: 'spawn failed' }), 1);
    });
});
