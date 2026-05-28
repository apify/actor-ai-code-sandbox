import { log } from 'apify';

import { isFlatJsonObject, safeParseJson } from './safe-json.js';

/**
 * Parse a `{ "package": "version" }` object. Coerces numeric versions to
 * strings and null/empty values to `latest`; malformed JSON degrades to `{}`
 * with a warning so a single bad character does not abort the run.
 */
const parseJsonObject = (raw: string): Record<string, string> => {
    const parsed = safeParseJson(
        raw,
        'nodeDependencies',
        isFlatJsonObject,
        'JSON must be a flat object of package names to version strings',
    );
    if (!parsed) return {};

    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
        const pkg = name.trim();
        if (!pkg) continue;
        if (value === null || value === undefined || value === '') {
            out[pkg] = 'latest';
            continue;
        }
        if (typeof value !== 'string' && typeof value !== 'number') {
            log.warning('nodeDependencies: skipping non-string version', { package: pkg });
            continue;
        }
        out[pkg] = String(value);
    }
    return out;
};

/**
 * Split a `package@version` line on the version separator. Returns `[name, version]`.
 *
 * Handles scoped packages (`@scope/name@version`) by splitting on the last `@`,
 * not the first. A bare `package` (no `@version`) returns `version = 'latest'`.
 */
const splitSpec = (spec: string): [string, string] | null => {
    const trimmed = spec.trim();
    if (!trimmed) return null;

    const isScoped = trimmed.startsWith('@');
    const versionAt = isScoped ? trimmed.indexOf('@', 1) : trimmed.indexOf('@');

    if (versionAt < 0) return [trimmed, 'latest'];

    const name = trimmed.slice(0, versionAt).trim();
    const version = trimmed.slice(versionAt + 1).trim();
    if (!name) return null;
    return [name, version || 'latest'];
};

const parseLines = (raw: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const split = splitSpec(line);
        if (!split) {
            log.warning('nodeDependencies: skipping malformed line', { line: rawLine });
            continue;
        }
        out[split[0]] = split[1];
    }
    return out;
};

/**
 * Parse the user-supplied `nodeDependencies` input. Accepts either:
 *  - npm CLI-style lines: one `package@version` per line (`#` comments ignored,
 *    missing `@version` defaults to `latest`, scoped packages supported), or
 *  - a JSON object (input starts with `{`): `{ "package-name": "version", ... }`.
 *
 * Returns a `{ name: version }` object suitable for `installNodeLibraries`.
 */
export const parseNodeDependencies = (raw: string | undefined | null): Record<string, string> => {
    if (!raw) return {};
    const trimmed = raw.trim();
    if (!trimmed) return {};
    return trimmed.startsWith('{') ? parseJsonObject(trimmed) : parseLines(trimmed);
};
