# Agent Instructions for Apify AI Code Sandbox

This document contains instructions for AI coding agents working inside the Apify AI Code Sandbox Actor.

## Sharing Files and Data with Users

### 🚨 CRITICAL: Always Generate Signed Public URLs

When sharing data with users, **NEVER return just storage IDs or raw API URLs** — they require authentication.
**ALWAYS generate signed public URLs** that work without authentication.

### 🚨 CRITICAL: Create a New Storage for Your Outputs

The sandbox Actor run's own default storages are **not available** to you: the `ACTOR_*` environment variables (e.g. `ACTOR_DEFAULT_DATASET_ID`, `ACTOR_DEFAULT_KEY_VALUE_STORE_ID`) are not set, so `apify actor set-value` and `apify actor push-data` do **not** work. Instead:

1. **Create a new storage** with `apify-client` (`get_or_create()` / `getOrCreate()` without a name creates a fresh unnamed storage).
2. **Write your outputs** into it.
3. **Generate a signed public URL** and share it with the user.
4. **Save the storage ID** to a file (e.g. `/sandbox/output-storage.json`) and reuse it for further outputs in the same session, instead of creating a new storage every time.

If you only want to share the results of an Actor you ran, you don't need a new storage at all: generate a signed URL for that run's dataset or key-value store directly (see [Using Apify Actors](#using-apify-actors)).

### Key-Value Stores (Files & Binary Data)

Use for: Documents, images, videos, archives, large text files, non-JSON data

**Common content types:** `text/plain`, `text/csv`, `application/json`, `application/pdf`, `image/png`, `image/jpeg`, `application/zip`

**Upload a file and generate a public URL (Python):**

```python
from apify_client import ApifyClient
import os

client = ApifyClient(os.environ['APIFY_TOKEN'])

# Create a new unnamed key-value store for outputs
store_id = client.key_value_stores().get_or_create().id
store = client.key_value_store(store_id)

with open('/sandbox/report.pdf', 'rb') as f:
    store.set_record('report.pdf', f.read(), content_type='application/pdf')

# Generate signed public URL
public_url = store.get_record_public_url('report.pdf')
print(f"Share this URL: {public_url}")
```

**Upload a file and generate a public URL (JavaScript):**

```javascript
import { ApifyClient } from 'apify-client';
import fs from 'fs/promises';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

// Create a new unnamed key-value store for outputs
const { id: storeId } = await client.keyValueStores().getOrCreate();
const store = client.keyValueStore(storeId);

await store.setRecord({
    key: 'report.pdf',
    value: await fs.readFile('/sandbox/report.pdf'),
    contentType: 'application/pdf',
});

// Generate signed public URL
const publicUrl = await store.getRecordPublicUrl('report.pdf');
console.log(`Share this URL: ${publicUrl}`);
```

### Datasets (Structured JSON Data)

Use for: JSON objects/arrays, API responses, scraped data, tabular data

**Push items and generate a public URL (Python):**

```python
from apify_client import ApifyClient
import os

client = ApifyClient(os.environ['APIFY_TOKEN'])

# Create a new unnamed dataset for outputs
dataset_id = client.datasets().get_or_create().id
dataset = client.dataset(dataset_id)

dataset.push_items([{'title': 'A', 'value': 1}, {'title': 'B', 'value': 2}])

# Generate signed public URL (no parameters)
public_url = dataset.create_items_public_url()
print(f"Share this URL: {public_url}")
```

**Push items and generate a public URL (JavaScript):**

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

// Create a new unnamed dataset for outputs
const { id: datasetId } = await client.datasets().getOrCreate();
const dataset = client.dataset(datasetId);

await dataset.pushItems([
    { title: 'A', value: 1 },
    { title: 'B', value: 2 },
]);

// Generate signed public URL (no parameters)
const publicUrl = await dataset.createItemsPublicUrl();
console.log(`Share this URL: ${publicUrl}`);
```

Datasets support JSON, CSV, and Excel export formats.

**Note:** Unnamed storages are removed after the user's data retention period. If the user needs the outputs kept permanently, pass a `name` to `get_or_create()` / `getOrCreate()` to create a named storage instead.

## Environment

Pre-configured and ready:

- **Apify CLI** (`apify`) installed globally
- **MCP Client** (`mcpc`) installed globally
- **jq** for JSON processing
- **Environment variables:**
    - **`APIFY_TOKEN`** - API authentication token
    - Other Apify platform variables (`ACTOR_*`, e.g. default storage IDs) are **not** set — create your own storages for outputs (see above)

### 🚨 CRITICAL: APIFY_TOKEN Already Available in Environment

The **`APIFY_TOKEN`** environment variable is **already set and ready to use** in your current environment. You can freely use it in any script without additional setup:

**Python:**

```python
import os
token = os.environ['APIFY_TOKEN']  # ✅ Already available - use it directly!
client = ApifyClient(token)
```

**JavaScript/TypeScript:**

```javascript
const token = process.env.APIFY_TOKEN; // ✅ Already available - use it directly!
const client = new ApifyClient({ token });
```

**Bash/Shell:**

```bash
echo $APIFY_TOKEN  # ✅ Already available - use it directly!
mcpc @apify tools-list --json
```

**No setup required:** The token is pre-configured. Just reference it and start building!

- **apify-client** pre-installed:
    - Python: `/sandbox/py/venv` (activated automatically for Python execution)
    - JavaScript/TypeScript: `/sandbox/js-ts/node_modules` (available for JS/TS execution)

## Model Context Protocol (MCP) Servers

Access Apify platform features and thousands of Actors via `mcpc` tool.

### User-provided MCP Connections (`/sandbox/mcp.json`)

If the user picked **MCP Connectors** in the Actor input (e.g. Slack, Notion, GitHub), the sandbox writes them to `/sandbox/mcp.json` on startup. Each entry is a ready-to-use HTTP MCP proxy, authenticated with the user's credentials server-side:

> **If you are Claude Code, Codex, or OpenCode**, these connectors are already registered as native MCP tools on startup — just call them directly, no `mcpc connect` needed. The steps below are for the `mcpc` CLI or any other client.

```bash
cat /sandbox/mcp.json
# {
#   "mcpServers": {
#     "apify": {                                       # always present (hosted Apify MCP)
#       "url": "https://mcp.apify.com",
#       "headers": { "Authorization": "Bearer ${APIFY_TOKEN}" }
#     },
#     "conn_abc123": {                                 # one per user-picked Connector
#       "url": "https://api.apify.com/v2/mcp-proxy/conn_abc123",
#       "headers": { "Authorization": "Bearer ${APIFY_TOKEN}" }
#     }
#   }
# }
```

`/sandbox/mcp.json` always contains the hosted Apify MCP server under the `apify` key, plus one entry per user-picked Connector.

To connect with `mcpc`, read a server entry from the file and pass it to `mcpc connect`:

```bash
# Connect to the first user-provided Connector (skipping the always-on "apify" entry) as @user1
URL=$(jq -r '.mcpServers | to_entries | map(select(.key != "apify"))[0].value.url // empty' /sandbox/mcp.json)
mcpc connect "$URL" @user1 --header "Authorization: Bearer $APIFY_TOKEN"
mcpc @user1 tools-list --json
```

### 🚨 CRITICAL: Connect to Apify MCP Server First

**Before using any MCP commands, you MUST create a named connection.** Direct URL connections are deprecated — always use named sessions with `@apify`.

**One-time setup (run once per session):**

```bash
# Create a named connection with auth (credentials stored securely in OS keychain)
mcpc connect mcp.apify.com @apify --header "Authorization: Bearer $APIFY_TOKEN"
```

This creates a persistent session called `@apify`. All subsequent commands use `mcpc @apify ...` instead of passing the URL and headers every time.

**Tear down when done (optional):**

```bash
mcpc @apify close
```

### 🚨 CRITICAL: ALWAYS List Tools First - DO NOT Guess Tool Names

**BEFORE calling ANY MCP tool, you MUST list available tools first.**

Tool names change and you CANNOT rely on documentation or memory. **NEVER guess tool names.**

**🚨 CRITICAL: NEVER truncate the tools list output!**

```bash
# ✅ CORRECT - List ALL tools (read full output)
mcpc @apify tools-list --json
```

**❌ NEVER DO THIS - Truncating output:**

```bash
# ❌ WRONG - Loses important tools and descriptions
mcpc @apify tools-list --json | head -100
mcpc @apify tools-list --json | head
mcpc @apify tools-list --json 2>&1 | head -100
```

**Why this matters:** The Bash tool automatically handles large output. Truncating with `head`, `tail`, or similar commands will cut off tool names and descriptions you need. Always let the full output be captured.

**📋 Important Rules:**

1. Run `tools-list` **ONLY ONCE** per session - the list doesn't change during your work
2. **NEVER use `| head`, `| tail`, `| grep`, or any pipe** that truncates output
3. Read the FULL list that comes back - it contains all tool names and descriptions
4. Use exact tool names from the list

**❌ WRONG Examples:**

```bash
# ❌ DO NOT DO THIS - tool name might not exist
mcpc @apify tools-call apify-store-search ...  # Tool doesn't exist

# ❌ DO NOT DO THIS - truncating output
mcpc @apify tools-list --json 2>&1 | head -100  # Missing tools!

# ❌ DO NOT DO THIS - deprecated direct URL connection
mcpc --header "Authorization: Bearer $APIFY_TOKEN" https://mcp.apify.com tools-list --json
```

**✅ CORRECT - Connect once, list once, use exact names:**

```bash
# Step 0: Create named connection ONCE (if not already done)
mcpc connect mcp.apify.com @apify --header "Authorization: Bearer $APIFY_TOKEN"

# Step 1: List tools ONCE to discover available tools (NO truncation)
mcpc @apify tools-list --json

# Step 2: Use exact tool name from the full list (e.g., "search-actors")
mcpc @apify tools-call search-actors '{"query": "instagram"}' --json
```

### Basic MCP Commands

**Setup (run once per session):**

```bash
# Create named connection (credentials stored securely in OS keychain)
mcpc connect mcp.apify.com @apify --header "Authorization: Bearer $APIFY_TOKEN"
```

**Call tools via named session:**

```bash
mcpc @apify tools-call <TOOL_NAME> '{"param": "value"}' --json
```

**Other session commands:**

```bash
mcpc @apify                    # Show session info & server capabilities
mcpc @apify tools-list --json  # List available tools
mcpc @apify shell              # Interactive REPL
mcpc @apify close              # Tear down session
```

## Using Apify Actors

Apify MCP server provides access to thousands of pre-built Actors for web scraping, automation, data extraction, and more.

### Pre-installed Libraries

**apify-client is already installed** in both sandbox environments:

- **Python**: Available in `/sandbox/py/venv` (activated automatically for Python code execution)
- **JavaScript/TypeScript**: Available in `/sandbox/js-ts/node_modules` (accessible for JS/TS code execution)

### Recommended Workflow

**DO NOT call Actors directly via MCP tools!** Instead, use this script-based approach:

1. **🚨 Connect to Apify MCP FIRST** - REQUIRED before any MCP operation (do this ONCE):

    ```bash
    mcpc connect mcp.apify.com @apify --header "Authorization: Bearer $APIFY_TOKEN"
    ```

2. **🚨 List MCP tools** - REQUIRED before calling any tool (do this ONCE, read FULL output):

    ```bash
    mcpc @apify tools-list --json
    ```

3. **Search for Actor** - Use the exact tool name from Step 2 (e.g., `search-actors`):

    ```bash
    mcpc @apify tools-call search-actors '{"query": "instagram"}' --json
    ```

4. **Fetch Actor details** - Get README and input/output schema (e.g., using `fetch-actor-details`):

    ```bash
    mcpc @apify tools-call fetch-actor-details '{"actor": "apify/instagram-scraper"}' --json
    ```

5. **Write TWO separate scripts** to minimize costly errors:
    - **Script 1**: Run Actor, process results, and save the output storage ID to a file (expensive operation - isolate it)
    - **Script 2**: Generate signed URLs from the saved storage ID (cheap - can re-run if needed)
    - **Why split?** Running Actors is expensive and time-consuming. If URL generation fails, you can fix and re-run just that part without re-running the Actor.
    - **Python scripts**: Write to `/sandbox/py/` (choose when you need pandas, data analysis, or Python ecosystem)
    - **JS/TS scripts**: Write to `/sandbox/js-ts/` (choose for general web scraping tasks or JavaScript ecosystem)

6. **Run Script 1** - Execute the Actor, push processed results to a new dataset, and save its ID to a file

7. **Run Script 2** - Generate signed public URLs from the saved dataset ID

8. **Share results** - Provide the signed public URLs to the user

### Python Script Examples (using apify-client)

**🚨 IMPORTANT: Split into TWO scripts to minimize costly errors**

Running Actors is expensive and time-consuming. If URL generation fails, you don't want to re-run the entire Actor. Split your workflow:

- **Script 1**: Run Actor + process and save results (expensive, run once)
- **Script 2**: Generate signed URLs from the saved dataset ID (cheap, can retry)

**Script 1: Run Actor and Process Results**

```python
# File: /sandbox/py/1_run_actor.py
# See "Recommended Workflow" section above for:
# - How to search for Actors using MCP
# - How to fetch Actor details and input schema

from apify_client import ApifyClientAsync
import asyncio
import os
import json

async def main():
    client = ApifyClientAsync(os.environ['APIFY_TOKEN'])

    # Call Actor - adapt input based on Actor's input schema from README
    run = await client.actor('apify/actor-name').call(run_input={...})

    # Fetch and process results from Actor's dataset
    # Use iterate_items() for memory-efficient batch processing
    processed_results = []
    async for item in client.dataset(run.default_dataset_id).iterate_items():
        processed_results.append({...})  # Extract needed fields

    # Push processed results to a new unnamed dataset
    # (if you don't need processing, skip this and save run.default_dataset_id instead)
    output_dataset_id = (await client.datasets().get_or_create()).id
    await client.dataset(output_dataset_id).push_items(processed_results)

    # Save the dataset ID for Script 2
    with open('/sandbox/py/output.json', 'w') as f:
        json.dump({'datasetId': output_dataset_id}, f)

    print(f"✅ Pushed {len(processed_results)} items to dataset {output_dataset_id}")
    print("Now run: venv/bin/python 2_generate_urls.py")

if __name__ == '__main__':
    asyncio.run(main())
```

**Script 2: Generate Signed Public URLs**

```python
# File: /sandbox/py/2_generate_urls.py
# See "Datasets" section above

from apify_client import ApifyClient
import json
import os

def main():
    client = ApifyClient(os.environ['APIFY_TOKEN'])

    # Read the dataset ID saved by Script 1
    with open('/sandbox/py/output.json') as f:
        dataset_id = json.load(f)['datasetId']

    # Generate signed public URL (NO parameters)
    public_url = client.dataset(dataset_id).create_items_public_url()

    print(f"🔗 SIGNED PUBLIC URL:")
    print(public_url)

if __name__ == '__main__':
    main()
```

**Run them sequentially:**

```bash
# Step 1: Run Actor and process results (expensive - run once)
cd /sandbox/py && venv/bin/python 1_run_actor.py

# Step 2: Generate signed URLs (cheap - can re-run if needed)
cd /sandbox/py && venv/bin/python 2_generate_urls.py
```

### JavaScript/TypeScript Script Examples (using apify-client)

**🚨 IMPORTANT: Split into TWO scripts to minimize costly errors**

Running Actors is expensive and time-consuming. If URL generation fails, you don't want to re-run the entire Actor. Split your workflow:

- **Script 1**: Run Actor + process and save results (expensive, run once)
- **Script 2**: Generate signed URLs from the saved dataset ID (cheap, can retry)

**Script 1: Run Actor and Process Results**

```javascript
// File: /sandbox/js-ts/1_run_actor.js
// See "Recommended Workflow" section above for:
// - How to search for Actors using MCP
// - How to fetch Actor details and input schema

import { ApifyClient } from 'apify-client';
import fs from 'fs/promises';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

async function main() {
    // Call Actor - adapt input based on Actor's input schema from README
    const run = await client.actor('apify/actor-name').call({...});

    // Fetch and process results from Actor's dataset
    // Use listItems() or iterate with offset/limit for large datasets
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const processedResults = items.map(item => ({...}));  // Extract needed fields

    // Push processed results to a new unnamed dataset
    // (if you don't need processing, skip this and save run.defaultDatasetId instead)
    const { id: outputDatasetId } = await client.datasets().getOrCreate();
    await client.dataset(outputDatasetId).pushItems(processedResults);

    // Save the dataset ID for Script 2
    await fs.writeFile('/sandbox/js-ts/output.json', JSON.stringify({ datasetId: outputDatasetId }));

    console.log(`✅ Pushed ${processedResults.length} items to dataset ${outputDatasetId}`);
    console.log('Now run: node 2_generate_urls.js');
}

main().catch(console.error);
```

**Script 2: Generate Signed Public URLs**

```javascript
// File: /sandbox/js-ts/2_generate_urls.js
// See "Datasets" section above

import { ApifyClient } from 'apify-client';
import fs from 'fs/promises';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

async function main() {
    // Read the dataset ID saved by Script 1
    const { datasetId } = JSON.parse(await fs.readFile('/sandbox/js-ts/output.json', 'utf8'));

    // Generate signed public URL (NO parameters)
    const publicUrl = await client.dataset(datasetId).createItemsPublicUrl();

    console.log('🔗 SIGNED PUBLIC URL:');
    console.log(publicUrl);
}

main().catch(console.error);
```

**Run them sequentially:**

```bash
# Step 1: Run Actor and process results (expensive - run once)
cd /sandbox/js-ts && node 1_run_actor.js

# Step 2: Generate signed URLs (cheap - can re-run if needed)
cd /sandbox/js-ts && node 2_generate_urls.js
```

### Key Benefits of Split-Script Approach

- **Cost-effective error recovery** - If URL generation fails, fix and re-run just that script without re-running the expensive Actor
- **Faster iteration** - Quickly re-run URL generation without waiting for Actor execution
- **Memory efficient** - Stream and process data without loading everything into context
- **Flexible processing** - Use full power of Python/JavaScript ecosystems (pandas, data analysis, etc.)
- **Better error handling** - Proper try/catch and error recovery in isolated scripts
- **Reusable** - Save scripts for repeated use with different Actors
- **Output schema from README** - Actor README documents output structure, use it to know which fields to extract
- **Modular debugging** - Easier to identify and fix issues in smaller, focused scripts

### 🚨 Do NOT Use `apify actor push-data` / `apify actor set-value`

These CLI commands write to the sandbox Actor run's default storages, which are not available inside the sandbox (the `ACTOR_*` environment variables are not set). Always create your own output storage with `apify-client` as shown in [Sharing Files and Data with Users](#sharing-files-and-data-with-users).

## Best Practices

### MCP Usage

- **🚨 CRITICAL: Create named connection FIRST** - Run `mcpc connect mcp.apify.com @apify --header "Authorization: Bearer $APIFY_TOKEN"` once at start
- **🚨 CRITICAL: NEVER use deprecated direct URL connections** - Always use `mcpc @apify ...` instead of `mcpc --header ... https://mcp.apify.com ...`
- **🚨 CRITICAL: List MCP tools ONLY ONCE** - Run `mcpc @apify tools-list --json` once at start, then use the full output for all subsequent calls
- **🚨 CRITICAL: NEVER guess tool names** - Tool names change frequently, always use exact names from the list
- **🚨 CRITICAL: NEVER truncate tools-list output** - Do NOT use `| head`, `| tail`, `| grep`, or any pipe that cuts output
- **Why no truncation?** The Bash tool handles large output automatically - truncating loses critical tool names and descriptions
- Use `mcpc @apify tools-call <TOOL> '{}' --json` as primary pattern for MCP
- Always use `--json` flag for structured output
- Read tool descriptions carefully after listing to understand parameters
- Use `mcpc @apify close` to tear down session when done

### Actor Usage - Split Script Strategy

- **🚨 CRITICAL: Use TWO separate scripts** - Split expensive Actor runs from cheap URL generation
    - **Script 1**: Run Actor + push results to a new dataset, save its ID to a file (expensive, run once)
    - **Script 2**: Generate signed URLs from the saved dataset ID (cheap, can retry)
    - **Why?** Running Actors is expensive and slow. If URL generation fails, you can fix and re-run just Script 2 without re-running the Actor
- **Read Actor README first** - Output schema is documented there, use it to understand data structure
- **Use script-based approach for Actors** - Write Python or JS scripts with apify-client instead of calling via MCP
- Choose language based on ecosystem needs:
    - Python: Data analysis, pandas, scientific computing
    - JavaScript/TypeScript: Web scraping, general automation
- **apify-client is pre-installed** in both `/sandbox/py/venv` and `/sandbox/js-ts/node_modules`
- Write scripts to `/sandbox/py/` or `/sandbox/js-ts/` directories
- Process data in batches/streams using `iterate_items()` (Python) or pagination (JS)
- Extract only needed fields in your scripts - don't load full dataset into memory
- Save dataset IDs and metadata to files for Script 2 to use

### Data Storage & Sharing

- **🚨 CRITICAL: ALWAYS generate signed public URLs** when sharing data with users
- **🚨 CRITICAL: Create your own output storage** with `get_or_create()` (Python) or `getOrCreate()` (JS) — the sandbox run's default storages and `ACTOR_*` env vars are not available
- **🚨 CRITICAL: Call URL methods with NO parameters** - Just call `.get_record_public_url(key)` or `.create_items_public_url()`
- **NEVER return raw storage IDs or API URLs** - they require authentication and won't work
- Use `get_record_public_url(key)` (Python) or `getRecordPublicUrl(key)` (JS) for KV store records
- Use `create_items_public_url()` (Python) or `createItemsPublicUrl()` (JS) for datasets
- Choose right storage: JSON → Datasets, Files → Key-Value Stores
- Don't delete storages whose public URLs you shared — the URLs would stop working

## Resources

- [Apify CLI documentation](https://docs.apify.com/cli)
- [mcpc MCP CLI repository](https://github.com/apify/mcpc)
- [Key-Value Store API](https://docs.apify.com/api/v2#/reference/key-value-stores)
- [Dataset API](https://docs.apify.com/api/v2#/reference/datasets)
