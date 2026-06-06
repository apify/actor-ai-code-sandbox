/**
 * MCP Agent Configuration Module
 *
 * Translates the user's MCP Connectors (the same list written to
 * /sandbox/mcp.json by mcp-connections.ts) into the native config format of
 * each pre-installed coding agent — Claude Code, Codex, and OpenCode — so the
 * connectors are available as tools the moment the agent starts, with no
 * `claude mcp add` / `mcpc connect` step.
 *
 * Why a translation step rather than pointing every agent at /sandbox/mcp.json:
 * the three agents disagree on both the config schema and the env-var syntax.
 *   - Claude Code: ~/.claude.json top-level `mcpServers`, entries need
 *     `"type": "http"`, and `${VAR}` is expanded natively in header values.
 *   - Codex: ~/.codex/config.toml `[mcp_servers.<id>]` with `url`; TOML strings
 *     are NOT interpolated, so a bearer token is referenced by env-var NAME via
 *     `bearer_token_env_var`. HTTP transport is gated behind the top-level
 *     `experimental_use_rmcp_client` flag.
 *   - OpenCode: ~/.config/opencode/opencode.json top-level `mcp`, entries use
 *     `"type": "remote"` and the `{env:VAR}` substitution syntax.
 *
 * Each agent's existing config (onboarding flags, provider/model defaults,
 * approval policy) is preserved — we only add/replace the MCP server entries.
 * All writes log and swallow errors so a failure never aborts sandbox startup.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { log } from 'apify';

import type { McpConfig, McpServerEntry } from './mcp-connections.js';

const HOME = homedir();

/** Config file each agent reads its MCP servers from (all under the user's home). */
export const CLAUDE_CONFIG_PATH = join(HOME, '.claude.json');
export const CODEX_CONFIG_PATH = join(HOME, '.codex', 'config.toml');
export const OPENCODE_CONFIG_PATH = join(HOME, '.config', 'opencode', 'opencode.json');

/** Markers around the Codex block we own, so re-runs replace rather than duplicate it. */
const CODEX_BLOCK_START = '# >>> apify mcp connectors (auto-generated) >>>';
const CODEX_BLOCK_END = '# <<< apify mcp connectors (auto-generated) <<<';

// ---------------------------------------------------------------------------
// Claude Code — ~/.claude.json top-level `mcpServers`
// ---------------------------------------------------------------------------

export interface ClaudeHttpServer {
    type: 'http';
    url: string;
    headers: Record<string, string>;
}

/**
 * Build Claude Code's `mcpServers` map. Claude expands `${VAR}` in header
 * values itself, so the entries are used verbatim apart from the required
 * `"type": "http"` discriminator.
 */
export const buildClaudeMcpServers = (config: McpConfig): Record<string, ClaudeHttpServer> => {
    const servers: Record<string, ClaudeHttpServer> = {};
    for (const [key, entry] of Object.entries(config.mcpServers)) {
        servers[key] = { type: 'http', url: entry.url, headers: { ...entry.headers } };
    }
    return servers;
};

/**
 * Merge the MCP servers into an existing parsed ~/.claude.json object, leaving
 * every other key (e.g. `hasCompletedOnboarding`) untouched.
 */
export const mergeClaudeConfig = (existing: Record<string, unknown>, config: McpConfig): Record<string, unknown> => {
    const prior = (existing.mcpServers as Record<string, unknown>) ?? {};
    return { ...existing, mcpServers: { ...prior, ...buildClaudeMcpServers(config) } };
};

// ---------------------------------------------------------------------------
// OpenCode — ~/.config/opencode/opencode.json top-level `mcp`
// ---------------------------------------------------------------------------

export interface OpenCodeRemoteServer {
    type: 'remote';
    url: string;
    enabled: true;
    /** Disable OAuth discovery so the static Authorization header is used as-is. */
    oauth: false;
    headers: Record<string, string>;
}

