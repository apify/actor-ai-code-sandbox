/**
 * Stream-to-disk helpers for the /fs API, so uploads never sit in memory.
 *
 * Bodies are first streamed into a temp file next to the target and only then
 * moved (PUT) or appended (POST ?append=1) into place. An aborted or oversize
 * upload therefore leaves the target untouched instead of truncated or
 * half-appended.
 */
import crypto from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Thrown when a streamed body exceeds the configured byte limit. */
export class BodyTooLargeError extends Error {
    constructor(readonly limit: number) {
        super(`Request body exceeds the ${limit}-byte limit`);
        this.name = 'BodyTooLargeError';
    }
}

/** Pass-through that fails with BodyTooLargeError once more than `limit` bytes have flowed through. */
export const byteLimiter = (limit: number): Transform => {
    let seen = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            seen += chunk.length;
            if (seen > limit) {
                callback(new BodyTooLargeError(limit));
                return;
            }
            callback(null, chunk);
        },
    });
};

/**
 * Stream `source` into `target` (an absolute, already validated path),
 * creating parent directories. With `append`, the bytes are added to the end
 * of the existing file; otherwise the file is replaced, keeping the previous
 * file's permission bits. `decoder` (e.g. a gunzip stream) is applied before
 * the byte limit. Returns the resulting file size.
 */
export const writeStreamToFile = async (
    source: Readable,
    target: string,
    { append = false, maxBytes, decoder }: { append?: boolean; maxBytes: number; decoder?: Transform },
): Promise<number> => {
    // An error (e.g. client abort) during the mkdir below would otherwise be an
    // unhandled 'error' event; pipeline() still sees it via the errored state.
    const ignoreEarlyError = () => undefined;
    source.once('error', ignoreEarlyError);

    const dir = path.dirname(target);
    await fs.mkdir(dir, { recursive: true });
    source.off('error', ignoreEarlyError);

    const tempPath = path.join(dir, `.${path.basename(target)}.${crypto.randomUUID()}.upload`);
    try {
        const sink = createWriteStream(tempPath, { flags: 'wx' });
        await (decoder
            ? pipeline(source, decoder, byteLimiter(maxBytes), sink)
            : pipeline(source, byteLimiter(maxBytes), sink));

        if (append) {
            await pipeline(createReadStream(tempPath), createWriteStream(target, { flags: 'a' }));
            await fs.rm(tempPath, { force: true });
        } else {
            const previous = await fs.stat(target).catch(() => undefined);
            if (previous) {
                await fs.chmod(tempPath, previous.mode % 0o10000);
            }
            await fs.rename(tempPath, target);
        }
    } catch (error) {
        await fs.rm(tempPath, { force: true });
        throw error;
    }

    return (await fs.stat(target)).size;
};
