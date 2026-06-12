/**
 * Express 5 route-parameter helpers.
 *
 * In Express 5 (path-to-regexp v8), a named wildcard like `/fs/*path` captures
 * the matched segments as an ARRAY (`/fs/a/b.txt` → `['a', 'b.txt']`), not a
 * string. Coercing that with `String(...)` joins the segments with commas
 * (`'a,b.txt'`), silently corrupting every nested path — which is exactly the
 * bug the Express 4 → 5 migration introduced. Always go through this helper.
 */

/**
 * Convert a wildcard route param (`req.params.<name>`) back into the matched
 * URL path, joining segments with `/`. Returns `''` when the param is absent.
 */
export const wildcardPath = (param: unknown): string => {
    if (param === undefined || param === null) return '';
    if (Array.isArray(param)) return param.map(String).join('/');
    return String(param);
};
