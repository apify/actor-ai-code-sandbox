/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
/* eslint-disable no-template-curly-in-string -- ${APIFY_TOKEN} is a literal placeholder from mcp.json, not a JS template expression */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    applyCodexConfig,
    buildClaudeMcpServers,
    buildCodexBlock,
    buildOpenCodeMcp,
    mergeClaudeConfig,
    mergeOpenCodeConfig,
    toOpenCodeEnvSyntax,
} from '../../src/mcp-agent-config.js';
import type { McpConfig } from '../../src/mcp-connections.js';

const CONFIG: McpConfig = {
    mcpServers: {
        conn_abc123: {
            url: 'https://api.apify.com/v2/mcp-proxy/conn_abc123',
            headers: { Authorization: 'Bearer ${APIFY_TOKEN}' },
        },
        'conn-def': {
            url: 'https://api.apify.com/v2/mcp-proxy/conn-def',
            headers: { Authorization: 'Bearer ${APIFY_TOKEN}' },
        },
    },
};

describe('buildClaudeMcpServers', () => {
    it('adds type:http and keeps url + headers verbatim (Claude expands ${VAR} itself)', () => {
        const servers = buildClaudeMcpServers(CONFIG);
        assert.deepEqual(servers.conn_abc123, {
            type: 'http',
            url: 'https://api.apify.com/v2/mcp-proxy/conn_abc123',
            headers: { Authorization: 'Bearer ${APIFY_TOKEN}' },
        });
    });

    it('produces one entry per connector', () => {
        assert.deepEqual(Object.keys(buildClaudeMcpServers(CONFIG)), ['conn_abc123', 'conn-def']);
    });
});

describe('mergeClaudeConfig', () => {
    it('preserves existing keys like hasCompletedOnboarding', () => {
        const merged = mergeClaudeConfig({ hasCompletedOnboarding: true }, CONFIG);
        assert.equal(merged.hasCompletedOnboarding, true);
        assert.ok((merged.mcpServers as Record<string, unknown>).conn_abc123);
    });

    it('is idempotent — re-merging yields the same servers', () => {
        const once = mergeClaudeConfig({ hasCompletedOnboarding: true }, CONFIG);
        const twice = mergeClaudeConfig(once, CONFIG);
        assert.deepEqual(twice, once);
    });
});

describe('toOpenCodeEnvSyntax', () => {
    it('rewrites ${VAR} into {env:VAR}', () => {
        assert.equal(toOpenCodeEnvSyntax('Bearer ${APIFY_TOKEN}'), 'Bearer {env:APIFY_TOKEN}');
    });

    it('leaves strings without ${VAR} unchanged', () => {
        assert.equal(toOpenCodeEnvSyntax('Bearer static-token'), 'Bearer static-token');
    });
});

describe('buildOpenCodeMcp', () => {
    it('builds remote servers with oauth:false and {env:VAR} headers', () => {
        const mcp = buildOpenCodeMcp(CONFIG);
        assert.deepEqual(mcp.conn_abc123, {
            type: 'remote',
            url: 'https://api.apify.com/v2/mcp-proxy/conn_abc123',
            enabled: true,
            oauth: false,
            headers: { Authorization: 'Bearer {env:APIFY_TOKEN}' },
        });
    });
});

describe('mergeOpenCodeConfig', () => {
    it('preserves provider/model config and adds the mcp block', () => {
        const merged = mergeOpenCodeConfig(
            { model: 'apify-openrouter/anthropic/claude-sonnet-4.5', provider: { x: 1 } },
            CONFIG,
        );
        assert.equal(merged.model, 'apify-openrouter/anthropic/claude-sonnet-4.5');
        assert.deepEqual(merged.provider, { x: 1 });
        assert.ok((merged.mcp as Record<string, unknown>)['conn-def']);
    });
});

describe('buildCodexBlock', () => {
    it('emits one [mcp_servers.<id>] table per connector with url + bearer_token_env_var', () => {
        const block = buildCodexBlock(CONFIG);
        assert.match(block, /\[mcp_servers\.conn_abc123\]/);
        assert.match(block, /\[mcp_servers\.conn-def\]/);
        assert.match(block, /url = "https:\/\/api\.apify\.com\/v2\/mcp-proxy\/conn_abc123"/);
        // The literal ${APIFY_TOKEN} must NOT leak into TOML — Codex resolves the
        // env var by name instead.
        assert.match(block, /bearer_token_env_var = "APIFY_TOKEN"/);
        assert.doesNotMatch(block, /\$\{APIFY_TOKEN\}/);
    });

    it('is wrapped in the auto-generated markers', () => {
        const block = buildCodexBlock(CONFIG);
        assert.match(block, /# >>> apify mcp connectors \(auto-generated\) >>>/);
        assert.match(block, /# <<< apify mcp connectors \(auto-generated\) <<</);
    });
});

describe('applyCodexConfig', () => {
    const BASE = 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n';

    it('preserves the base config and prepends the rmcp flag before any table', () => {
        const out = applyCodexConfig(BASE, CONFIG);
        assert.match(out, /approval_policy = "never"/);
        assert.match(out, /sandbox_mode = "danger-full-access"/);
        // The flag is a bare top-level key, so it must appear before the first table.
        const flagIdx = out.indexOf('experimental_use_rmcp_client');
        const tableIdx = out.indexOf('[mcp_servers.');
        assert.ok(flagIdx >= 0 && flagIdx < tableIdx, 'rmcp flag must precede the first [mcp_servers] table');
    });

    it('does not duplicate the rmcp flag when it is already present', () => {
        const withFlag = `experimental_use_rmcp_client = true\n${BASE}`;
        const out = applyCodexConfig(withFlag, CONFIG);
        assert.equal(out.match(/experimental_use_rmcp_client/g)?.length, 1);
    });

    it('replaces a prior generated block instead of appending a second one (idempotent)', () => {
        const once = applyCodexConfig(BASE, CONFIG);
        const twice = applyCodexConfig(once, CONFIG);
        assert.equal(twice, once);
        assert.equal(twice.match(/# >>> apify mcp connectors/g)?.length, 1);
    });

    it('reflects a changed connector list on a re-run', () => {
        const first = applyCodexConfig(BASE, CONFIG);
        const second = applyCodexConfig(first, { mcpServers: { only: CONFIG.mcpServers.conn_abc123 } });
        assert.match(second, /\[mcp_servers\.only\]/);
        assert.doesNotMatch(second, /\[mcp_servers\.conn-def\]/);
    });
});
