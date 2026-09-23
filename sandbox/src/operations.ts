// Abstracted operations for sandbox functionality
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable, Transform } from 'node:stream';

import { log } from 'apify';
import { ZipArchive } from 'archiver';
import mime from 'mime-types';

import { JS_TS_CODE_DIR, PYTHON_CODE_DIR, SANDBOX_DIR } from './consts.js';
import { getExecutionEnvironment } from './environment.js';
import { writeStreamToFile } from './file-stream.js';
import { runProcess } from './process-runner.js';
import { resolveSandboxPath } from './sandbox-path.js';

/** Subdirectory (inside /sandbox/js-ts and /sandbox/py) holding transient code snippets. */
const EXEC_TEMP_DIRNAME = '.exec';

/**
 * Execute a shell command
 */
export const runCommand = async (
    command: string,
    cwd?: string,
    timeout?: number,
): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
}> => {
    log.debug('runCommand called', { command, cwd, timeout });
    const execCwd = cwd || SANDBOX_DIR;
    // Same shell `child_process.exec` used, so command semantics are unchanged.
    const { stdout, stderr, exitCode } = await runProcess('/bin/sh', ['-c', command], {
        cwd: execCwd,
        env: getExecutionEnvironment(),
        timeoutMs: timeout,
    });
    log.debug('runCommand finished', { command, cwd: execCwd, exitCode });
    return { stdout, stderr, exitCode };
};

/**
 * Write content to a file
 */
export const writeFile = async (
    filePath: string,
    content: string,
    mode?: number,
): Promise<{
    success: boolean;
    path: string;
    error?: string;
}> => {
    log.debug('writeFile called', { path: filePath, contentLength: content.length, mode });
    try {
        const resolvedPath = await resolveSandboxPath(filePath);

        // Ensure directory exists
        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });

        // Write the file
        await fs.writeFile(resolvedPath, content, 'utf8');

        // Set file mode if specified
        if (mode) {
            await fs.chmod(resolvedPath, mode);
        }

        log.debug('writeFile succeeded', { path: resolvedPath });
        return {
            success: true,
            path: resolvedPath,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('writeFile failed', { path: filePath, error: err.message });
        return {
            success: false,
            path: filePath,
            error: err.message,
        };
    }
};

/**
 * Read file contents
 */
export const readFile = async (
    filePath: string,
): Promise<{
    content?: string;
    path: string;
    error?: string;
}> => {
    log.debug('readFile called', { path: filePath });
    try {
        const resolvedPath = await resolveSandboxPath(filePath);

        const content = await fs.readFile(resolvedPath, 'utf8');

        log.debug('readFile succeeded', { path: resolvedPath, contentLength: content.length });
        return {
            content,
            path: resolvedPath,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('readFile failed', { path: filePath, error: err.message });
        return {
            path: filePath,
            error: err.message,
        };
    }
};

/**
 * List files in directory
 */
export const listFiles = async (
    dirPath?: string,
): Promise<{
    path: string;
    files: {
        name: string;
        type: 'file' | 'directory';
        path: string;
    }[];
    error?: string;
}> => {
    log.debug('listFiles called', { path: dirPath });
    try {
        // Use /sandbox as default, or resolve relative paths relative to /sandbox
        const targetPath = await resolveSandboxPath(dirPath);

        const entries = await fs.readdir(targetPath, { withFileTypes: true });

        const files = entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
            path: path.join(targetPath, entry.name),
        }));

        log.debug('listFiles succeeded', { path: targetPath, fileCount: files.length });
        return {
            path: targetPath,
            files,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('listFiles failed', { path: dirPath, error: err.message });
        return {
            path: dirPath || SANDBOX_DIR,
            files: [],
            error: err.message,
        };
    }
};

/** Canonical execution languages; 'shell' runs via bash, the rest via interpreters. */
export type ExecLanguage = 'js' | 'ts' | 'py' | 'shell';

/** Accepted language aliases mapped to their canonical names. */
const LANGUAGE_ALIASES: Record<string, ExecLanguage> = {
    js: 'js',
    javascript: 'js',
    ts: 'ts',
    typescript: 'ts',
    py: 'py',
    python: 'py',
    bash: 'shell',
    sh: 'shell',
};

