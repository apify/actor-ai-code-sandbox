# Production-readiness review and follow-ups

Review of `sandbox/` performed 2026-09-22 at commit `2770239`. The quick wins were fixed in the same PR that added this file; everything below is what is still open, in priority order. Tick items off or delete them as they land.

**Decided, not a bug:** the container API (`/exec`, `/fs`, `/mcp`, `/shell`, `/bridges`) is intentionally unauthenticated. The container URL is the access credential. Keep this in mind when reading the rest: nothing below is an escalation beyond what `/exec` already grants, so items are ranked by data-loss, cost, and reliability impact rather than by classic security severity.

## Fixed in the quick-wins PR

- `POST /exec` with `language: js` could not `import` installed npm packages (temp file lived in `/tmp`, Node ignores `NODE_PATH` for ESM). Snippets now run from `/sandbox/js-ts/.exec` and `/sandbox/py/.exec`.
- pip / npm / skills installs went through a shell, so `numpy>=1.24` lost its version pin. Now `execFile`.
- Landing page kept the idle timer alive via its own `/bridges` and `/health` polling. Those requests now send `X-Sandbox-Passive: 1` and are excluded from activity.
- Stored XSS in the landing page bridge list (unescaped `path`/`target` in `innerHTML` and an inline `onclick`).
- `exitCode` in `/exec` responses could be a string (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`) or `1` for a signal kill with the message lost. Always numeric now, message preserved in `stderr`.
- A malformed `/sandbox/.bridges.json` could crash the process on the first WebSocket upgrade. The upgrade handler is now guarded.
- Docker build's unit-test step was a no-op because `tests/` was in `.dockerignore`; there was no CI. Both fixed (`.github/workflows/ci.yml`).
- `npm audit fix`: `path-to-regexp`, `ws`, `qs`, `minimatch` bumped. `stream-json` (via `apify`) remains and needs an upstream bump.
- Doc fixes: MCP `read-file` description referenced a nonexistent tool; `types.ts` said `envVars` reach the shell and code execution (they do not).

## 1. High: fix before or right after launch

### 1.1 ~~Idle timeout is still defeated by an open shell tab~~ (fixed)

Proxied WebSockets (`/shell` and bridges) now parse client frames (`src/ws-activity.ts`) and count only data frames as activity; ping/pong/close keepalives are ignored.

### 1.2 Migration persistence can lose data and is expensive

`Actor.on('persistState')` fires **every 60 s** by default, not only on migration. Each firing runs `find / -xdev` over the whole root filesystem, tars every changed file, and uploads to the KV store.

- If `find` times out (30 s) or exceeds its 50 MB buffer, `findChangedFiles()` returns `[]` and an **empty tarball is uploaded over the last good snapshot**. The next migration restores nothing.
- No in-flight guard: a slow save overlaps the next one, both writing the same `/tmp` paths.
- Nothing under `/root` or `/usr` is excluded, so lazily installed agent binaries (`~/.local/bin/claude`, `~/.opencode`, `~/.codex`) and npm/pip caches are tarred every minute; KV rejects oversize records (`record-too-large`) and the failure is only logged.
- `tar … 2>/dev/null || true` hides tar failures.

Do: snapshot only when `isMigrating` (or throttle heavily); add a lock; never upload when `find` failed; extend `MIGRATION_EXCLUDED_PATHS` (`/root/.local`, `/root/.opencode`, `/root/.codex/bin`, `/root/.npm`, `/root/.cache`, `/usr`, `/var/log`); re-run the lazy agent installers on restore instead of shipping binaries; check tar's exit code; cap tarball size.

### 1.3 ~~`/exec` and `/fs` resource limits~~ (fixed)

- ~~`exec()` 1 MB `maxBuffer` and no default timeout~~ (fixed): `/exec` and the MCP `execute` tool run through `src/process-runner.ts`. Output is capped at 10 MB per stream with a truncation marker, the default timeout is 300 s, and a timeout kills the whole process group.
- ~~`/fs` buffers whole request bodies (up to 500 MB) and whole files in memory~~ (fixed): uploads stream to a temp file next to the target and are then renamed (PUT) or appended (POST `?append=1`) into place, so an aborted or oversize upload leaves the file untouched; downloads stream from disk. The 500 MB cap is enforced on the decoded byte count (413).

## 2. Medium

- ~~**Path containment is inconsistent with the docs.**~~ (fixed): every user-supplied path (`/fs`, MCP `read-file`/`write-file`/`list-files`, `/exec` and MCP `execute` `cwd` for all languages) goes through `src/sandbox-path.ts`, which resolves symlinks (including for not-yet-existing files and dangling links) and checks containment on a segment boundary.
- ~~**Bridge matching and validation.**~~ (fixed): `matchBridge` matches on a segment boundary. API, Actor input and `.bridges.json` entries all go through `normalizeBridge()` in `src/bridges.ts` (path normalization, reserved-path and target URL checks); the API returns 400 and file/input entries are skipped with a warning. The watcher handles `rename` (atomic saves), `saveBridges` writes atomically, and only proxies whose target changed are recreated.
- ~~**`/health` can never report `initializing`.**~~ (fixed): the dead 503 `initializing` branch and its README line were removed; the server still starts listening only after setup completes.
- ~~**Log hygiene.**~~ (fixed): `routes/mcp.ts` logs only the JSON-RPC method and tool name, at `debug`; `routes/exec.ts` logs the command length at `info` and the 100-char preview only at `debug`.
- ~~**MCP transport cleanup.**~~ (fixed): `res.on('close')` is registered before `handleRequest`, so the transport and server are always closed. `GET`/`DELETE /mcp` return 405 with `Allow: POST`.
- ~~**`Content-Disposition` header can throw**~~ (fixed): `/fs` downloads use `res.attachment()`, which encodes the filename per RFC 6266/5987.
- **Stale manifest after a failed restore.** If the manifest exists but the tarball is missing, startup proceeds fresh but leaves the manifest to be re-read next time.
- **ttyd binds all interfaces.** Add `-i 127.0.0.1`.
- **Unpinned runtime downloads.** `npx -y skills` and the `curl | bash` agent installers are unpinned by design; note it in the README threat model.

## 3. Low / hygiene

- `BASELINE_DPKG` is captured in the Dockerfile but never used; `parseAptHistory` reinstalls every package the Dockerfile installed on each restore unless the base image clears `/var/log/apt/history.log`. Implement the baseline diff or truncate the log at build time.
- `initializeNodeEnvironment` recreates `package.json` without `apify-client` if `node_modules` is missing but `package.json` exists.
- `tsconfig.json` `"lib": ["DOM"]` replaces `ESNext` from `@apify/tsconfig`; it works only because `@types/node` references the ES lib. Use `["ESNext", "DOM"]`.
- `package.json` placeholders: `author`, `license: ISC`, `version: 0.0.1`; `@types/archiver` and `@types/mime-types` are in `dependencies`.
- Dockerfile uses `npm install` rather than `npm ci` / `npm ci --omit=dev`.
- `isLocalMode` is computed in four modules.
- e2e harness picks the latest run on the whole account (`apify runs ls --limit 1`); parse the run ID from `apify call` instead. Add an e2e case that `import`s an installed npm dependency and one that checks a pip version pin.
- `http-proxy@1.18.1` has had no release since 2020; plan a replacement.

## 4. Documentation

- `README.md`: describe persistence exclusions and size caveats once 1.2 lands; state the no-auth model explicitly.
- `sandbox/AGENTS.md` (dev guide): drop template leftovers (fill `generatedBy`, Crawlee/Cheerio advice, standby readiness-probe section, `?arg=` as the documented way to run a command).
- `artifacts/AGENTS.md` (shipped to agents): lead with the pre-configured MCP path; trim the "CRITICAL" repetition.
- `.actor/actor.json` `meta.generatedBy` is stale.
