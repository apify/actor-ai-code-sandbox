// Abstracted operations for sandbox functionality
import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

import { log } from 'apify';
import { ZipArchive } from 'archiver';
import mime from 'mime-types';

import { JS_TS_CODE_DIR, PYTHON_CODE_DIR, SANDBOX_DIR } from './consts.js';
import { getExecutionEnvironment } from './environment.js';

const execAsync = promisify(exec);

/**
 * Resolve directory path relative to SANDBOX_DIR
 * @param dirPath - The directory path to resolve (optional)
 * @returns Resolved absolute path
 */
const resolveDirectoryPath = (dirPath?: string): string => {
    if (!dirPath) {
        return SANDBOX_DIR;
    }
    if (path.isAbsolute(dirPath)) {
        return dirPath;
    }
    return path.join(SANDBOX_DIR, dirPath);
};

/**
 * Resolve and validate file path relative to SANDBOX_DIR
 * Ensures the resolved path stays within /sandbox directory
 * @param filePath - The file path to resolve
 * @returns Resolved absolute path
 * @throws Error if path attempts to escape /sandbox
 */
const resolveAndValidatePath = async (filePath: string): Promise<string> => {
    // Resolve path relative to SANDBOX_DIR if not absolute
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(SANDBOX_DIR, filePath);

    // Resolve symlinks and normalize path to get the real path
    let realPath: string;
    try {
        realPath = await fs.realpath(resolvedPath);
    } catch {
        // If file doesn't exist yet, use normalized path
        realPath = path.normalize(resolvedPath);
    }

    // Ensure the path is within SANDBOX_DIR
    if (!realPath.startsWith(SANDBOX_DIR)) {
        throw new Error(`Access denied: Path ${filePath} resolves outside of sandbox`);
    }

    return realPath;
};

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
    try {
        const execOptions: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {
            env: getExecutionEnvironment(),
            // Use /sandbox as default working directory
            cwd: cwd || SANDBOX_DIR,
        };
        if (timeout) {
            execOptions.timeout = timeout;
        }

        const { stdout, stderr } = await execAsync(command, execOptions);

        log.debug('runCommand succeeded', { command, cwd: execOptions.cwd, exitCode: 0 });
        return {
            stdout,
            stderr,
            exitCode: 0,
        };
    } catch (error) {
        const err = error as { message: string; stdout?: string; stderr?: string; code?: number };
        log.debug('runCommand failed', { command, error: err.message, exitCode: err.code || 1 });
        return {
            stdout: err.stdout || '',
            stderr: err.stderr || '',
            exitCode: err.code || 1,
        };
    }
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
        // Resolve path relative to /sandbox if it's a relative path
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(SANDBOX_DIR, filePath);

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
        // Resolve path relative to /sandbox if it's a relative path
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(SANDBOX_DIR, filePath);

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
        const targetPath = resolveDirectoryPath(dirPath);

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
        const targetPath = resolveDirectoryPath(dirPath);
        log.debug('listFiles failed', { path: targetPath, error: err.message });
        return {
            path: targetPath,
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

        // Generate unique filename using random ID (not SHA256 hash for efficiency)
        const uniqueId = crypto.randomBytes(6).toString('hex');
        const fileExtensions: Record<string, string> = {
            js: '.js',
            ts: '.ts',
            py: '.py',
        };
        const tempFile = path.join('/tmp', `code-${uniqueId}${fileExtensions[language]}`);

        // Write code to file
        await fs.writeFile(tempFile, code, 'utf8');
        tempFiles.push(tempFile);

        let command: string;
        let executionDir: string;

        // Build command based on language and set execution directory
        if (language === 'js') {
            command = `node ${tempFile}`;
            executionDir = JS_TS_CODE_DIR;
        } else if (language === 'ts') {
            command = `tsx ${tempFile}`;
            executionDir = JS_TS_CODE_DIR;
        } else {
            // language === 'py'
            command = `python ${tempFile}`;
            executionDir = PYTHON_CODE_DIR;
        }

        // If custom cwd is provided, use it (after validation)
        if (cwd) {
            const resolvedCwd = path.isAbsolute(cwd) ? cwd : path.join(SANDBOX_DIR, cwd);
            const normalizedCwd = path.normalize(resolvedCwd);

            // Validate cwd is within sandbox
            if (!normalizedCwd.startsWith(SANDBOX_DIR)) {
                return {
                    stdout: '',
                    stderr: `Access denied: Working directory ${cwd} is outside of sandbox`,
                    exitCode: 1,
                    language,
                };
            }

            executionDir = normalizedCwd;
        }

        const execOptions: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {
            env: getExecutionEnvironment(),
            cwd: executionDir,
        };

        if (timeout) {
            execOptions.timeout = timeout;
        }

        const { stdout, stderr } = await execAsync(command, execOptions);

        log.debug('executeCode succeeded', { language, exitCode: 0 });
        return {
            stdout,
            stderr,
            exitCode: 0,
            language,
        };
    } catch (error) {
        const err = error as { message: string; stdout?: string; stderr?: string; code?: number };
        log.debug('executeCode failed', { language, error: err.message, exitCode: err.code || 1 });
        return {
            stdout: err.stdout || '',
            stderr: err.stderr || err.message || 'Code execution failed',
            exitCode: err.code || 1,
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
    const timeoutMs = timeoutSecs ? timeoutSecs * 1000 : undefined;

    if (!language || language === 'shell') {
        const result = await runCommand(command, cwd, timeoutMs);
        return { ...result, language: 'shell' };
    }
    return executeCode(command, language, timeoutMs, cwd);
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
        const resolvedPath = await resolveAndValidatePath(filePath);
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
 * Read file contents as Buffer (for binary files)
 */
export const readFileBinary = async (
    filePath: string,
): Promise<{
    content?: Buffer;
    path: string;
    size?: number;
    mimeType?: string;
    error?: string;
}> => {
    log.debug('readFileBinary called', { path: filePath });
    try {
        const resolvedPath = await resolveAndValidatePath(filePath);
        const content = await fs.readFile(resolvedPath);
        const mimeType = mime.lookup(resolvedPath) || 'application/octet-stream';

        log.debug('readFileBinary succeeded', { path: resolvedPath, size: content.length, mimeType });
        return {
            content,
            path: resolvedPath,
            size: content.length,
            mimeType,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('readFileBinary failed', { path: filePath, error: err.message });
        return {
            path: filePath,
            error: err.message,
        };
    }
};

/**
 * Write file contents (supports both string and Buffer)
 */
export const writeFileBinary = async (
    filePath: string,
    content: string | Buffer,
    mode?: number,
): Promise<{
    success: boolean;
    path: string;
    size?: number;
    error?: string;
}> => {
    log.debug('writeFileBinary called', { path: filePath, contentLength: content.length, mode });
    try {
        // Resolve path relative to /sandbox if it's a relative path
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(SANDBOX_DIR, filePath);

        // Validate path is within sandbox (before file exists)
        const normalizedPath = path.normalize(resolvedPath);
        if (!normalizedPath.startsWith(SANDBOX_DIR)) {
            throw new Error(`Access denied: Path ${filePath} resolves outside of sandbox`);
        }

        // Ensure directory exists
        const dir = path.dirname(normalizedPath);
        await fs.mkdir(dir, { recursive: true });

        // Write the file
        await fs.writeFile(normalizedPath, content);

        // Set file mode if specified
        if (mode) {
            await fs.chmod(normalizedPath, mode);
        }

        const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, 'utf8');

        log.debug('writeFileBinary succeeded', { path: normalizedPath, size });
        return {
            success: true,
            path: normalizedPath,
            size,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('writeFileBinary failed', { path: filePath, error: err.message });
        return {
            success: false,
            path: filePath,
            error: err.message,
        };
    }
};

/**
 * Append content to a file
 */
export const appendFile = async (
    filePath: string,
    content: string | Buffer,
): Promise<{
    success: boolean;
    path: string;
    size?: number;
    error?: string;
}> => {
    log.debug('appendFile called', { path: filePath, contentLength: content.length });
    try {
        // Resolve path relative to /sandbox if it's a relative path
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(SANDBOX_DIR, filePath);

        // Validate path is within sandbox
        const normalizedPath = path.normalize(resolvedPath);
        if (!normalizedPath.startsWith(SANDBOX_DIR)) {
            throw new Error(`Access denied: Path ${filePath} resolves outside of sandbox`);
        }

        // Ensure directory exists
        const dir = path.dirname(normalizedPath);
        await fs.mkdir(dir, { recursive: true });

        // Append to the file
        await fs.appendFile(normalizedPath, content);

        // Get final size
        const stats = await fs.stat(normalizedPath);

        log.debug('appendFile succeeded', { path: normalizedPath, size: stats.size });
        return {
            success: true,
            path: normalizedPath,
            size: stats.size,
        };
    } catch (error) {
        const err = error as Error;
        log.debug('appendFile failed', { path: filePath, error: err.message });
        return {
            success: false,
            path: filePath,
            error: err.message,
        };
    }
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
        // Resolve path relative to /sandbox if it's a relative path
        const resolvedPath = path.isAbsolute(dirPath) ? dirPath : path.join(SANDBOX_DIR, dirPath);

        // Validate path is within sandbox
        const normalizedPath = path.normalize(resolvedPath);
        if (!normalizedPath.startsWith(SANDBOX_DIR)) {
            throw new Error(`Access denied: Path ${dirPath} resolves outside of sandbox`);
        }

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
        const resolvedPath = await resolveAndValidatePath(filePath);

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
        // Use /sandbox as default, or resolve relative paths relative to /sandbox
        const targetPath = resolveDirectoryPath(dirPath);

        // Validate path is within sandbox
        const resolvedPath = await resolveAndValidatePath(targetPath);

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
        const targetPath = resolveDirectoryPath(dirPath);
        log.debug('listFilesDetailed failed', { path: targetPath, error: err.message });
        return {
            path: targetPath,
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
        const resolvedPath = await resolveAndValidatePath(dirPath);

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