/** Human-readable list of accepted language values, for input-error messages. */
export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_ALIASES).join(', ');

/**
 * Normalize a language alias to canonical form. Returns null when the value is
 * missing or unrecognized — callers must treat a provided-but-unrecognized
 * language as an input error rather than defaulting to shell.
 */
export const normalizeLanguage = (lang?: string): ExecLanguage | null => {
    if (!lang) return null;
    return LANGUAGE_ALIASES[lang.toLowerCase()] || null;
};

/**
 * Execute code in a specified language (JS, TS, or Python)
 *
 * IMPORTANT: Each code execution spawns a new interpreter process to ensure isolation.
 * This prevents agents from using variables from previous code executions.
 * While this ensures security and isolation, it means each execution starts fresh
 * with no access to state from previous executions. Consider this limitation when
 * designing multi-step agent workflows that require shared state.
 */
export const executeCode = async (
    code: string,
    language: 'js' | 'ts' | 'py',
    timeout?: number,
    cwd?: string,
): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    language: string;
}> => {
    log.debug('executeCode called', { language, codeLength: code.length, timeout, cwd });
    const tempFiles: string[] = [];

    try {
        // Validate language
        if (!['js', 'ts', 'py'].includes(language)) {
            return {
                stdout: '',
                stderr: `Unsupported language: ${language}. Supported languages: js, ts, py`,
                exitCode: 1,
                language,
            };
        }

        // Validate code is not empty
        if (!code || code.trim().length === 0) {
            return {
                stdout: '',
                stderr: 'Code cannot be empty',
                exitCode: 1,
                language,
            };
        }

        // The snippet is written INSIDE the language directory (not /tmp): Node
        // resolves ESM bare specifiers relative to the importing file and ignores
        // NODE_PATH for `import`, so a file in /tmp could never `import` packages
        // from /sandbox/js-ts/node_modules. Python gets the same treatment for
        // symmetry (relative imports of sibling modules in /sandbox/py work).
        const uniqueId = crypto.randomBytes(6).toString('hex');
        const fileExtensions: Record<string, string> = {
            js: '.js',
            ts: '.ts',
            py: '.py',
        };
        const languageDir = language === 'py' ? PYTHON_CODE_DIR : JS_TS_CODE_DIR;
        const tempDir = path.join(languageDir, EXEC_TEMP_DIRNAME);
        await fs.mkdir(tempDir, { recursive: true });
        const tempFile = path.join(tempDir, `code-${uniqueId}${fileExtensions[language]}`);

        // Write code to file
        await fs.writeFile(tempFile, code, 'utf8');
        tempFiles.push(tempFile);

        const interpreters: Record<string, string> = { js: 'node', ts: 'tsx', py: 'python' };
        // cwd is validated by execute()
        const executionDir = cwd || languageDir;

        const { stdout, stderr, exitCode } = await runProcess(interpreters[language], [tempFile], {
            cwd: executionDir,
            env: getExecutionEnvironment(),
            timeoutMs: timeout,
        });

        log.debug('executeCode finished', { language, exitCode });
        return { stdout, stderr, exitCode, language };
    } catch (error) {
        const err = error as Error;
        log.debug('executeCode failed', { language, error: err.message });
        return {
            stdout: '',
            stderr: err.message || 'Code execution failed',
            exitCode: 1,
            language,
        };
    } finally {
        // Clean up temporary files
        for (const tempFile of tempFiles) {
            try {
                await fs.unlink(tempFile);
            } catch {
                log.debug('Failed to clean up temp file', { path: tempFile });
            }
        }
    }
};

/**
 * Run a shell command or code snippet, dispatching on the normalized language
 * (null or 'shell' → bash via runCommand; js/ts/py → executeCode). Shared
 * entry point for the /exec REST endpoint and the MCP `execute` tool.
 */
