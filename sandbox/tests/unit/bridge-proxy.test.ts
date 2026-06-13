/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchBridge, rewriteBridgeUrl } from '../../src/bridge-proxy.js';

describe('matchBridge', () => {
    const bridges = [
        { path: '/app', target: 'http://127.0.0.1:3000/app' },
        { path: '/app/admin', target: 'http://127.0.0.1:4000/' },
        { path: '/other', target: 'http://127.0.0.1:5000' },
    ];

    it('returns the bridge whose path prefixes the request path', () => {
        assert.equal(matchBridge(bridges, '/other/x')?.path, '/other');
    });

    it('prefers the longest matching prefix', () => {
        assert.equal(matchBridge(bridges, '/app/admin/users')?.path, '/app/admin');
        assert.equal(matchBridge(bridges, '/app/public')?.path, '/app');
    });

    it('returns null when nothing matches', () => {
        assert.equal(matchBridge(bridges, '/nope'), null);
        assert.equal(matchBridge([], '/app'), null);
    });
});

describe('rewriteBridgeUrl', () => {
    it('maps the exposed path to the target path', () => {
        assert.equal(rewriteBridgeUrl('/app/users', '/app', '/myapp'), '/myapp/users');
    });

    it('returns the bare target path when there is no extra path', () => {
        assert.equal(rewriteBridgeUrl('/app', '/app', '/myapp'), '/myapp');
    });

    it('preserves the query string', () => {
        assert.equal(rewriteBridgeUrl('/app/users?a=1&b=2', '/app', '/myapp'), '/myapp/users?a=1&b=2');
        assert.equal(rewriteBridgeUrl('/app?a=1', '/app', '/myapp'), '/myapp?a=1');
    });

    it('does not double the slash when both sides have one', () => {
        assert.equal(rewriteBridgeUrl('/app/users', '/app', '/myapp/'), '/myapp/users');
    });

    it('inserts a slash when neither side has one', () => {
        // Bridge path '/app' against request '/appx' yields extra path 'x';
        // a target without a trailing slash still needs the separator.
        assert.equal(rewriteBridgeUrl('/app/x', '/app', '/myapp'), '/myapp/x');
    });

    it('targets the root path cleanly', () => {
        assert.equal(rewriteBridgeUrl('/app/users', '/app', '/'), '/users');
        assert.equal(rewriteBridgeUrl('/app', '/app', '/'), '/');
    });

    it('always returns a URL starting with a slash', () => {
        assert.equal(rewriteBridgeUrl('/app', '/app', 'relative'), '/relative');
    });
});
