/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';

import { BodyTooLargeError, writeStreamToFile } from '../../src/file-stream.js';

const body = (...chunks: string[]) => Readable.from(chunks.map((c) => Buffer.from(c)));

describe('writeStreamToFile', () => {
    let dir: string;

    before(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-stream-'));
    });

    after(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    const listDir = async (d: string) => (await fs.readdir(d)).sort();

    it('writes a new file, creating parent directories', async () => {
        const target = path.join(dir, 'a/b/new.txt');
        const size = await writeStreamToFile(body('hello ', 'world'), target, { maxBytes: 1024 });
        assert.equal(size, 11);
        assert.equal(await fs.readFile(target, 'utf8'), 'hello world');
        assert.deepEqual(await listDir(path.dirname(target)), ['new.txt']);
    });

    it('writes an empty body as an empty file', async () => {
        const target = path.join(dir, 'empty.txt');
        assert.equal(await writeStreamToFile(body(), target, { maxBytes: 1024 }), 0);
        assert.equal(await fs.readFile(target, 'utf8'), '');
    });

    it('replaces an existing file and keeps its mode', async () => {
        const target = path.join(dir, 'script.sh');
        await fs.writeFile(target, 'old');
        await fs.chmod(target, 0o755);
        await writeStreamToFile(body('new'), target, { maxBytes: 1024 });
        assert.equal(await fs.readFile(target, 'utf8'), 'new');
        assert.equal((await fs.stat(target)).mode % 0o1000, 0o755);
    });

    it('appends to an existing file', async () => {
        const target = path.join(dir, 'log.txt');
        await fs.writeFile(target, 'one\n');
        const size = await writeStreamToFile(body('two\n'), target, { append: true, maxBytes: 1024 });
        assert.equal(size, 8);
        assert.equal(await fs.readFile(target, 'utf8'), 'one\ntwo\n');
    });

    it('rejects an oversize body and leaves the target and directory untouched', async () => {
        const sub = path.join(dir, 'limit');
        const target = path.join(sub, 'f.txt');
        await fs.mkdir(sub);
        await fs.writeFile(target, 'keep');

        for (const append of [false, true]) {
            await assert.rejects(
                writeStreamToFile(body('12345', '67890'), target, { append, maxBytes: 8 }),
                BodyTooLargeError,
            );
            assert.equal(await fs.readFile(target, 'utf8'), 'keep');
            assert.deepEqual(await listDir(sub), ['f.txt']);
        }
    });

    it('leaves the target untouched when the source stream fails', async () => {
        const target = path.join(dir, 'aborted.txt');
        await fs.writeFile(target, 'keep');
        const failing = new Readable({
            read() {
                this.push(Buffer.from('partial'));
                this.destroy(new Error('client aborted'));
            },
        });
        await assert.rejects(writeStreamToFile(failing, target, { maxBytes: 1024 }), /client aborted/);
        assert.equal(await fs.readFile(target, 'utf8'), 'keep');
        assert.deepEqual(
            (await listDir(dir)).filter((f) => f.endsWith('.upload')),
            [],
        );
    });
});
