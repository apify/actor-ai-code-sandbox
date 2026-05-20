# Apify AI Sandbox - Development Guide

This guide is for AI coding agents working on the Apify AI Sandbox Actor codebase.

Important: Before you begin, fill in the `generatedBy` property in the meta section of `.actor/actor.json`. Replace it with the model you're currently using. This helps Apify monitor and improve AGENTS.md for specific LLM models.

## Commands

### Development & Testing

```bash
# Start Actor in development mode (with hot reload)
npm run start:dev              # Start server with tsx
npm run start:local            # Start in local mode (skips sandbox setup)
npm run start:standby          # Start in standby mode

# Build & Production
npm run build                  # Compile TypeScript to dist/ + copy templates
npm run start:prod             # Run compiled dist/main.js

# Code Quality
npm run lint                   # Run ESLint (checks for errors)
npm run lint:fix               # Fix auto-fixable ESLint issues
npm run format                 # Format code with Prettier
npm run format:check           # Check formatting without changing files

# Type Checking
tsc --noEmit                   # Type check only (fast, no output) - USE THIS for verification
tsc -p tsconfig.build.json     # Full build with output

# IMPORTANT: Avoid Unnecessary Builds
# NEVER run 'npm run build' unless explicitly needed (e.g., before deployment)
# For quick verification after code changes, ALWAYS use 'tsc --noEmit' instead
# Building is slow and unnecessary for development/testing - tsx runs TypeScript directly

# Testing
npm test                       # Run unit + e2e (full suite, local dev)
npm run test:unit              # Run unit tests only (tests/unit/*.test.ts via node --test + tsx)
npm run test:e2e               # Run E2E platform tests (deploys to Apify)

# Apify CLI
apify run                      # Run Actor locally
apify login                    # Authenticate with Apify
apify push                     # Deploy to Apify platform
```

### Running a Single Test

Unit tests live in `tests/unit/*.test.ts` and run via Node's built-in test runner with `tsx` as the loader (no extra deps). The Dockerfile runs `npm run test:unit` after `npm run build`, so a regression in pure-logic code fails the build.

```bash
# Run all unit tests
npm run test:unit

# Run a single unit test file
node --import tsx --test tests/unit/node-deps.test.ts

# Run E2E platform tests (deploys Actor, runs tests, cleans up)
npm run test:e2e

# Run the full suite (unit + e2e)
npm test
```

## Code Style Guidelines

### Formatting & TypeScript

- **Indentation:** 4 spaces | **Line Length:** 120 chars | **Quotes:** Single | **Semicolons:** Required
- **Trailing Commas:** ES5 style | **Strict Mode:** Enabled via @apify/tsconfig
- **Module System:** ES modules (`"type": "module"`) | **Module Resolution:** NodeNext | **Target:** ES2022
- Always use explicit types for function parameters and return values
- Prefer interfaces over type aliases for object shapes

### Imports & Naming

Organize imports: Node.js built-ins (`node:` prefix) → External deps → Internal (`.js` extension)

```typescript
import { spawn } from 'node:child_process';
import { Actor, log } from 'apify';
import { executeCode } from './operations.js'; // ✅ Always use .js extension
```

**Naming:** kebab-case (files) | camelCase (functions/vars) | PascalCase (types) | UPPER_SNAKE_CASE (constants)

**Capitalization:**

- Use sentence case: "This style capitalization" NOT "This Style Capitalization"
- Always capitalize "Actor" when referring to Apify Actors (e.g., "Actor input", "Actor configuration")

### Functions & Logging

- Prefer async/await, always type params/returns, use JSDoc for exported functions
- **CRITICAL:** Always use `apify/log` (never `console.log`) - censors sensitive data (API keys, tokens)

```typescript
import { log } from 'apify';
log.debug('msg');
log.info('msg');
log.warning('msg');
log.error('msg');
log.exception('msg', error);
```

### Error Handling & Routes

- Never throw in route handlers - return error responses
- Validate input at API boundaries, return structured errors: `{ success: false, error: string }`
- Use try-catch for async operations, log before returning errors
- HTTP status codes: 200 (success), 400 (bad request), 404 (not found), 500 (server error)
- Type routes with Express `Request` and `Response`

