/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BridgeValidationError, normalizeBridge, normalizeBridgePath, parseBridgeList } from '../../src/bridges.js';

describe('normalizeBridgePath', () => {
    it('adds a leading slash and strips trailing ones', () => {
        assert.equal(normalizeBridgePath('app'), '/app');
        assert.equal(normalizeBridgePath('/app/'), '/app');
        assert.equal(normalizeBridgePath(' /app// '), '/app');
    });
});

describe('normalizeBridge', () => {
    it('normalizes the path and adds http:// to the target', () => {
        assert.deepEqual(normalizeBridge({ path: 'app/', target: ' 127.0.0.1:3000/x ' }), {
            path: '/app',
            target: 'http://127.0.0.1:3000/x',
        });
    });

    it('keeps https targets and trailing slashes as given', () => {
        assert.deepEqual(normalizeBridge({ path: '/a', target: 'https://127.0.0.1:3000/' }), {
            path: '/a',
            target: 'https://127.0.0.1:3000/',
        });
    });

    it('rejects missing or non-string fields', () => {
        assert.throws(() => normalizeBridge(null), BridgeValidationError);
        assert.throws(() => normalizeBridge({ target: 'http://x' }), /path is required/);
        assert.throws(() => normalizeBridge({ path: '/a', target: 42 }), /target is required/);
        assert.throws(() => normalizeBridge({ path: '  ', target: 'http://x' }), /path is required/);
    });

    it('rejects the root path and paths with query/fragment characters', () => {
        assert.throws(() => normalizeBridge({ path: '/', target: 'http://x' }), /root path/);
        assert.throws(() => normalizeBridge({ path: '/a?b', target: 'http://x' }), /must not contain/);
        assert.throws(() => normalizeBridge({ path: '/a b', target: 'http://x' }), /must not contain/);
    });

    it('rejects reserved sandbox paths and paths below them, case-insensitively', () => {
        for (const path of [
            '/fs',
            '/fs/x',
            '/exec',
            '/MCP',
            '/shell',
            '/shellfoo',
            '/bridges/',
            '/health',
            '/browse/a',
            '/llms.txt',
        ]) {
            assert.throws(() => normalizeBridge({ path, target: 'http://x' }), /reserved/, path);
        }
    });

    it('allows paths that only share a prefix with a reserved one', () => {
        for (const path of ['/fsapp', '/health-dashboard', '/browser', '/execs']) {
            assert.equal(normalizeBridge({ path, target: 'http://x' }).path, path);
        }
    });

    it('rejects an unparseable target', () => {
        assert.throws(() => normalizeBridge({ path: '/a', target: 'http://' }), /not a valid URL/);
    });
});

describe('parseBridgeList', () => {
    it('rejects non-arrays', () => {
        assert.throws(() => parseBridgeList(undefined), /must be an array/);
        assert.throws(() => parseBridgeList({}), /must be an array/);
    });

    it('names the invalid entry', () => {
        assert.throws(() => parseBridgeList([{ path: '/a', target: 'http://x' }, { path: '/fs' }]), /bridges\[1\]/);
    });

    it('normalizes entries and keeps the last definition of a duplicate path', () => {
        assert.deepEqual(
            parseBridgeList([
                { path: '/a', target: 'http://one' },
                { path: 'b', target: 'http://two' },
                { path: '/a/', target: 'http://three' },
            ]),
            [
                { path: '/a', target: 'http://three' },
                { path: '/b', target: 'http://two' },
            ],
        );
    });
});
