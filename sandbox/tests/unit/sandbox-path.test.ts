/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { isWithinDir, resolveWithinDir } from '../../src/sandbox-path.js';

describe('isWithinDir', () => {
    it('matches the root and paths below it on a segment boundary', () => {
        assert.equal(isWithinDir('/sandbox', '/sandbox'), true);
        assert.equal(isWithinDir('/sandbox', '/sandbox/a/b'), true);
        assert.equal(isWithinDir('/sandbox', '/sandboxx'), false);
        assert.equal(isWithinDir('/sandbox', '/sandboxx/a'), false);
        assert.equal(isWithinDir('/sandbox', '/etc'), false);
    });
});

describe('resolveWithinDir', () => {
    let tmp: string;
    let root: string;
    let outside: string;

    before(async () => {
        tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-path-')));
        root = path.join(tmp, 'sandbox');
        outside = path.join(tmp, 'outside');
        await fs.mkdir(path.join(root, 'sub'), { recursive: true });
        await fs.mkdir(outside);
        await fs.mkdir(`${root}x`);
        await fs.writeFile(path.join(outside, 'secret.txt'), 'x');
        await fs.symlink(outside, path.join(root, 'escape'));
        await fs.symlink(path.join(outside, 'missing.txt'), path.join(root, 'dangling'));
        await fs.symlink(path.join(root, 'sub'), path.join(root, 'inner'));
    });

    after(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it('resolves relative paths against the root', async () => {
        assert.equal(await resolveWithinDir(root, 'sub'), path.join(root, 'sub'));
        assert.equal(await resolveWithinDir(root, 'sub/new/file.txt'), path.join(root, 'sub/new/file.txt'));
        assert.equal(await resolveWithinDir(root, root), root);
    });

    it('rejects .. traversal and sibling directories sharing the prefix', async () => {
        await assert.rejects(resolveWithinDir(root, '../outside/secret.txt'), /Access denied/);
        await assert.rejects(resolveWithinDir(root, `${root}x/file.txt`), /Access denied/);
        await assert.rejects(resolveWithinDir(root, '/etc/passwd'), /Access denied/);
    });

    it('rejects symlinks that point outside, for existing and new files', async () => {
        await assert.rejects(resolveWithinDir(root, 'escape/secret.txt'), /Access denied/);
        await assert.rejects(resolveWithinDir(root, 'escape/new.txt'), /Access denied/);
        await assert.rejects(resolveWithinDir(root, 'escape/new/dir/file.txt'), /Access denied/);
    });

    it('rejects a dangling symlink whose target is outside', async () => {
        await assert.rejects(resolveWithinDir(root, 'dangling'), /Access denied/);
    });

    it('follows symlinks that stay inside', async () => {
        assert.equal(await resolveWithinDir(root, 'inner/new.txt'), path.join(root, 'sub/new.txt'));
    });
});