```typescript
app.post('/endpoint', async (req: Request, res: Response) => {
    try {
        const { param } = req.body;
        if (!param) return res.status(400).json({ error: 'Param required' });

        const result = await operation(param);
        if (!result.success) return res.status(500).json(result);

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});
```

### Testing

- Tests in `tests/` directory with `.ts` extension, executable with `tsx`
- **Unit tests:** files matching `tests/unit/*.test.ts`, run via `npm run test:unit` (Node's built-in `node:test` runner via `node --import tsx`, no extra deps). Also run during the Docker build.
- **E2E platform test suite:** `tests/e2e.ts` (deploys to Apify, runs endpoint tests, cleans up)

**When to add a unit test:** any new pure function (parser, validator, transform) — anything you can exercise without spinning up the Actor, Express, or external services. Prefer unit tests for I/O-free logic; reserve E2E for endpoint behavior. Bug fixes in pure logic should land with a regression test.

**How to add a unit test:**

1. Create `tests/unit/<module>.test.ts` next to existing test files.
2. Use `node:test` (`describe`/`it`) and `node:assert/strict`:

    ```typescript
    /* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
    import assert from 'node:assert/strict';
    import { describe, it } from 'node:test';

    import { myFn } from '../../src/my-module.js'; // .js extension required

    describe('myFn', () => {
        it('does the thing', () => {
            assert.deepEqual(myFn('input'), { ok: true });
        });
    });
    ```

3. Run `npm run test:unit` to verify. Test files are picked up by the `tests/unit/*.test.ts` glob — no further wiring needed.
4. Keep tests pure: no network, no filesystem writes, no `apify`/`Actor.init()`. If you need fixtures, inline them in the test file.

## What are Apify Actors?

- Actors are serverless programs that run in the cloud. They're inspired by the UNIX philosophy - programs that do one thing well and can be easily combined to build complex systems.
- Actors are programs packaged as Docker images that run in isolated containers

## Core Concepts

- Accept well-defined JSON input
- Perform isolated tasks (web scraping, automation, data processing)
- Produce structured JSON output to datasets and/or store data in key-value stores
- Can run from seconds to hours or even indefinitely
- Persist state and can be restarted

## Do

- accept well-defined JSON input and produce structured JSON output
- use Apify SDK (`apify`) for code running ON Apify platform
- validate input early with proper error handling and fail gracefully
- use CheerioCrawler for static HTML content (10x faster than browsers)
- use PlaywrightCrawler only for JavaScript-heavy sites and dynamic content
- use router pattern (createCheerioRouter/createPlaywrightRouter) for complex crawls
- implement retry strategies with exponential backoff for failed requests
- use proper concurrency settings (HTTP: 10-50, Browser: 1-5)
- set sensible defaults in `.actor/input_schema.json` for all optional fields
- set up output schema in `.actor/output_schema.json`
- clean and validate data before pushing to dataset
- use semantic CSS selectors and fallback strategies for missing elements
- respect robots.txt, ToS, and implement rate limiting with delays
- check which tools (cheerio/playwright/crawlee) are installed before applying guidance
- **ALWAYS use the `apify/log` package for logging** - This package contains critical security logic including censoring sensitive data (Apify tokens, API keys, credentials) to prevent accidental exposure in logs

### Available Log Levels in `apify/log`

The Apify log package provides the following methods for logging:

- `log.debug()` - Debug level logs (detailed diagnostic information)
- `log.info()` - Info level logs (general informational messages)
- `log.warning()` - Warning level logs (warning messages for potentially problematic situations)
- `log.warningOnce()` - Warning level logs (same warning message logged only once)
- `log.error()` - Error level logs (error messages for failures)
- `log.exception()` - Exception level logs (for exceptions with stack traces)
- `log.perf()` - Performance level logs (performance metrics and timing information)
- `log.deprecated()` - Deprecation level logs (warnings about deprecated code)
- `log.softFail()` - Soft failure logs (non-critical failures that don't stop execution, e.g., input validation errors, skipped items)
- `log.internal()` - Internal level logs (internal/system messages)

**Best practices:**

- Use `log.debug()` for detailed operation-level diagnostics (inside functions)
- Use `log.info()` for general informational messages (API requests, successful operations)
- Use `log.warning()` for potentially problematic situations (validation failures, unexpected states)
- Use `log.error()` for actual errors and failures
- Use `log.exception()` for caught exceptions with stack traces

## Don't

- do not rely on `Dataset.getInfo()` for final counts on Cloud platform
- do not use browser crawlers when HTTP/Cheerio works (massive performance gains with HTTP)
- do not hard code values that should be in input schema or environment variables
- do not skip input validation or error handling
- do not overload servers - use appropriate concurrency and delays
- do not scrape prohibited content or ignore Terms of Service
- do not store personal/sensitive data unless explicitly permitted
- do not use deprecated options like `requestHandlerTimeoutMillis` on CheerioCrawler (v3.x)
- do not use `additionalHttpHeaders` - use `preNavigationHooks` instead
- **NEVER disable standby mode (`usesStandbyMode: false`) in `.actor/actor.json` without explicit permission** - Standby mode is critical for cost efficiency. Always keep `usesStandbyMode: true` unless there is a specific documented reason to disable it. _Note: This Actor intentionally disables standby mode (`usesStandbyMode: false`) because it was simplified to run as a single containerized application._
- **ALWAYS implement readiness probe handler for standby Actors** - Handle the `x-apify-container-server-readiness-probe` header at GET / endpoint to ensure proper Actor lifecycle management

You can recognize a standby Actor by checking the `usesStandbyMode` property in `.actor/actor.json`. Only implement the readiness probe if this property is set to `true`.

### Readiness Probe Implementation Example

```typescript
// Apify standby readiness probe at root path
app.get('/', (req: Request, res: Response) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    if (req.headers['x-apify-container-server-readiness-probe']) {
        res.end('Readiness probe OK\n');
    } else {
        res.end('Actor is ready\n');
    }
});
```

Key points:

- Detect the `x-apify-container-server-readiness-probe` header in incoming requests
- Respond with HTTP 200 status code for both readiness probe and normal requests
- This enables proper Actor lifecycle management in standby mode

## TypeScript Type Checking

When you just need to type check without generating output files, use the `--noEmit` flag:

```bash
# Type check only (faster, no output files)
tsc --noEmit

# Full build (generates output to dist/)
npm run build
```

This is useful during development to quickly verify type correctness without writing files to disk.

## Commands

```bash
# Local development
apify run                              # Run Actor locally

# Authentication & deployment
apify login                            # Authenticate account
apify push                             # Deploy to Apify platform

# Help
apify help                             # List all commands
```

## Safety and Permissions

Allowed without prompt:

- read files with `Actor.getValue()`
- push data with `Actor.pushData()`
- set values with `Actor.setValue()`
- enqueue requests to RequestQueue
- run locally with `apify run`

Ask first:

- npm/pip package installations
- apify push (deployment to cloud)
- proxy configuration changes (requires paid plan)
- Dockerfile changes affecting builds
- deleting datasets or key-value stores
- **git commits** - Only commit when explicitly requested by the user. Never commit automatically. Use semantic commit messages following the conventional commits format:
    - `feat:` - New feature
    - `fix:` - Bug fix
    - `docs:` - Documentation changes
    - `refactor:` - Code refactoring without changing functionality
    - `test:` - Adding or updating tests
    - `chore:` - Maintenance tasks (dependencies, configs, build)
    - `perf:` - Performance improvements
    - Example: `feat: add user authentication with JWT tokens`
- **pull requests** - Use semantic PR titles (e.g., `feat:`, `fix:`, `docs:`) and keep PR bodies brief and to the point. Focus on the "why" not the "what".

## Project Structure

```
.actor/
├── actor.json                    # Actor configuration (name, version, input schema)
scripts/
└── capture-versions.sh           # Build-time version capture script (runs in Dockerfile)
                                  # Caches tool versions to /app/.versions/*.txt for fast shell startup
src/
├── main.ts                       # Express HTTP server & Actor initialization
├── mcp.ts                        # Model Context Protocol (MCP) server
├── operations.ts                 # Core execution operations (shell, Python, Node.js)
├── environment.ts                # Sandbox environment setup & library installation
├── types.ts                      # TypeScript type definitions and interfaces
└── consts.ts                     # Constants and configuration values
tests/
└── e2e.ts                        # E2E platform tests (deployment + 47 endpoint tests)
storage/                          # Local storage (mirrors Cloud during development)
├── datasets/                     # Output items (JSON objects)
├── key_value_stores/             # Files, config, INPUT
└── request_queues/               # Pending crawl requests
Dockerfile                        # Container image definition
AGENTS.md                         # AI agent instructions (this file)
```

## Interactive Shell Terminal

The Actor provides an interactive browser-based terminal powered by [ttyd](https://github.com/tsl0922/ttyd) that runs bash in the sandbox environment.

### Basic Usage

Access the terminal at:

```
GET /shell/
```

This opens an interactive bash session with:

- Custom environment variables (NODE_PATH, VIRTUAL_ENV, PATH)
- Installed dependencies (Node.js, Python, Apify CLI, Claude Code, etc.)
- Working directory set to `/sandbox`

### URL Argument Passing

You can pass arguments to bash via URL query parameters using the `?arg=` syntax:

```
GET /shell?arg=-c&arg=<command>
```

This executes a one-off command instead of opening an interactive session.

**Examples:**

```bash
# Run a simple command
GET /shell?arg=-c&arg=echo hello

# Run cowsay
GET /shell?arg=-c&arg=cowsay hello

# Execute a script
GET /shell?arg=-c&arg=python script.py

# Run Node.js code
GET /shell?arg=-c&arg=node -e "console.log('hello')"
```

**Implementation Details:**

- ttyd is spawned with the `-a` flag to enable URL argument acceptance
- The proxy normalizes paths to ensure query strings like `?arg=...` are correctly formatted as `/?arg=...`
- Arguments are passed directly to bash, so bash syntax applies (e.g., `-c` requires the command as the next argument)

**Security Note:**

URL arguments are passed directly to bash without additional validation. Only use this feature with trusted input.

## Actor Input Schema

The input schema defines the input parameters for an Actor. It's a JSON object comprising various field types supported by the Apify platform.

### Structure

```json
{
    "title": "<INPUT-SCHEMA-TITLE>",
    "type": "object",
    "schemaVersion": 1,
    "properties": {
        /* define input fields here */
    },
    "required": []
}
```

### Example

```json
{
    "title": "E-commerce Product Scraper Input",
    "type": "object",
    "schemaVersion": 1,
    "properties": {
        "startUrls": {
            "title": "Start URLs",
            "type": "array",
            "description": "URLs to start scraping from (category pages or product pages)",
            "editor": "requestListSources",
            "default": [{ "url": "https://example.com/category" }],
            "prefill": [{ "url": "https://example.com/category" }]
        },
        "followVariants": {
            "title": "Follow Product Variants",
            "type": "boolean",
            "description": "Whether to scrape product variants (different colors, sizes)",
            "default": true
        },
        "maxRequestsPerCrawl": {
            "title": "Max Requests per Crawl",
            "type": "integer",
            "description": "Maximum number of pages to scrape (0 = unlimited)",
            "default": 1000,
            "minimum": 0
        },
        "proxyConfiguration": {
            "title": "Proxy Configuration",
            "type": "object",
            "description": "Proxy settings for anti-bot protection",
            "editor": "proxy",
            "default": { "useApifyProxy": false }
        },
        "locale": {
            "title": "Locale",
            "type": "string",
            "description": "Language/country code for localized content",
            "default": "cs",
            "enum": ["cs", "en", "de", "sk"],
            "enumTitles": ["Czech", "English", "German", "Slovak"]
        }
    },
    "required": ["startUrls"]
}
```

## Actor Output Schema

The Actor output schema builds upon the schemas for the dataset and key-value store. It specifies where an Actor stores its output and defines templates for accessing that output. Apify Console uses these output definitions to display run results.

### Structure

```json
{
    "actorOutputSchemaVersion": 1,
    "title": "<OUTPUT-SCHEMA-TITLE>",
    "properties": {
        /* define your outputs here */
    }
}
```

### Example

```json
{
    "actorOutputSchemaVersion": 1,
    "title": "Output schema of the files scraper",
    "properties": {
        "files": {
            "type": "string",
            "title": "Files",
            "template": "{{links.apiDefaultKeyValueStoreUrl}}/keys"
        },
        "dataset": {
            "type": "string",
            "title": "Dataset",
            "template": "{{links.apiDefaultDatasetUrl}}/items"
        }
    }
}
```

### Output Schema Template Variables

- `links` (object) - Contains quick links to most commonly used URLs
- `links.publicRunUrl` (string) - Public run url in format `https://console.apify.com/view/runs/:runId`
- `links.consoleRunUrl` (string) - Console run url in format `https://console.apify.com/actors/runs/:runId`
- `links.apiRunUrl` (string) - API run url in format `https://api.apify.com/v2/actor-runs/:runId`
- `links.apiDefaultDatasetUrl` (string) - API url of default dataset in format `https://api.apify.com/v2/datasets/:defaultDatasetId`
- `links.apiDefaultKeyValueStoreUrl` (string) - API url of default key-value store in format `https://api.apify.com/v2/key-value-stores/:defaultKeyValueStoreId`
- `links.containerRunUrl` (string) - URL of a webserver running inside the run in format `https://<containerId>.runs.apify.net/`
- `run` (object) - Contains information about the run same as it is returned from the `GET Run` API endpoint
- `run.defaultDatasetId` (string) - ID of the default dataset
- `run.defaultKeyValueStoreId` (string) - ID of the default key-value store

## Dataset Schema Specification

The dataset schema defines how your Actor's output data is structured, transformed, and displayed in the Output tab in the Apify Console.

### Example

Consider an example Actor that calls `Actor.pushData()` to store data into dataset:

```typescript
import { Actor } from 'apify';
// Initialize the JavaScript SDK
await Actor.init();

/**
 * Actor code
 */
await Actor.pushData({
    numericField: 10,
    pictureUrl: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png',
    linkUrl: 'https://google.com',
    textField: 'Google',
    booleanField: true,
    dateField: new Date(),
    arrayField: ['#hello', '#world'],
    objectField: {},
});

// Exit successfully
await Actor.exit();
```

To set up the Actor's output tab UI, reference a dataset schema file in `.actor/actor.json`:

```json
{
    "actorSpecification": 1,
    "name": "book-library-scraper",
    "title": "Book Library Scraper",
    "version": "1.0.0",
    "storages": {
        "dataset": "./dataset_schema.json"
    }
}
```

Then create the dataset schema in `.actor/dataset_schema.json`:

```json
{
    "actorSpecification": 1,
    "fields": {},
    "views": {
        "overview": {
            "title": "Overview",
            "transformation": {
                "fields": [
                    "pictureUrl",
                    "linkUrl",
                    "textField",
                    "booleanField",
                    "arrayField",
                    "objectField",
                    "dateField",
                    "numericField"
                ]
            },
            "display": {
                "component": "table",
                "properties": {
                    "pictureUrl": {
                        "label": "Image",
                        "format": "image"
                    },
                    "linkUrl": {
                        "label": "Link",
                        "format": "link"
                    },
                    "textField": {
                        "label": "Text",
                        "format": "text"
                    },
                    "booleanField": {
                        "label": "Boolean",
                        "format": "boolean"
                    },
                    "arrayField": {
                        "label": "Array",
                        "format": "array"
                    },
                    "objectField": {
                        "label": "Object",
                        "format": "object"
                    },
                    "dateField": {
                        "label": "Date",
                        "format": "date"
                    },
                    "numericField": {
                        "label": "Number",
                        "format": "number"
                    }
                }
            }
        }
    }
}
```

### Structure

```json
{
    "actorSpecification": 1,
    "fields": {},
    "views": {
        "<VIEW_NAME>": {
            "title": "string (required)",
            "description": "string (optional)",
            "transformation": {
                "fields": ["string (required)"],
                "unwind": ["string (optional)"],
                "flatten": ["string (optional)"],
                "omit": ["string (optional)"],
                "limit": "integer (optional)",
                "desc": "boolean (optional)"
            },
            "display": {
                "component": "table (required)",
                "properties": {
                    "<FIELD_NAME>": {
                        "label": "string (optional)",
                        "format": "text|number|date|link|boolean|image|array|object (optional)"
                    }
                }
            }
        }
    }
}
```

**Dataset Schema Properties:**

- `actorSpecification` (integer, required) - Specifies the version of dataset schema structure document (currently only version 1)
- `fields` (JSONSchema object, required) - Schema of one dataset object (use JsonSchema Draft 2020-12 or compatible)
- `views` (DatasetView object, required) - Object with API and UI views description

**DatasetView Properties:**

- `title` (string, required) - Visible in UI Output tab and API
- `description` (string, optional) - Only available in API response
- `transformation` (ViewTransformation object, required) - Data transformation applied when loading from Dataset API
- `display` (ViewDisplay object, required) - Output tab UI visualization definition

**ViewTransformation Properties:**

- `fields` (string[], required) - Fields to present in output (order matches column order)
- `unwind` (string[], optional) - Deconstructs nested children into parent object
- `flatten` (string[], optional) - Transforms nested object into flat structure
- `omit` (string[], optional) - Removes specified fields from output
- `limit` (integer, optional) - Maximum number of results (default: all)
- `desc` (boolean, optional) - Sort order (true = newest first)

**ViewDisplay Properties:**

- `component` (string, required) - Only `table` is available
- `properties` (Object, optional) - Keys matching `transformation.fields` with ViewDisplayProperty values

**ViewDisplayProperty Properties:**

- `label` (string, optional) - Table column header
- `format` (string, optional) - One of: `text`, `number`, `date`, `link`, `boolean`, `image`, `array`, `object`

## Key-Value Store Schema Specification

The key-value store schema organizes keys into logical groups called collections for easier data management.

### Example

Consider an example Actor that calls `Actor.setValue()` to save records into the key-value store:

```typescript
import { Actor } from 'apify';
// Initialize the JavaScript SDK
await Actor.init();

/**
 * Actor code
 */
await Actor.setValue('document-1', 'my text data', {
    contentType: 'text/plain',
});

await Actor.setValue(`image-${imageID}`, imageBuffer, {
    contentType: 'image/jpeg',
});

// Exit successfully
await Actor.exit();
```

To configure the key-value store schema, reference a schema file in `.actor/actor.json`:

```json
{
    "actorSpecification": 1,
    "name": "data-collector",
    "title": "Data Collector",
    "version": "1.0.0",
    "storages": {
        "keyValueStore": "./key_value_store_schema.json"
    }
}
```

Then create the key-value store schema in `.actor/key_value_store_schema.json`:

```json
{
    "actorKeyValueStoreSchemaVersion": 1,
    "title": "Key-Value Store Schema",
    "collections": {
        "documents": {
            "title": "Documents",
            "description": "Text documents stored by the Actor",
            "keyPrefix": "document-"
        },
        "images": {
            "title": "Images",
            "description": "Images stored by the Actor",
            "keyPrefix": "image-",
            "contentTypes": ["image/jpeg"]
        }
    }
}
```

### Structure

```json
{
    "actorKeyValueStoreSchemaVersion": 1,
    "title": "string (required)",
    "description": "string (optional)",
    "collections": {
        "<COLLECTION_NAME>": {
            "title": "string (required)",
            "description": "string (optional)",
            "key": "string (conditional - use key OR keyPrefix)",
            "keyPrefix": "string (conditional - use key OR keyPrefix)",
            "contentTypes": ["string (optional)"],
            "jsonSchema": "object (optional)"
        }
    }
}
```

**Key-Value Store Schema Properties:**

- `actorKeyValueStoreSchemaVersion` (integer, required) - Version of key-value store schema structure document (currently only version 1)
- `title` (string, required) - Title of the schema
- `description` (string, optional) - Description of the schema
- `collections` (Object, required) - Object where each key is a collection ID and value is a Collection object

**Collection Properties:**

- `title` (string, required) - Collection title shown in UI tabs
- `description` (string, optional) - Description appearing in UI tooltips
- `key` (string, conditional) - Single specific key for this collection
- `keyPrefix` (string, conditional) - Prefix for keys included in this collection
- `contentTypes` (string[], optional) - Allowed content types for validation
- `jsonSchema` (object, optional) - JSON Schema Draft 07 format for `application/json` content type validation

Either `key` or `keyPrefix` must be specified for each collection, but not both.

## Apify MCP Tools

If MCP server is configured, use these tools for documentation:

- `search-apify-docs` - Search documentation
- `fetch-apify-docs` - Get full doc pages

Otherwise, reference: `@https://mcp.apify.com/`

## Resources

- [docs.apify.com/llms.txt](https://docs.apify.com/llms.txt) - Quick reference
- [docs.apify.com/llms-full.txt](https://docs.apify.com/llms-full.txt) - Complete docs
- [crawlee.dev](https://crawlee.dev) - Crawlee documentation
- [whitepaper.actor](https://raw.githubusercontent.com/apify/actor-whitepaper/refs/heads/master/README.md) - Complete Actor specification
