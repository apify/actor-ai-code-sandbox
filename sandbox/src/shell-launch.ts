/**
 * Translate `?launch=<cmd>` on a /shell URL into the `?arg=-c&arg=...` form
 * ttyd expects, running <cmd> inside a persistent interactive shell.
 *
 * Why the interactive wrapper: ttyd has no `--once`, so when the spawned
 * process exits the browser reconnects and ttyd respawns it. A bare
 * `bash -c "...; <cmd>"` exits the moment <cmd> finishes (or fails to start),
 * which produced a restart loop. Instead we:
 *   1. source the sandbox rcfile (so <cmd> sees the same env + wrappers),
 *   2. echo the command so it's visible (as if typed at the prompt),
 *   3. run it, surfacing a non-zero exit status,
 *   4. `exec` an interactive shell so the terminal stays alive afterwards —
 *      keeping any output or errors on screen instead of looping away.
 *
 * Idempotent: if `launch` is absent, the path is returned unchanged. Other
 * query params are preserved in order.
 */
const BASHRC = '/app/sandbox_bashrc';
const INTERACTIVE_SHELL = `exec bash --rcfile ${BASHRC}`;

/** Build the `bash -c` payload for a launched command. */
const buildLaunchCommand = (launch: string): string => {
    if (!launch.trim()) return INTERACTIVE_SHELL;
    return [
        `source ${BASHRC};`,
        `echo "$ ${launch}";`,
        `${launch} || echo "[command exited with status $?]";`,
        INTERACTIVE_SHELL,
    ].join(' ');
};

export const translateLaunchParam = (path: string): string => {
    const queryIdx = path.indexOf('?');
    if (queryIdx < 0) return path;

    const basePath = path.slice(0, queryIdx);
    const params = new URLSearchParams(path.slice(queryIdx + 1));
    const launch = params.get('launch');
    if (launch === null) return path;

    params.delete('launch');
    const cmd = buildLaunchCommand(launch);

    const parts: string[] = [
        `arg=${encodeURIComponent('-c')}`,
        `arg=${encodeURIComponent(cmd)}`,
    ];
    const rest = params.toString();
    if (rest) parts.push(rest);

    return `${basePath}?${parts.join('&')}`;
};
