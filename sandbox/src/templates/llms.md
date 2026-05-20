# Apify AI Sandbox

Containerized sandbox environment for AI coding operations. Connect through HTTP, MCP, or the interactive shell.

## Quick links

- **Landing page**: <%= serverUrl %>/
- **Shell terminal**: <%= serverUrl %>/shell/
- **Health check**: <%= serverUrl %>/health
- **MCP endpoint**: <%= serverUrl %>/mcp

## Connect with MCP

URL:

```
<%= serverUrl %>/mcp
```

Claude Code:

```bash
claude mcp add --transport http sandbox <%= serverUrl %>/mcp
```

## Code execution

**POST** `<%= serverUrl %>/exec` — run shell commands or execute code snippets.

**Supported languages:** `js`, `javascript`, `ts`, `typescript`, `py`, `python`, `bash`, `sh` (or omit for shell).

### Run bash command

```bash
curl -X POST <%= serverUrl %>/exec \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la", "language": "bash", "cwd": "/sandbox", "timeoutSecs": 5}'
```

### Run Python code

```bash
curl -X POST <%= serverUrl %>/exec \
  -H "Content-Type: application/json" \
  -d '{"command": "print(\"hello\")", "language": "py", "timeoutSecs": 10}'
```

### Run TypeScript code

```bash
curl -X POST <%= serverUrl %>/exec \
  -H "Content-Type: application/json" \
  -d '{"command": "console.log(\"hello\")", "language": "ts", "timeoutSecs": 10}'
```

## Filesystem endpoints

Direct file operations using HTTP methods. All paths relative to `/sandbox`.

### Read file or list directory

```bash
curl <%= serverUrl %>/fs/app/log.txt
```

### Write or replace file

```bash
curl -X PUT <%= serverUrl %>/fs/config.json \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

### Create directory

```bash
curl -X POST <%= serverUrl %>/fs/project/src?mkdir=1
```

### Append to file

```bash
curl -X POST <%= serverUrl %>/fs/log.txt?append=1 \
  -d "New log entry"
```

### Delete file or directory

```bash
curl -X DELETE <%= serverUrl %>/fs/temp?recursive=1
```

### Get file metadata

```bash
curl -I <%= serverUrl %>/fs/data.json
```

## Proxy Mappings

Map local web servers to paths. Changes are applied immediately and persist across restarts.

### Get current mappings

```bash
curl <%= serverUrl %>/proxy-config
```

### Add a mapping

```bash
curl -X POST <%= serverUrl %>/proxy-config \
  -H "Content-Type: application/json" \
  -d '{"path": "/openclaw", "target": "http://127.0.0.1:18789/openclaw"}'
```

### Remove a mapping

```bash
curl -X DELETE <%= serverUrl %>/proxy-config/openclaw
```

## Response format

All `/exec` requests return:

```json
{
    "stdout": "string",
    "stderr": "string",
    "exitCode": 0,
    "language": "shell|js|ts|py"
}
```

## Working directories

- Shell commands: `/sandbox` (default)
- JavaScript/TypeScript: `/sandbox/js-ts` (default)
- Python: `/sandbox/py` (default)
- Override with `cwd` parameter (must be within `/sandbox`)

## Configuration

- **Idle Timeout**: The container automatically shuts down after inactivity (default 10m).
- **Execution Timeout**: Recommended to set to 0 (infinite) on the platform; use the `idleTimeoutSeconds` input to control lifecycle.