/** Rewrite shell-style `${VAR}` references into OpenCode's `{env:VAR}` syntax. */
export const toOpenCodeEnvSyntax = (value: string): string =>
    value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, '{env:$1}');

/**
 * Build OpenCode's `mcp` map. Each connector becomes a remote server with
 * header values converted to `{env:VAR}` so OpenCode resolves the token at
 * launch time.
 */
export const buildOpenCodeMcp = (config: McpConfig): Record<string, OpenCodeRemoteServer> => {
    const servers: Record<string, OpenCodeRemoteServer> = {};
    for (const [key, entry] of Object.entries(config.mcpServers)) {
        const headers: Record<string, string> = {};
        for (const [name, val] of Object.entries(entry.headers)) {
            headers[name] = toOpenCodeEnvSyntax(val);
        }
        servers[key] = { type: 'remote', url: entry.url, enabled: true, oauth: false, headers };
    }
    return servers;
};

/** Merge the MCP servers into an existing parsed opencode.json, preserving provider/model config. */
export const mergeOpenCodeConfig = (existing: Record<string, unknown>, config: McpConfig): Record<string, unknown> => {
    const prior = (existing.mcp as Record<string, unknown>) ?? {};
    return { ...existing, mcp: { ...prior, ...buildOpenCodeMcp(config) } };
};

// ---------------------------------------------------------------------------
// Codex — ~/.codex/config.toml `[mcp_servers.<id>]`
// ---------------------------------------------------------------------------

/** Quote a value as a TOML basic string, escaping backslashes and double quotes. */
const tomlString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Match a bearer token whose entire value is a single `${VAR}` reference. */
const BEARER_ENV_REF = /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
/** Match a header whose entire value is a single `${VAR}` reference. */
const WHOLE_ENV_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/**
 * Render one Codex `[mcp_servers.<key>]` table. Codex does not interpolate env
 * vars in TOML strings, so it exposes dedicated keys that take an env-var NAME:
 *   - an `Authorization: Bearer ${VAR}` header maps to `bearer_token_env_var`,
 *   - any other whole-value `${VAR}` header maps to `env_http_headers`,
 *   - anything else is written literally under `http_headers`.
 * The connector list only ever produces the bearer case, but the fallbacks keep
 * the translation faithful for any header shape.
 */
const codexServerTable = (key: string, entry: McpServerEntry): string => {
    const lines = [`[mcp_servers.${key}]`, `url = ${tomlString(entry.url)}`];

    let bearerEnvVar: string | undefined;
    const envHeaders: [string, string][] = [];
    const literalHeaders: [string, string][] = [];

    for (const [name, value] of Object.entries(entry.headers)) {
        const bearer = name.toLowerCase() === 'authorization' ? BEARER_ENV_REF.exec(value) : null;
        const whole = WHOLE_ENV_REF.exec(value);
        if (bearer) {
            bearerEnvVar = bearer[1];
        } else if (whole) {
            envHeaders.push([name, whole[1]]);
        } else {
            literalHeaders.push([name, value]);
        }
    }

    if (bearerEnvVar) lines.push(`bearer_token_env_var = ${tomlString(bearerEnvVar)}`);
    if (literalHeaders.length > 0) {
        const inline = literalHeaders.map(([n, v]) => `${tomlString(n)} = ${tomlString(v)}`).join(', ');
        lines.push(`http_headers = { ${inline} }`);
    }
    if (envHeaders.length > 0) {
        const inline = envHeaders.map(([n, v]) => `${tomlString(n)} = ${tomlString(v)}`).join(', ');
        lines.push(`env_http_headers = { ${inline} }`);
    }
    // Remote servers reach Codex through a proxy that may cold-start; the 10s
    // default startup timeout is tight, so give the handshake more room.
    lines.push('startup_timeout_sec = 20');

    return lines.join('\n');
};

