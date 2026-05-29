/**
 * Translate `?launch=<cmd>` on a /shell URL into the `?arg=-c&arg=...` form
 * ttyd expects. `?launch=` is a convenience: bash invoked with `-c` does not
 * source rcfiles, so we explicitly prepend `source /app/sandbox_bashrc;` to
 * ensure the launched command sees the same env as an interactive shell.
 *
 * Idempotent: if `launch` is absent, the path is returned unchanged. Other
 * query params are preserved in order.
 */
const BASHRC_SOURCE = 'source /app/sandbox_bashrc;';

export const translateLaunchParam = (path: string): string => {
    const queryIdx = path.indexOf('?');
    if (queryIdx < 0) return path;

    const basePath = path.slice(0, queryIdx);
    const params = new URLSearchParams(path.slice(queryIdx + 1));
    const launch = params.get('launch');
    if (launch === null) return path;

    params.delete('launch');
    const cmd = launch.trim() ? `${BASHRC_SOURCE} ${launch}` : BASHRC_SOURCE;

    const parts: string[] = [
        `arg=${encodeURIComponent('-c')}`,
        `arg=${encodeURIComponent(cmd)}`,
    ];
    const rest = params.toString();
    if (rest) parts.push(rest);

    return `${basePath}?${parts.join('&')}`;
};
