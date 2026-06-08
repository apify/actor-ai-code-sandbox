/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { translateLaunchParam } from '../../src/shell-launch.js';

describe('translateLaunchParam', () => {
    it('returns path unchanged when no query string', () => {
        assert.equal(translateLaunchParam('/'), '/');
        assert.equal(translateLaunchParam('/ws'), '/ws');
    });

    it('returns path unchanged when launch is absent', () => {
        assert.equal(translateLaunchParam('/?arg=-c&arg=foo'), '/?arg=-c&arg=foo');
    });

    it('runs launch=<cmd> in a persistent shell, echoing the command and any error', () => {
        const out = translateLaunchParam('/?launch=claude');
        assert.equal(
            out,
            '/?arg=-c&arg=source%20%2Fapp%2Fsandbox_bashrc%3B%20echo%20%22%24%20claude%22%3B%20claude%20%7C%7C%20echo%20%22%5Bcommand%20exited%20with%20status%20%24%3F%5D%22%3B%20exec%20bash%20--rcfile%20%2Fapp%2Fsandbox_bashrc',
        );
    });

    it('handles commands with spaces and special chars', () => {
        const out = translateLaunchParam('/?launch=opencode%20tui');
        assert.equal(
            out,
            '/?arg=-c&arg=source%20%2Fapp%2Fsandbox_bashrc%3B%20echo%20%22%24%20opencode%20tui%22%3B%20opencode%20tui%20%7C%7C%20echo%20%22%5Bcommand%20exited%20with%20status%20%24%3F%5D%22%3B%20exec%20bash%20--rcfile%20%2Fapp%2Fsandbox_bashrc',
        );
    });

    it('preserves other query params (after the injected args)', () => {
        const out = translateLaunchParam('/ws?launch=claude&token=abc');
        assert.equal(
            out,
            '/ws?arg=-c&arg=source%20%2Fapp%2Fsandbox_bashrc%3B%20echo%20%22%24%20claude%22%3B%20claude%20%7C%7C%20echo%20%22%5Bcommand%20exited%20with%20status%20%24%3F%5D%22%3B%20exec%20bash%20--rcfile%20%2Fapp%2Fsandbox_bashrc&token=abc',
        );
    });

    it('opens a persistent interactive shell when launch is empty', () => {
        const out = translateLaunchParam('/?launch=');
        assert.equal(out, '/?arg=-c&arg=exec%20bash%20--rcfile%20%2Fapp%2Fsandbox_bashrc');
    });
});
