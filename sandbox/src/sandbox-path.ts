// Path containment for everything that takes a user-supplied path (/fs, MCP
// file tools, /exec cwd): resolve it to its real location and require it to
// stay inside /sandbox.
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { SANDBOX_DIR } from './consts.js';

/** Upper bound on symlink hops, matching Linux's MAXSYMLINKS. */
const MAX_SYMLINK_HOPS = 40;

/** True when `p` is `root` itself or below it (segment-aware, so `/sandboxx` is outside `/sandbox`). */
export const isWithinDir = (root: string, p: string): boolean => p === root || p.startsWith(`${root}/`);

/**
 * Like `fs.realpath`, but for paths that do not exist (yet): resolves the
 * deepest existing ancestor and appends the missing tail. Dangling symlinks
 * are followed to where they point, since writing through one creates the
 * file at its target.
 */
const realpathAllowMissing = async (p: string, hops = 0): Promise<string> => {
    if (hops > MAX_SYMLINK_HOPS) {
        throw Object.assign(new Error(`Too many levels of symbolic links: ${p}`), { code: 'ELOOP' });
    }
    try {
        return await fs.realpath(p);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    let linkTarget: string | null = null;
    try {
        linkTarget = await fs.readlink(p);
    } catch {
        // Not a symlink, or does not exist at all
    }
    if (linkTarget !== null) {
        return realpathAllowMissing(path.resolve(path.dirname(p), linkTarget), hops + 1);
    }

    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(await realpathAllowMissing(parent, hops + 1), path.basename(p));
};

/**
 * Resolve `p` (relative paths are taken relative to `root`) to its real
 * location, following symlinks, and throw unless it stays inside `root`.
 * Works for paths that do not exist yet, so it is safe for writes too.
 */
export const resolveWithinDir = async (root: string, p: string): Promise<string> => {
    const resolved = path.resolve(root, p);
    const realPath = await realpathAllowMissing(resolved);
    if (!isWithinDir(root, realPath)) {
        throw new Error(`Access denied: Path ${p} resolves outside of sandbox`);
    }
    return realPath;
};

/** `resolveWithinDir` for `/sandbox`; an empty path means `/sandbox` itself. */
export const resolveSandboxPath = async (p?: string): Promise<string> =>
    resolveWithinDir(SANDBOX_DIR, p || SANDBOX_DIR);
