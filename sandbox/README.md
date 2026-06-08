# Apify AI Code Sandbox

Secure, isolated container for executing arbitrary code, built for AI coding agents and untrusted code.
Connect over **MCP**, a **REST API**, or an **interactive browser shell**.
Ships with **Claude Code**, **Codex CLI**, and **OpenCode** pre-configured and ready to launch.

This Actor launches a web server on the Actor container URL that provides interface to the sandbox.

## Use cases

- **Run untrusted or AI-generated code safely** in an isolated container with controlled resources. 🔒
- **Give AI agents a managed workspace** to write, run, and test code — with state that survives container migrations. 🤖
- **Drop in over MCP** so any MCP client gains code-execution and filesystem tools, no glue code. 🔌
- **Pair with coding agents** (Claude Code, Codex CLI, OpenCode) right in the browser shell. 💻
- **Expose internal services** (dev servers, dashboards, TUIs) at a public URL with bridges. 🌐
- **Orchestrate Apify Actors** using the limited-permission `APIFY_TOKEN` available inside the sandbox to run other [limited-permission Actors](https://docs.apify.com/platform/actors/development/permissions) and build data pipelines. 🎭


## Quickstart

1. Run the Actor on the [Apify platform](https://console.apify.com/) (Console or API).
2. Open the sandbox **landing page** (the container URL shown in the Actor output) for live links and connection details.
3. Connect with an MCP client, call the REST API, or open the shell.

Examples below use `https://UNIQUE-ID.runs.apify.net` as the container URL — replace it with your run's URL.


## 🖥️ Interactive shell — `/shell`

Browser terminal (powered by ttyd) for hands-on work inside the sandbox.

- `https://UNIQUE-ID.runs.apify.net/shell` — plain Bash shell.
- `…/shell?launch=claude` — launch **Claude Code**.
- `…/shell?launch=codex` — launch **Codex CLI**.
- `…/shell?launch=opencode` — launch **OpenCode**.
- `…/shell?launch=<command>` — run any command, then drop into a shell.

The coding agents are installed on first use and start pre-configured against the [Apify OpenRouter proxy](https://apify.com/apify/openrouter),
billed to your Apify account.


## 🤖 AI agent instructions

The sandbox landing page is also available as Markdown as the `/llms.txt` file:

```
https://UNIQUE-ID.runs.apify.net/llms.txt
```


## 📡 Connect with MCP — `/mcp`

Streamable-HTTP MCP endpoint, no authentication required:

```
https://UNIQUE-ID.runs.apify.net/mcp
```

Add it to an MCP client:

```bash
claude mcp add --transport http sandbox https://UNIQUE-ID.runs.apify.net/mcp
codex mcp add sandbox --url https://UNIQUE-ID.runs.apify.net/mcp
mcpc connect https://UNIQUE-ID.runs.apify.net/mcp @sandbox
```

Tools exposed: `execute` (shell / JS / TS / Python), `read-file`, `write-file`, `list-files`.

## ⚡ Code execution API — `/exec`

`POST /exec` runs a shell command or a code snippet.

- Body: `{ command: string; language?: string; cwd?: string; timeoutSecs?: number }`
- `language`: `bash`/`sh` (or omit) for shell; `js`/`javascript`, `ts`/`typescript`, `py`/`python` for code.
- Returns `{ stdout, stderr, exitCode, language }` — `200` on success, `500` on a non-zero exit or error.

```bash
curl -X POST https://UNIQUE-ID.runs.apify.net/exec \
  -H "Content-Type: application/json" \
  -d '{"command": "print(\"hi\")", "language": "py", "timeoutSecs": 10}'
```

Default working directories: shell → `/sandbox`, JS/TS → `/sandbox/js-ts`, Python → `/sandbox/py`. Override with `cwd` (must stay within `/sandbox`).


## 📁 Filesystem API — `/fs`

Direct file operations over HTTP. All paths are relative to `/sandbox` and validated to stay inside it.

- `GET /fs/{path}` — read a file (raw bytes) or list a directory (JSON `{ path, entries }`). Add `?download=1` to get a file as an attachment or a directory as a ZIP.
- `PUT /fs/{path}` — write/replace a file (creates parent dirs; up to 500 MB).
- `POST /fs/{path}?mkdir=1` — create a directory; `?append=1` — append to a file.
- `DELETE /fs/{path}` — delete; add `?recursive=1` for non-empty directories.
- `HEAD /fs/{path}` — return metadata in the response headers.

```bash
curl https://UNIQUE-ID.runs.apify.net/fs/app/log.txt                            # read
curl -X PUT https://UNIQUE-ID.runs.apify.net/fs/config.json -d '{"key":"value"}' # write
curl -X POST "https://UNIQUE-ID.runs.apify.net/fs/project/src?mkdir=1"           # mkdir
curl -X DELETE "https://UNIQUE-ID.runs.apify.net/fs/temp?recursive=1"            # delete
```

Prefer a UI? Browse the filesystem at `/browse`.


## 🔀 Bridges — `/bridges`

Expose a web server you start **inside** the sandbox at a public URL path on the container, reachable over HTTP and WebSocket. Each bridge forwards `…/{path}` → `http://127.0.0.1:{port}/…`.

- `GET /bridges` — list current bridges.
- `POST /bridges` — add one: `{ "path": "/myapp", "target": "http://127.0.0.1:3000/myapp" }`.
- `PUT /bridges` — replace all: `{ "bridges": [ … ] }`.
- `DELETE /bridges/{path}` — remove one.

```bash
# Start a server inside the sandbox, then expose it:
curl -X POST https://UNIQUE-ID.runs.apify.net/bridges \
  -H "Content-Type: application/json" \
  -d '{"path": "/myapp", "target": "http://127.0.0.1:8080"}'
# Now reachable at https://UNIQUE-ID.runs.apify.net/myapp/
```

Bridges can also be set via the `bridges` input or by writing `/sandbox/.bridges.json` (changes are picked up live). Longest-path matching and `Location`-header rewriting are automatic, and bridges persist across restarts.


## Health & status — `/health`

`GET /health` reports the service state:

- `200 { status: "healthy", idleTimeoutSecs, remainingSecs? }`
- `503 { status: "initializing" }` — dependencies / setup script still running.
- `503 { status: "unhealthy", message }` — setup failed; check the run log.

`remainingSecs` counts down to idle shutdown and is present only while an idle timeout is active.

## Configuration

All inputs are optional. Set them in the Actor input form or via the API.

| Input                                          | Description                                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent skills** (`agentSkills`)               | SKILLS.md packages for the coding agents — `owner/repo` or a repo URL per line, or a JSON array. Defaults to `apify/agent-skills`. See [skills.sh](https://skills.sh/). |
| **Node.js dependencies** (`nodeDependencies`)  | npm packages for JS/TS execution. One `package@version` per line (npm-style), or a `package.json`-style JSON object.                                                    |
| **Python requirements** (`pythonRequirements`) | pip packages for Python execution, in `requirements.txt` format.                                                                                                        |
| **MCP connectors** (`mcpConnectors`)           | MCP connectors to pre-load into Claude Code, Codex, and OpenCode, and write to `/sandbox/mcp.json` for `mcpc`.                                                          |
| **Setup script** (`initBashScript`)            | Bash script run on startup after dependencies install. Output streams to the log (tagged `[init]`) with a progress heartbeat; 5-minute timeout.                         |
| **Environment variables** (`envVars`)          | Secret variables exposed **only to the setup script**, then removed before the shell, MCP server, and code execution start. dotenv or JSON; encrypted at rest.          |
| **Idle timeout** (`idleTimeoutSecs`)           | Seconds of inactivity before automatic shutdown (default `900`; `0` disables). Activity includes HTTP requests and shell interaction.                                   |
| **Bridges** (`bridges`)                        | Bridges to create at startup (see above).                                                                                                                               |

Dependencies install at startup before any code runs. For cost efficiency, set the Actor's **Execution Timeout to 0 (infinite)** and let the idle timeout manage the lifecycle. Note that every request to the Actor has a 5-minute ceiling, so each operation must finish within that window.

## Sandbox environment

- **Base image:** Debian Trixie with **Node.js 24** and **Python 3** (`venv` at `/sandbox/py/venv`).
- **Pre-installed tools:** git, openssh-client, curl, wget, jq, build-essential, `tsx`, `apify-cli`, `mcpc`, and `ttyd`; `apify-client` is ready in both the Node and Python environments.
- **Coding agents:** Claude Code, Codex CLI, and OpenCode — installed on first launch and wired to the Apify OpenRouter proxy (authenticated with `APIFY_TOKEN`).
- **Working directories:** `/sandbox` (shell), `/sandbox/js-ts` (npm packages in `node_modules`), `/sandbox/py` (Python venv).
- **Persistence:** filesystem changes are backed up to the Actor's key-value store and restored after a container migration, so work survives restarts (dependency directories are excluded and reinstalled).
- **Agent context:** `AGENTS.md` and `CLAUDE.md` are placed in `/sandbox` to guide the coding agents.

## Learn more

- [Apify Actors documentation](https://docs.apify.com/platform/actors)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Apify SDK reference](https://docs.apify.com/sdk)
