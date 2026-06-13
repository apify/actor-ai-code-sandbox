/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { wildcardPath } from '../../src/route-params.js';

describe('wildcardPath', () => {
    it('joins Express 5 wildcard segment arrays with slashes (regression: was comma-joined)', () => {
        // Express 5 delivers `/fs/dir/sub/file.txt` as ['dir', 'sub', 'file.txt'];
        // String() on that array produced 'dir,sub,file.txt' and broke nested paths.
        assert.equal(wildcardPath(['dir', 'sub', 'file.txt']), 'dir/sub/file.txt');
    });

    it('handles a single-segment array', () => {
        assert.equal(wildcardPath(['file.txt']), 'file.txt');
    });

    it('passes plain strings through', () => {
        assert.equal(wildcardPath('a/b.txt'), 'a/b.txt');
    });

    it('returns the empty string for missing params', () => {
        assert.equal(wildcardPath(undefined), '');
        assert.equal(wildcardPath(null), '');
        assert.equal(wildcardPath([]), '');
    });
});
