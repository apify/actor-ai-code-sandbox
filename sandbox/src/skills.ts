import { log } from 'apify';

/**
 * Trim entries, drop blanks and non-strings, and de-duplicate while preserving
 * the original order.
 */
const cleanList = (values: unknown[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        if (typeof value !== 'string') {
            log.warning('skills: skipping non-string entry');
            continue;
        }
        const skill = value.trim();
        if (!skill || seen.has(skill)) continue;
        seen.add(skill);
        out.push(skill);
    }
    return out;
};

/**
 * Parse a JSON array of skill name strings. Malformed JSON or a non-array value
 * degrades to `[]` with a warning so a single bad character does not abort the run.
 */
const parseJsonArray = (raw: string): string[] => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const err = error as Error;
        log.warning('skills: failed to parse JSON input, ignoring', { error: err.message });
        return [];
    }

    if (!Array.isArray(parsed)) {
        log.warning('skills: JSON must be an array of skill name strings');
        return [];
    }
    return cleanList(parsed);
};

const parseLines = (raw: string): string[] => {
    const out: string[] = [];
    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        out.push(line);
    }
    return out;
};

/**
 * Parse the user-supplied `skills` input into a de-duplicated list of skill
 * identifiers for `installSkills`. Accepts either:
 *  - one skill per line (e.g. `anthropics/skills`; blank lines and `#` comments ignored), or
 *  - a JSON array of skill name strings (input starting with `[` or `{` is parsed
 *    as JSON; any non-array JSON yields no skills).
 *
 * Also accepts an actual string array, which task inputs saved while `skills`
 * was a `stringList` (and programmatic callers) may still send.
 */
export const parseSkills = (raw: string | string[] | undefined | null): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return cleanList(raw);

    const trimmed = raw.trim();
    if (!trimmed) return [];
    const looksLikeJson = trimmed.startsWith('[') || trimmed.startsWith('{');
    return looksLikeJson ? parseJsonArray(trimmed) : cleanList(parseLines(trimmed));
};
