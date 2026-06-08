import { log } from 'apify';

/** Type guard for a non-null, non-array JSON object. */
export const isFlatJsonObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Safely parse user-supplied JSON and verify it matches an expected shape.
 *
 * Returns the parsed value on success, or `null` if `JSON.parse` threw or the
 * `isValid` predicate rejected the result. Both failure modes log a warning
 * labeled with `fieldName` so callers can degrade to an empty result without
 * aborting the run.
 */
export const safeParseJson = <T>(
    raw: string,
    fieldName: string,
    isValid: (parsed: unknown) => parsed is T,
    shapeDescription: string,
): T | null => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const err = error as Error;
        log.warning(`${fieldName}: failed to parse JSON input, ignoring`, { error: err.message });
        return null;
    }
    if (!isValid(parsed)) {
        log.warning(`${fieldName}: ${shapeDescription}`);
        return null;
    }
    return parsed;
};
