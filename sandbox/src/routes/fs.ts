/**
 * RESTful filesystem API mounted at /fs.
 *
 * Paths are taken from the URL (`/fs/<path>`) and resolved relative to
 * /sandbox by the operations layer. The router's own routes treat `/` and
 * `/*path` with the same handlers, so the /fs root needs no special-cased
 * copies.
 *
 * PUT/POST bodies are raw bytes (any content type) streamed straight to disk,
 * and file reads are streamed back, so large files never sit in memory.
 * IMPORTANT: this router must be mounted BEFORE express.json(), which would
 * consume the body.
 */
import type { Transform } from 'node:stream';
import zlib from 'node:zlib';

import { log } from 'apify';
import type { Request, Response } from 'express';
import { Router } from 'express';
import mime from 'mime-types';

import { BodyTooLargeError } from '../file-stream.js';
import {
    createDirectory,
    createZipArchive,
    deleteFileOrDirectory,
    listFilesDetailed,
    openFileForRead,
    statPath,
    writeFileFromStream,
} from '../operations.js';
import { wildcardPath } from '../route-params.js';

/** Raw request bodies up to this many (decoded) bytes are accepted for PUT and POST. */
const RAW_BODY_LIMIT_BYTES = 500 * 1024 * 1024;

/** The sandbox-relative path addressed by the request ('' = /sandbox root). */
const requestedPath = (req: Request): string => wildcardPath(req.params.path);

/**
 * Decompressor for the request's Content-Encoding: undefined for an
 * uncompressed body, null for an unsupported encoding.
 */
const bodyDecoder = (req: Request): Transform | undefined | null => {
    const encoding = (req.headers['content-encoding'] || 'identity').toLowerCase();
    switch (encoding) {
        case 'identity':
            return undefined;
        case 'gzip':
        case 'x-gzip':
            return zlib.createGunzip();
        case 'deflate':
            return zlib.createInflate();
        case 'br':
            return zlib.createBrotliDecompress();
        default:
            return null;
    }
};

/**
 * Stream the request body into `filePath` and send the JSON response. Shared
 * by PUT (replace) and POST ?append=1.
 */
const receiveFile = async (req: Request, res: Response, filePath: string, append: boolean): Promise<void> => {
    const op = append ? 'POST /fs append' : 'PUT /fs';

    const declaredLength = Number(req.headers['content-length']);
    if (!req.headers['content-encoding'] && declaredLength > RAW_BODY_LIMIT_BYTES) {
        res.setHeader('Connection', 'close');
        res.status(413).json({ error: `Request body exceeds the ${RAW_BODY_LIMIT_BYTES}-byte limit`, path: filePath });
        return;
    }

    const decoder = bodyDecoder(req);
    if (decoder === null) {
        res.status(415).json({ error: `Unsupported Content-Encoding: ${req.headers['content-encoding']}` });
        return;
    }

    try {
        const result = await writeFileFromStream(filePath, req, { append, maxBytes: RAW_BODY_LIMIT_BYTES, decoder });
        log.info(`REST ${op} completed successfully`, { path: result.path, size: result.size });
        res.status(200).json({ success: true, path: result.path, size: result.size });
    } catch (error) {
        const err = error as Error;
        log.warning(`REST ${op} failed`, { path: filePath, error: err.message });
        // pipeline() destroys req on failure; the socket survives only if the
        // body had been fully received, so reply only while it is still open.
        if (res.headersSent || !res.socket || res.socket.destroyed) {
            return;
        }
        if (err instanceof BodyTooLargeError) {
            // Don't keep the connection alive for the rest of an oversize body.
            res.setHeader('Connection', 'close');
            res.status(413).json({ error: err.message, path: filePath });
        } else if ((err as NodeJS.ErrnoException).code?.startsWith('Z_')) {
            res.status(400).json({ error: `Invalid compressed body: ${err.message}`, path: filePath });
        } else {
            res.status(500).json({ error: err.message, path: filePath });
        }
    }
};

