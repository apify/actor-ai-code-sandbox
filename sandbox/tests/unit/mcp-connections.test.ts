/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
/* eslint-disable no-template-curly-in-string -- ${APIFY_TOKEN} is a literal placeholder we write to mcp.json, not a JS template expression */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMcpConfig } from '../../src/mcp-connections.js';

const PROXY = 'https://api.apify.com/v2/mcp-proxy';

describe('buildMcpConfig', () => {
    describe('empty / nullish input', () => {
        it('returns an empty mcpServers map for undefined', () => {
            assert.deepEqual(buildMcpConfig(undefined, PROXY), { mcpServers: {} });
        });

        it('returns an empty mcpServers map for an empty array', () => {
            assert.deepEqual(buildMcpConfig([], PROXY), { mcpServers: {} });
        });

        it('skips blank / non-string entries', () => {
            // @ts-expect-error - intentionally passing non-string to exercise runtime guard
            const config = buildMcpConfig(['', '   ', null, 42, 'conn_ok'], PROXY);
            assert.deepEqual(Object.keys(config.mcpServers), ['conn_ok']);
        });
    });

    describe('valid Connector IDs', () => {
        it('builds one server entry per Connector ID', () => {
            const config = buildMcpConfig(['conn_abc123', 'conn_def456'], PROXY);
            assert.deepEqual(config, {
                mcpServers: {
                    conn_abc123: {
                        url: `${PROXY}/conn_abc123`,
                        headers: { Authorization: 'Bearer ${APIFY_TOKEN}' },
                    },
                    conn_def456: {
                        url: `${PROXY}/conn_def456`,
                        headers: { Authorization: 'Bearer ${APIFY_TOKEN}' },
                    },
                },
            });
        });

        it('uses ${APIFY_TOKEN} placeholder in Authorization header', () => {
            const config = buildMcpConfig(['conn_abc'], PROXY);
            assert.equal(config.mcpServers.conn_abc.headers.Authorization, 'Bearer ${APIFY_TOKEN}');
        });

        it('strips trailing slashes from the proxy base URL', () => {
            const config = buildMcpConfig(['conn_abc'], `${PROXY}//`);
            assert.equal(config.mcpServers.conn_abc.url, `${PROXY}/conn_abc`);
        });

        it('trims whitespace around Connector IDs', () => {
            const config = buildMcpConfig(['  conn_abc  '], PROXY);
            assert.deepEqual(Object.keys(config.mcpServers), ['conn_abc']);
            assert.equal(config.mcpServers.conn_abc.url, `${PROXY}/conn_abc`);
        });
    });

    describe('proxy URL handling', () => {
        it('falls back to an empty base when proxy URL is undefined', () => {
            const config = buildMcpConfig(['conn_abc'], undefined);
            assert.equal(config.mcpServers.conn_abc.url, '/conn_abc');
        });

        it('falls back to an empty base when proxy URL is empty string', () => {
            const config = buildMcpConfig(['conn_abc'], '');
            assert.equal(config.mcpServers.conn_abc.url, '/conn_abc');
        });
    });

    describe('key sanitization', () => {
        it('uses the raw ID as the key when it is safe', () => {
            const config = buildMcpConfig(['Conn-123_abc'], PROXY);
            assert.ok('Conn-123_abc' in config.mcpServers);
        });

        it('sanitizes IDs that contain unsafe characters', () => {
            const config = buildMcpConfig(['conn@abc/xyz'], PROXY);
            assert.ok('conn_abc_xyz' in config.mcpServers);
            // URL preserves the original ID so the proxy can route correctly
            assert.equal(config.mcpServers.conn_abc_xyz.url, `${PROXY}/conn@abc/xyz`);
        });
    });
});