export const execute = async (options: {
    command: string;
    language: ExecLanguage | null;
    cwd?: string;
    timeoutSecs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number; language: string }> => {
    const { command, language, cwd, timeoutSecs } = options;
    // Missing or non-positive → the runner's default (DEFAULT_EXEC_TIMEOUT_MS).
    const timeoutMs = timeoutSecs && timeoutSecs > 0 ? timeoutSecs * 1000 : undefined;

    const effectiveLanguage = !language || language === 'shell' ? 'shell' : language;

    let resolvedCwd: string | undefined;
    if (cwd) {
        try {
            resolvedCwd = await resolveSandboxPath(cwd);
        } catch {
            return {
                stdout: '',
                stderr: `Access denied: Working directory ${cwd} is outside of sandbox`,
                exitCode: 1,
                language: effectiveLanguage,
            };
        }
    }

    if (effectiveLanguage === 'shell') {
        const result = await runCommand(command, resolvedCwd, timeoutMs);
        return { ...result, language: 'shell' };
    }
    return executeCode(command, effectiveLanguage, timeoutMs, resolvedCwd);
};

/**
 * Get file or directory metadata
 */
export const statPath = async (
    filePath: string,
): Promise<{
    path: string;
    type: 'file' | 'directory';
    size?: number;
    mtime?: Date;
    exists: boolean;
    error?: string;
}> => {
    log.debug('statPath called', { path: filePath });
    try {
        const resolvedPath = await resolveSandboxPath(filePath);
        const stats = await fs.stat(resolvedPath);

        log.debug('statPath succeeded', { path: resolvedPath, type: stats.isDirectory() ? 'directory' : 'file' });
        return {
            path: resolvedPath,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.isDirectory() ? undefined : stats.size,
            mtime: stats.mtime,
            exists: true,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('statPath failed', { path: filePath, error: err.message });
        return {
            path: filePath,
            type: 'file',
            exists: false,
            error: err.message,
        };
    }
};

/**
 * Open a file inside /sandbox for streaming. The file is opened up front so
 * permission and not-found errors surface here rather than mid-response.
 */
export const openFileForRead = async (
    filePath: string,
): Promise<{
    stream?: Readable;
    path: string;
    size?: number;
    mimeType?: string;
    error?: string;
}> => {
    log.debug('openFileForRead called', { path: filePath });
    try {
        const resolvedPath = await resolveSandboxPath(filePath);
        const handle = await fs.open(resolvedPath, 'r');
        try {
            const stats = await handle.stat();
            if (!stats.isFile()) {
                throw new Error(`Not a regular file: ${filePath}`);
            }
            const mimeType = mime.lookup(resolvedPath) || 'application/octet-stream';
            log.debug('openFileForRead succeeded', { path: resolvedPath, size: stats.size, mimeType });
            return {
                stream: handle.createReadStream(),
                path: resolvedPath,
                size: stats.size,
                mimeType,
            };
        } catch (error) {
            await handle.close();
            throw error;
        }
    } catch (error) {
        const err = error as Error;
        log.debug('openFileForRead failed', { path: filePath, error: err.message });
        return {
            path: filePath,
            error: err.message,
        };
    }
};

/**
 * Stream `content` into a file inside /sandbox, replacing it or (with
 * `append`) appending to it. Fails with BodyTooLargeError past `maxBytes`;
 * the target is left untouched on any failure.
 */
export const writeFileFromStream = async (
    filePath: string,
    content: Readable,
    options: { append?: boolean; maxBytes: number; decoder?: Transform },
): Promise<{ path: string; size: number }> => {
    log.debug('writeFileFromStream called', { path: filePath, append: options.append });

    // Validate the path stays inside /sandbox (works before the file exists)
    const normalizedPath = await resolveSandboxPath(filePath);

    const size = await writeStreamToFile(content, normalizedPath, options);
    log.debug('writeFileFromStream succeeded', { path: normalizedPath, size });
    return { path: normalizedPath, size };
};

/**
 * Create a directory
 */
export const createDirectory = async (
    dirPath: string,
): Promise<{
    success: boolean;
    path: string;
    error?: string;
}> => {
    log.debug('createDirectory called', { path: dirPath });
    try {
        // Resolve relative to /sandbox and validate it stays inside
        const normalizedPath = await resolveSandboxPath(dirPath);

        // Create directory recursively
        await fs.mkdir(normalizedPath, { recursive: true });

        log.debug('createDirectory succeeded', { path: normalizedPath });
        return {
            success: true,
            path: normalizedPath,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('createDirectory failed', { path: dirPath, error: err.message });
        return {
            success: false,
            path: dirPath,
            error: err.message,
        };
    }
};

/**
 * Delete a file or directory
 */
export const deleteFileOrDirectory = async (
    filePath: string,
    recursive = false,
): Promise<{
    success: boolean;
    path: string;
    error?: string;
}> => {
    log.debug('deleteFileOrDirectory called', { path: filePath, recursive });
    try {
        const resolvedPath = await resolveSandboxPath(filePath);

        // Check if path exists and get its type
        const stats = await fs.stat(resolvedPath);

        if (stats.isDirectory()) {
            if (!recursive) {
                // Check if directory is empty
                const entries = await fs.readdir(resolvedPath);
                if (entries.length > 0) {
                    throw new Error('Directory not empty. Use recursive=true to delete non-empty directories.');
                }
                // Use rmdir for empty directories (avoids EISDIR error)
                await fs.rmdir(resolvedPath);
            } else {
                // Use rm with recursive flag for non-empty directories
                await fs.rm(resolvedPath, { recursive: true, force: false });
            }
        } else {
            await fs.unlink(resolvedPath);
        }

        log.debug('deleteFileOrDirectory succeeded', { path: resolvedPath });
        return {
            success: true,
            path: resolvedPath,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('deleteFileOrDirectory failed', { path: filePath, error: err.message });
        return {
            success: false,
            path: filePath,
            error: err.message,
        };
    }
};

/**
 * List files in directory with size information and sorting
 */
export const listFilesDetailed = async (
    dirPath?: string,
): Promise<{
    path: string;
    type: 'directory';
    entries: {
        name: string;
        type: 'file' | 'directory';
        size?: number;
    }[];
    error?: string;
}> => {
    log.debug('listFilesDetailed called', { path: dirPath });
    try {
        // Use /sandbox as default, or resolve relative paths relative to /sandbox,
        // and validate it stays inside
        const resolvedPath = await resolveSandboxPath(dirPath);

        const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

        // Get size information for files
        const entriesWithSize = await Promise.all(
            entries.map(async (entry) => {
                const fullPath = path.join(resolvedPath, entry.name);
                let size: number | undefined;
                if (entry.isFile()) {
                    try {
                        const stats = await fs.stat(fullPath);
                        size = stats.size;
                    } catch {
                        size = undefined;
                    }
                }
                return {
                    name: entry.name,
                    type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
                    size,
                };
            }),
        );

        // Sort alphabetically by name (case-insensitive), like ls default
        entriesWithSize.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

        log.debug('listFilesDetailed succeeded', { path: resolvedPath, entryCount: entriesWithSize.length });
        return {
            path: resolvedPath,
            type: 'directory',
            entries: entriesWithSize,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('listFilesDetailed failed', { path: dirPath, error: err.message });
        return {
            path: dirPath || SANDBOX_DIR,
            type: 'directory',
            entries: [],
            error: err.message,
        };
    }
};

/**
 * Create a ZIP archive of a directory and return as stream
 */
export const createZipArchive = async (
    dirPath: string,
): Promise<{
    stream?: Readable;
    path: string;
    error?: string;
}> => {
    log.debug('createZipArchive called', { path: dirPath });
    try {
        const resolvedPath = await resolveSandboxPath(dirPath);

        // Check if path is a directory
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
            throw new Error('Path is not a directory');
        }

        // Create archive
        const archive = new ZipArchive({
            zlib: { level: 6 }, // Compression level
        });

        // Log archive errors instead of throwing: this fires asynchronously while
        // the archive streams, and throwing from an event handler would crash the
        // process. The consumer sees the stream end/error instead.
        archive.on('error', (err) => {
            log.error('Archive error', { error: err.message });
        });

        // Add directory contents to archive
        archive.directory(resolvedPath, false);

        // Finalize the archive (this is important!)
        void archive.finalize();

        log.debug('createZipArchive succeeded', { path: resolvedPath });
        return {
            stream: archive,
            path: resolvedPath,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('createZipArchive failed', { path: dirPath, error: err.message });
        return {
            path: dirPath,
            error: err.message,
        };
    }
};