/** Build the marker-delimited Codex block holding every connector's server table. */
export const buildCodexBlock = (config: McpConfig): string => {
    const tables = Object.entries(config.mcpServers).map(([key, entry]) => codexServerTable(key, entry));
    return [CODEX_BLOCK_START, ...tables, CODEX_BLOCK_END].join('\n\n');
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splice the connector block into existing config.toml text. Replaces a prior
 * auto-generated block if present (idempotent across restarts/migrations), and
 * ensures the top-level `experimental_use_rmcp_client` flag that gates HTTP MCP
 * transport is set — prepended so it stays ahead of any `[table]` headers, as
 * TOML requires of bare top-level keys.
 */
export const applyCodexConfig = (existing: string, config: McpConfig): string => {
    // Drop any block we wrote previously, plus the blank lines hugging it.
    const blockPattern = new RegExp(
        `\\n*${escapeRegExp(CODEX_BLOCK_START)}[\\s\\S]*?${escapeRegExp(CODEX_BLOCK_END)}\\n*`,
    );
    let text = existing.replace(blockPattern, '\n').replace(/\s+$/, '');

    if (!/^\s*experimental_use_rmcp_client\s*=/m.test(text)) {
        text = `experimental_use_rmcp_client = true\n${text}`;
    }

    return `${text}\n\n${buildCodexBlock(config)}\n`;
};

// ---------------------------------------------------------------------------
// Side effects: read each agent's config, merge in the connectors, write it back
// ---------------------------------------------------------------------------

/** Read and JSON-parse a config file. Returns `{}` if absent, `null` if unreadable/corrupt. */
const readJsonConfig = (path: string): Record<string, unknown> | null => {
    if (!existsSync(path)) return {};
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            log.warning('Existing agent config is not a JSON object; leaving it unchanged', { path });
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        // Don't clobber a config we can't understand — better to keep the
        // working baked-in defaults than overwrite them with a partial file.
        log.warning('Failed to parse existing agent config; leaving it unchanged', {
            path,
            error: (error as Error).message,
        });
        return null;
    }
};

const writeFileEnsuringDir = (path: string, contents: string): void => {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, contents);
};

const configureClaude = (config: McpConfig): void => {
    const existing = readJsonConfig(CLAUDE_CONFIG_PATH);
    if (!existing) return;
    const merged = mergeClaudeConfig(existing, config);
    writeFileEnsuringDir(CLAUDE_CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`);
};

const configureOpenCode = (config: McpConfig): void => {
    const existing = readJsonConfig(OPENCODE_CONFIG_PATH);
    if (!existing) return;
    const merged = mergeOpenCodeConfig(existing, config);
    writeFileEnsuringDir(OPENCODE_CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`);
};

const configureCodex = (config: McpConfig): void => {
    const existing = existsSync(CODEX_CONFIG_PATH) ? readFileSync(CODEX_CONFIG_PATH, 'utf8') : '';
    writeFileEnsuringDir(CODEX_CONFIG_PATH, applyCodexConfig(existing, config));
};

/**
 * Load the user's MCP Connectors into Claude Code, Codex, and OpenCode so they
 * appear as tools on launch. No-op when no connectors are configured (the
 * agents keep their baked-in defaults). Each agent is configured independently
 * and failures are logged but never thrown.
 */
export const configureAgentMcpServers = (config: McpConfig): void => {
    const count = Object.keys(config.mcpServers).length;
    if (count === 0) {
        log.debug('No MCP connectors configured; leaving agent configs untouched');
        return;
    }

    const agents: [string, (config: McpConfig) => void][] = [
        ['Claude Code', configureClaude],
        ['Codex', configureCodex],
        ['OpenCode', configureOpenCode],
    ];

    for (const [name, configure] of agents) {
        try {
            configure(config);
            log.info(`Configured ${name} with MCP connectors`, { count });
        } catch (error) {
            log.error(`Failed to configure ${name} with MCP connectors`, {
                error: (error as Error).message,
            });
        }
    }
};