// HEAD / and /*path - File or directory metadata
const handleHead = async (req: Request, res: Response): Promise<void> => {
    try {
        const filePath = requestedPath(req);
        log.info('REST HEAD /fs request received', { path: filePath });

        const result = await statPath(filePath);

        if (!result.exists || result.error) {
            log.warning('REST HEAD /fs failed', { path: filePath, error: result.error });
            res.status(404).end();
            return;
        }

        res.setHeader('X-File-Type', result.type);
        res.setHeader('X-Path', result.path);

        if (result.mtime) {
            res.setHeader('Last-Modified', result.mtime.toUTCString());
        }

        if (result.type === 'file' && result.size !== undefined) {
            res.setHeader('Content-Length', result.size.toString());
            res.setHeader('Content-Type', mime.lookup(result.path) || 'application/octet-stream');
        }

        log.info('REST HEAD /fs completed successfully', { path: result.path, type: result.type });
        res.status(200).end();
    } catch (error) {
        log.error('REST HEAD /fs error', { error });
        res.status(500).end();
    }
};

// GET / and /*path - Read file, list directory, or download directory as ZIP
const handleGet = async (req: Request, res: Response): Promise<void> => {
    try {
        const filePath = requestedPath(req);
        const download = req.query.download === '1';

        log.info('REST GET /fs request received', { path: filePath, download });

        const statResult = await statPath(filePath);

        if (!statResult.exists || statResult.error) {
            log.warning('REST GET /fs failed', { path: filePath, error: statResult.error });
            res.status(404).json({ error: statResult.error || 'Path not found', path: filePath });
            return;
        }

        if (statResult.type === 'directory') {
            if (download) {
                const zipResult = await createZipArchive(filePath);

                if (zipResult.error || !zipResult.stream) {
                    log.warning('REST GET /fs ZIP creation failed', { path: filePath, error: zipResult.error });
                    res.status(500).json({ error: zipResult.error || 'Failed to create ZIP archive' });
                    return;
                }

                const dirName = filePath.split('/').filter(Boolean).pop() || 'sandbox';
                // res.attachment() encodes the name per RFC 6266/5987, so quotes,
                // CR/LF and non-ASCII characters can't break or reject the header.
                res.attachment(`${dirName}.zip`);
                res.setHeader('Content-Type', 'application/zip');

                log.info('REST GET /fs streaming ZIP', { path: zipResult.path });
                zipResult.stream.on('error', (err) => {
                    log.error('REST GET /fs ZIP stream error', { path: zipResult.path, error: err.message });
                    res.end();
                });
                zipResult.stream.pipe(res);
            } else {
                const listResult = await listFilesDetailed(filePath);

                if (listResult.error) {
                    log.warning('REST GET /fs directory listing failed', { path: filePath, error: listResult.error });
                    res.status(500).json({ error: listResult.error, path: filePath });
                    return;
                }

                log.info('REST GET /fs directory listing completed', {
                    path: listResult.path,
                    entryCount: listResult.entries.length,
                });
                res.json(listResult);
            }
        } else {
            // File: stream raw bytes with appropriate Content-Type
            const fileResult = await openFileForRead(filePath);

            if (fileResult.error || !fileResult.stream) {
                log.warning('REST GET /fs file read failed', { path: filePath, error: fileResult.error });
                res.status(404).json({ error: fileResult.error || 'Failed to read file', path: filePath });
                return;
            }

            const { stream } = fileResult;
            // Release the file handle when the response ends for any reason,
            // including a client disconnect or a header error below.
            res.on('close', () => stream.destroy());

            if (download) {
                const fileName = filePath.split('/').filter(Boolean).pop() || 'file';
                // Safely encoded (see above). Also sets Content-Type from the
                // extension, which the explicit header below overrides.
                res.attachment(fileName);
            }

            res.setHeader('Content-Type', fileResult.mimeType || 'application/octet-stream');
            res.setHeader('Content-Length', String(fileResult.size));

            log.info('REST GET /fs streaming file', {
                path: fileResult.path,
                size: fileResult.size,
                mimeType: fileResult.mimeType,
            });
            stream.on('error', (err) => {
                log.error('REST GET /fs file stream error', { path: fileResult.path, error: err.message });
                res.destroy(err);
            });
            stream.pipe(res);
        }
    } catch (error) {
        log.error('REST GET /fs error', { error });
        res.status(500).json({ error: (error as Error).message });
    }
};

