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
    log.info('MCP request received', { body: req.body });
    const mcpServer = createMcpServer();
    try {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on('close', () => {
            log.info('MCP request closed');
            void transport.close();
            void mcpServer.close();
        });
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
