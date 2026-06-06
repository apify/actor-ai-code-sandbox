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

/** Apify's hosted MCP server, always available via the run's APIFY_TOKEN. */
export const APIFY_MCP_URL = 'https://mcp.apify.com';

export interface McpServerEntry {
    url: string;
    headers: Record<string, string>;
}

export interface McpConfig {
    mcpServers: Record<string, McpServerEntry>;
}

/** The always-on Apify MCP server entry seeded into every config. */
const apifyMcpServer = (): McpServerEntry => ({
    url: APIFY_MCP_URL,
    headers: { Authorization: 'Bearer ${APIFY_TOKEN}' },
});

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
 *
 * Always seeds the hosted Apify MCP server (key `apify`) so agents have it
 * available out of the box, then appends one entry per user-provided Connector.
 * Returns just the Apify entry when the input is empty/invalid, so the file is
 * never empty and downstream tools can rely on its shape.
 */
export const buildMcpConfig = (connectionIds: string[] | undefined, proxyUrl: string | undefined): McpConfig => {
    const config: McpConfig = { mcpServers: { apify: apifyMcpServer() } };

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
 *
 * Returns the config it built so the caller can hand the same server list to
 * the agent configurators (see mcp-agent-config.ts) without rebuilding it. The
 * config is returned even if the write fails, since the agent configs are
 * independent of the /sandbox/mcp.json file.
 */
export const writeMcpConfig = (connectionIds: string[] | undefined): McpConfig => {
    const proxyUrl = process.env.APIFY_MCP_PROXY_URL;
    const config = buildMcpConfig(connectionIds, proxyUrl);

    try {
        const dir = dirname(MCP_CONFIG_PATH);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        writeFileSync(MCP_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

        const count = Object.keys(config.mcpServers).length;
        log.info('Wrote MCP connections config', { path: MCP_CONFIG_PATH, count });
        if (count > 0 && !proxyUrl) {
            log.warning('APIFY_MCP_PROXY_URL is not set; mcp.json entries point to an empty proxy base URL');
        }
    } catch (error) {
        log.error('Failed to write MCP connections config', {
            path: MCP_CONFIG_PATH,
            error: (error as Error).message,
        });
    }

    return config;
};
