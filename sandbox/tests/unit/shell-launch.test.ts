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

    it('translates launch=<cmd> to arg=-c arg=source bashrc; <cmd>', () => {
        const out = translateLaunchParam('/?launch=claude');
        assert.equal(out, '/?arg=-c&arg=source%20%2Fapp%2Fsandbox_bashrc%3B%20claude');
    });

    it('handles commands with spaces and special chars', () => {
        const out = translateLaunchParam('/?launch=opencode%20tui');
        assert.equal(out, '/?arg=-c&arg=source%20%2Fapp%2Fsandbox_bashrc%3B%20opencode%20tui');
    });

    it('preserves other query params (after the injected args)', () => {
        const out = translateLaunchParam('/ws?launch=claude&token=abc');
        assert.equal(out, '/ws?arg=-c&arg=source%20%2Fapp%2Fsandbox_bashrc%3B%20claude&token=abc');
    });

    it('handles empty launch value by just sourcing bashrc', () => {
        const out = translateLaunchParam('/?launch=');
        assert.equal(out, '/?arg=-c&arg=source%20%2Fapp%2Fsandbox_bashrc%3B');
    });
});
