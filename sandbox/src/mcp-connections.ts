/**
 * MCP Connections Module
 *
 * Writes /sandbox/mcp.json on sandbox start so tools like `mcpc connect`
 * can immediately find the MCP Connector proxies provided via Actor input.
 *
 * Each input value is a Connector ID (e.g. "conn_abc123"). At runtime the
 * platform exposes the matching MCP server as a proxy at
 * `${APIFY_MCP_PROXY_URL}/<connectorId>`, authenticated with `APIFY_TOKEN`.
 */

/* eslint-disable no-template-curly-in-string -- ${APIFY_TOKEN} is a literal placeholder we write to mcp.json, not a JS template expression */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { log } from 'apify';

import { SANDBOX_DIR } from './consts.js';

export const MCP_CONFIG_PATH = `${SANDBOX_DIR}/mcp.json`;

export interface McpServerEntry {
    url: string;
    headers: Record<string, string>;
}

export interface McpConfig {
    mcpServers: Record<string, McpServerEntry>;
}

/**
 * Sanitize a Connector ID for use as a JSON object key. We keep the ID as the
 * key when it's already safe to read in a shell (alphanumeric, `_`, `-`); if
 * not, we fall back to a sanitized version so the file is still well-formed.
 */
const toServerKey = (id: string): string => {
    if (/^[A-Za-z0-9_-]+$/.test(id)) return id;
    return id.replace(/[^A-Za-z0-9_-]/g, '_');
};

/**
 * Build the MCP config object from a list of Connector IDs.
 * Returns `{ mcpServers: {} }` when the input is empty/invalid so the file
 * is still a valid, well-known shape downstream tools can read.
 */
export const buildMcpConfig = (
    connectionIds: string[] | undefined,
    proxyUrl: string | undefined,
): McpConfig => {
    const config: McpConfig = { mcpServers: {} };

    if (!connectionIds || connectionIds.length === 0) return config;

    const base = (proxyUrl || '').replace(/\/+$/, '');

    for (const raw of connectionIds) {
        if (typeof raw !== 'string') continue;
        const id = raw.trim();
        if (!id) continue;

        const key = toServerKey(id);
        config.mcpServers[key] = {
            url: `${base}/${id}`,
            headers: {
                Authorization: 'Bearer ${APIFY_TOKEN}',
            },
        };
    }

    return config;
};

/**
 * Write the MCP config to /sandbox/mcp.json. Always writes a file (even when
 * the connection list is empty) so consumers can rely on its presence.
 * Logs and swallows errors — a failed write must not abort sandbox startup.
 */
export const writeMcpConfig = (connectionIds: string[] | undefined): void => {
    try {
        const proxyUrl = process.env.APIFY_MCP_PROXY_URL;
        const config = buildMcpConfig(connectionIds, proxyUrl);

        const dir = dirname(MCP_CONFIG_PATH);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        writeFileSync(MCP_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

        const count = Object.keys(config.mcpServers).length;
        log.info('Wrote MCP connections config', { path: MCP_CONFIG_PATH, count });
        if (count > 0 && !proxyUrl) {
            log.warning(
                'APIFY_MCP_PROXY_URL is not set; mcp.json entries point to an empty proxy base URL',
            );
        }
    } catch (error) {
        log.error('Failed to write MCP connections config', {
            path: MCP_CONFIG_PATH,
            error: (error as Error).message,
        });
    }
};