// PUT /*path - Write/replace file
const handlePut = async (req: Request, res: Response): Promise<void> => {
    try {
        const filePath = requestedPath(req);

        log.info('REST PUT /fs request received', {
            path: filePath,
            contentLength: req.headers['content-length'],
            contentType: req.headers['content-type'],
        });

        if (!filePath || filePath === '/') {
            res.status(400).json({ error: 'Cannot write to root directory' });
            return;
        }

        await receiveFile(req, res, filePath, false);
    } catch (error) {
        log.error('REST PUT /fs error', { error });
        res.status(500).json({ error: (error as Error).message });
    }
};

// POST /*path - Create directory (?mkdir=1) or append to file (?append=1)
const handlePost = async (req: Request, res: Response): Promise<void> => {
    try {
        const filePath = requestedPath(req);
        const mkdir = req.query.mkdir === '1';
        const append = req.query.append === '1';

        log.info('REST POST /fs request received', { path: filePath, mkdir, append });

        if (!filePath || filePath === '/') {
            res.status(400).json({ error: 'Cannot operate on root directory' });
            return;
        }

        if (!mkdir && !append) {
            res.status(400).json({ error: 'Either mkdir=1 or append=1 query parameter is required' });
            return;
        }

        if (mkdir && append) {
            res.status(400).json({ error: 'Cannot use both mkdir=1 and append=1' });
            return;
        }

        if (mkdir) {
            const result = await createDirectory(filePath);

            if (!result.success) {
                log.warning('REST POST /fs mkdir failed', { path: filePath, error: result.error });
                res.status(500).json({ error: result.error, path: filePath });
                return;
            }

            log.info('REST POST /fs mkdir completed successfully', { path: result.path });
            res.status(201).json({ success: true, path: result.path, type: 'directory' });
        } else {
            await receiveFile(req, res, filePath, true);
        }
    } catch (error) {
        log.error('REST POST /fs error', { error });
        res.status(500).json({ error: (error as Error).message });
    }
};

// DELETE /*path - Delete file or directory (?recursive=1 for non-empty dirs)
const handleDelete = async (req: Request, res: Response): Promise<void> => {
    try {
        const filePath = requestedPath(req);
        const recursive = req.query.recursive === '1';

        log.info('REST DELETE /fs request received', { path: filePath, recursive });

        if (!filePath || filePath === '/') {
            res.status(400).json({ error: 'Cannot delete root directory' });
            return;
        }

        const result = await deleteFileOrDirectory(filePath, recursive);

        if (!result.success) {
            if (result.error?.includes('not empty')) {
                log.warning('REST DELETE /fs failed - directory not empty', { path: filePath, error: result.error });
                res.status(409).json({ error: result.error, path: filePath, code: 'DIRECTORY_NOT_EMPTY' });
                return;
            }

            log.warning('REST DELETE /fs failed', { path: filePath, error: result.error });
            res.status(500).json({ error: result.error, path: filePath });
            return;
        }

        log.info('REST DELETE /fs completed successfully', { path: result.path });
        res.status(200).json({ success: true, path: result.path, deleted: true });
    } catch (error) {
        log.error('REST DELETE /fs error', { error });
        res.status(500).json({ error: (error as Error).message });
    }
};

/** Build the /fs router. Mount with `app.use('/fs', createFsRouter())`. */
export const createFsRouter = (): Router => {
    const router = Router();

    // '/' covers /fs and /fs/; '/*path' covers everything below.
    router.head(['/', '/*path'], handleHead);
    router.get(['/', '/*path'], handleGet);
    router.put('/*path', handlePut);
    router.post('/*path', handlePost);
    router.delete('/*path', handleDelete);

    return router;
};
