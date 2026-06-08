/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    injectTerminalReconnectScript,
    RECONNECT_OVERLAY_SCRIPT,
    TERMINAL_DISCONNECT_MESSAGE,
    TERMINAL_FINISHED_MESSAGE,
} from '../../src/templates/shell.js';

describe('injectTerminalReconnectScript', () => {
    it('injects the script right after <head>', () => {
        const html = '<html><head><title>ttyd</title></head><body></body></html>';
        const out = injectTerminalReconnectScript(html);
        assert.match(out, /<head><script>[\s\S]*<\/script><title>/);
        assert.ok(out.includes(RECONNECT_OVERLAY_SCRIPT));
    });

    it('preserves attributes on the <head> tag', () => {
        const out = injectTerminalReconnectScript('<head lang="en"><meta></head>');
        assert.ok(out.includes('<head lang="en"><script>'));
    });

    it('falls back to after <body> when there is no <head>', () => {
        const out = injectTerminalReconnectScript('<html><body>x</body></html>');
        assert.match(out, /<body><script>[\s\S]*<\/script>x/);
    });

    it('appends the script when there is neither <head> nor <body>', () => {
        const out = injectTerminalReconnectScript('<p>hi</p>');
        assert.ok(out.startsWith('<p>hi</p><script>'));
        assert.ok(out.trimEnd().endsWith('</script>'));
    });

    it('injects only once (single <head> match)', () => {
        const out = injectTerminalReconnectScript('<head></head><head></head>');
        assert.equal(out.match(/<script>/g)?.length, 1);
    });
});

describe('RECONNECT_OVERLAY_SCRIPT', () => {
    it('carries both user-facing messages', () => {
        assert.ok(RECONNECT_OVERLAY_SCRIPT.includes(TERMINAL_DISCONNECT_MESSAGE));
        assert.ok(RECONNECT_OVERLAY_SCRIPT.includes(TERMINAL_FINISHED_MESSAGE));
    });

    it("matches ttyd's exact overlay strings so the relabel actually fires", () => {
        // These must stay in lockstep with ttyd's frontend (xterm/index.ts). The ⏎
        // is emitted as a \\u23ce escape in the browser script.
        assert.ok(RECONNECT_OVERLAY_SCRIPT.includes('Press \\u23ce to Reconnect'));
        assert.ok(RECONNECT_OVERLAY_SCRIPT.includes("'Reconnecting...'"));
        assert.ok(RECONNECT_OVERLAY_SCRIPT.includes("'Reconnected'"));
    });

    it('observes the document for overlay text changes', () => {
        assert.ok(RECONNECT_OVERLAY_SCRIPT.includes('MutationObserver'));
        assert.ok(RECONNECT_OVERLAY_SCRIPT.includes('childList: true'));
    });
});
