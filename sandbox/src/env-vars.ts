import { log } from 'apify';

import { isFlatJsonObject, safeParseJson } from './safe-json.js';

const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const parseJsonObject = (raw: string): Record<string, string> => {
    const parsed = safeParseJson(
        raw,
        'envVars',
        isFlatJsonObject,
        'JSON must be a flat object of string keys and string values',
    );
    if (!parsed) return {};

    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (!VALID_KEY.test(key)) {
            log.warning('envVars: skipping invalid key', { key });
            continue;
        }
        if (value === null || value === undefined) continue;
        if (typeof value === 'object') {
            log.warning('envVars: skipping non-scalar value', { key });
            continue;
        }
        out[key] = String(value);
    }
    return out;
};

const stripQuotes = (value: string): string => {
    if (value.length < 2) return value;
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return value.slice(1, -1);
    }
    return value;
};

const parseDotenv = (raw: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const stripped = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;
        const eq = stripped.indexOf('=');
        if (eq <= 0) {
            log.warning('envVars: skipping malformed line (expected KEY=VALUE)', { line: rawLine });
            continue;
        }

        const key = stripped.slice(0, eq).trim();
        const value = stripQuotes(stripped.slice(eq + 1).trim());

        if (!VALID_KEY.test(key)) {
            log.warning('envVars: skipping invalid key', { key });
            continue;
        }
        out[key] = value;
    }
    return out;
};

/**
 * Parse user-supplied envVars input. Accepts either:
 *  - a JSON object (input starts with `{`), or
 *  - dotenv-style `KEY=VALUE` lines (`#` comments and optional `export ` prefix allowed).
 *
 * Invalid keys, non-scalar JSON values, or malformed lines are skipped with a warning;
 * the actor still starts so a single bad entry doesn't break the run.
 */
export const parseEnvVars = (raw: string | undefined | null): Record<string, string> => {
    if (!raw) return {};
    const trimmed = raw.trim();
    if (!trimmed) return {};
    return trimmed.startsWith('{') ? parseJsonObject(trimmed) : parseDotenv(trimmed);
};
