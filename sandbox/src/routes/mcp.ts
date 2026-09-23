/**
 * POST /mcp — Streamable HTTP transport for the sandbox MCP server. Each
 * request gets a fresh stateless server/transport pair (no session ids).
 * Register AFTER express.json(); the JSON-RPC body arrives parsed.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from 'apify';
import type { Request, Response } from 'express';

import { createMcpServer } from '../mcp.js';

export const handleMcp = async (req: Request, res: Response): Promise<void> => {
    // Never log the full body: write-file and execute params carry user content.
    log.debug('MCP request received', { method: req.body?.method, tool: req.body?.params?.name });
    const mcpServer = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    // Register before handleRequest: for plain JSON responses the socket can
    // close while the request is still being handled, and a listener attached
    // afterwards would never fire, leaking the server/transport pair.
    res.on('close', () => {
        log.debug('MCP request closed');
        void transport.close();
        void mcpServer.close();
    });
    try {
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        log.error('MCP request error', { error });
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error',
                },
                id: null,
            });
        }
    }
};

/**
 * GET/DELETE /mcp — the server is stateless (no SSE stream, no sessions to
 * terminate), so per the Streamable HTTP spec these answer 405.
 */
export const handleMcpMethodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405)
        .set('Allow', 'POST')
        .json({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Method not allowed.',
            },
            id: null,
        });
};
