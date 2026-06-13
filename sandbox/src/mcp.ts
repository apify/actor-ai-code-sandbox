// MCP Server implementation for sandbox tools (run commands, read/write files)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { log } from 'apify';
import * as z from 'zod';

import { execute, listFiles, normalizeLanguage, readFile, SUPPORTED_LANGUAGES, writeFile } from './operations.js';

/** Wrap an operation result as an MCP tool result (pretty-printed JSON). */
const jsonResult = (value: unknown, isError = false): CallToolResult => ({
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
});

/** Wrap an error message as a failed MCP tool result. */
const errorResult = (message: string): CallToolResult => ({
    content: [{ type: 'text', text: message }],
    isError: true,
});

/**
 * Creates and configures the MCP server with all sandbox tools
 */
export const createMcpServer = () => {
    const server = new McpServer(
        {
            name: 'apify-ai-sandbox',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
            },
        },
    );

    // Register execute tool (unified shell and code execution)
    server.registerTool(
        'execute',
        {
            description:
                'Executes shell commands or code snippets (JavaScript, TypeScript, Python). Each code execution is isolated in a new process.',
            inputSchema: {
                command: z.string().describe('Shell command or code snippet to execute'),
                language: z
                    .string()
                    .optional()
                    .describe('Language: js, javascript, ts, typescript, py, python, bash, sh (omit for shell)'),
                cwd: z.string().optional().describe('Working directory (overrides language defaults)'),
                timeoutSecs: z.number().optional().describe('Timeout in seconds'),
            },
        },
        async ({
            command,
            language,
            cwd,
            timeoutSecs,
        }: {
            command: string;
            language?: string;
            cwd?: string;
            timeoutSecs?: number;
        }): Promise<CallToolResult> => {
            try {
                log.info('MCP execute tool called', {
                    language,
                    commandLength: command.length,
                    cwd,
                    timeoutSecs,
                });

                const normalizedLang = normalizeLanguage(language);
                if (language && !normalizedLang) {
                    log.warning('MCP execute tool: invalid language', { language });
                    return errorResult(`Invalid language: ${language}. Supported: ${SUPPORTED_LANGUAGES}`);
                }

                const result = await execute({ command, language: normalizedLang, cwd, timeoutSecs });

                log.info('MCP execute tool completed', { language: result.language, exitCode: result.exitCode });
                return jsonResult(result, result.exitCode !== 0);
            } catch (error) {
                const err = error as Error;
                log.error('MCP execute tool error', { error: err.message });
                return errorResult(`Error executing: ${err.message}`);
            }
        },
    );

    // Register write-file tool
    server.registerTool(
        'write-file',
        {
            description: 'Writes content to a file in the sandbox',
            inputSchema: {
                path: z.string().describe('File path to write to'),
                content: z.string().describe('Content to write to the file'),
                mode: z.number().optional().describe('File mode (permissions)'),
            },
        },
        async ({ path, content, mode }: { path: string; content: string; mode?: number }): Promise<CallToolResult> => {
            try {
                log.info('MCP write-file tool called', { path, contentLength: content.length, mode });
                const result = await writeFile(path, content, mode);

                if (!result.success) {
                    log.warning('MCP write-file tool failed', { path, error: result.error });
                    return jsonResult(result, true);
                }

                log.info('MCP write-file tool completed successfully', { path });
                return jsonResult(result);
            } catch (error) {
                const err = error as Error;
                log.error('MCP write-file tool error', { path, error: err.message });
                return errorResult(`Error writing file: ${err.message}`);
            }
        },
    );

    // Register read-file tool
    server.registerTool(
        'read-file',
        {
            description:
                'Reads file contents from the sandbox. To read only a part of a file (e.g., specific lines), use the run-command tool with utilities like sed, head, tail, or grep (e.g., "sed -n 10,20p file.txt" to read lines 10-20).',
            inputSchema: {
                path: z.string().describe('File path to read from'),
            },
        },
        async ({ path }: { path: string }): Promise<CallToolResult> => {
            try {
                log.info('MCP read-file tool called', { path });
                const result = await readFile(path);

                if (result.error) {
                    log.warning('MCP read-file tool failed', { path, error: result.error });
                    return jsonResult(result, true);
                }

                log.info('MCP read-file tool completed successfully', { path, contentLength: result.content?.length });
                return jsonResult(result);
            } catch (error) {
                const err = error as Error;
                log.error('MCP read-file tool error', { path, error: err.message });
                return errorResult(`Error reading file: ${err.message}`);
            }
        },
    );

    // Register list-files tool
    server.registerTool(
        'list-files',
        {
            description: 'Lists files and directories in a sandbox path',
            inputSchema: {
                path: z.string().optional().describe('Directory path to list (defaults to current directory)'),
            },
        },
        async ({ path }: { path?: string }): Promise<CallToolResult> => {
            try {
                log.info('MCP list-files tool called', { path });
                const result = await listFiles(path);

                if (result.error) {
                    log.warning('MCP list-files tool failed', { path, error: result.error });
                    return jsonResult(result, true);
                }

                log.info('MCP list-files tool completed successfully', {
                    path: result.path,
                    fileCount: result.files.length,
                });
                return jsonResult(result);
            } catch (error) {
                const err = error as Error;
                log.error('MCP list-files tool error', { path, error: err.message });
                return errorResult(`Error listing files: ${err.message}`);
            }
        },
    );

    return server;
};
