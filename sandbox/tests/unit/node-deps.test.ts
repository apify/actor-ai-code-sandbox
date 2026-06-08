/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseNodeDependencies } from '../../src/node-deps.js';

describe('parseNodeDependencies', () => {
    describe('empty input', () => {
        it('returns {} for undefined', () => {
            assert.deepEqual(parseNodeDependencies(undefined), {});
        });

        it('returns {} for null', () => {
            assert.deepEqual(parseNodeDependencies(null), {});
        });

        it('returns {} for empty string', () => {
            assert.deepEqual(parseNodeDependencies(''), {});
        });

        it('returns {} for whitespace-only input', () => {
            assert.deepEqual(parseNodeDependencies('   \n  \t  \n'), {});
        });
    });

    describe('npm CLI-style line format', () => {
        it('parses a single package@version line', () => {
            assert.deepEqual(parseNodeDependencies('zod@^3.0'), { zod: '^3.0' });
        });

        it('parses multiple packages, one per line', () => {
            const input = 'zod@^3.0\naxios@latest\nlodash@4.17.21';
            assert.deepEqual(parseNodeDependencies(input), {
                zod: '^3.0',
                axios: 'latest',
                lodash: '4.17.21',
            });
        });

        it('defaults bare package names to latest', () => {
            assert.deepEqual(parseNodeDependencies('lodash'), { lodash: 'latest' });
        });

        it('defaults bare names to latest in mixed input', () => {
            const input = 'zod@^3.0\nlodash\naxios@latest';
            assert.deepEqual(parseNodeDependencies(input), {
                zod: '^3.0',
                lodash: 'latest',
                axios: 'latest',
            });
        });

        it('handles scoped packages without version', () => {
            assert.deepEqual(parseNodeDependencies('@types/node'), { '@types/node': 'latest' });
        });

        it('handles scoped packages with version (splits on last @)', () => {
            assert.deepEqual(parseNodeDependencies('@types/node@^20'), { '@types/node': '^20' });
        });

        it('handles mixed scoped and unscoped packages', () => {
            const input = '@types/node@^20\nzod@^3.0\n@apify/sdk';
            assert.deepEqual(parseNodeDependencies(input), {
                '@types/node': '^20',
                zod: '^3.0',
                '@apify/sdk': 'latest',
            });
        });

        it('ignores blank lines', () => {
            const input = '\n\nzod@^3.0\n\n\naxios@latest\n\n';
            assert.deepEqual(parseNodeDependencies(input), {
                zod: '^3.0',
                axios: 'latest',
            });
        });

        it('ignores # comment lines', () => {
            const input = '# my deps\nzod@^3.0\n# another comment\naxios@latest';
            assert.deepEqual(parseNodeDependencies(input), {
                zod: '^3.0',
                axios: 'latest',
            });
        });

        it('trims whitespace around package specs', () => {
            const input = '   zod@^3.0   \n\t axios@latest\t';
            assert.deepEqual(parseNodeDependencies(input), {
                zod: '^3.0',
                axios: 'latest',
            });
        });

        it('handles \\r\\n line endings', () => {
            assert.deepEqual(parseNodeDependencies('zod@^3.0\r\naxios@latest'), {
                zod: '^3.0',
                axios: 'latest',
            });
        });

        it('treats trailing @ as latest', () => {
            assert.deepEqual(parseNodeDependencies('zod@'), { zod: 'latest' });
        });

        it('lets later duplicate entries override earlier ones', () => {
            assert.deepEqual(parseNodeDependencies('zod@^3.0\nzod@^4.0'), { zod: '^4.0' });
        });
    });

    describe('JSON object format', () => {
        it('parses a JSON object', () => {
            const input = '{"zod": "^3.0", "axios": "latest"}';
            assert.deepEqual(parseNodeDependencies(input), {
                zod: '^3.0',
                axios: 'latest',
            });
        });

        it('parses pretty-printed JSON', () => {
            const input = '{\n  "zod": "^3.0",\n  "axios": "latest"\n}';
            assert.deepEqual(parseNodeDependencies(input), {
                zod: '^3.0',
                axios: 'latest',
            });
        });

        it('parses JSON with leading whitespace', () => {
            assert.deepEqual(parseNodeDependencies('   {"zod": "^3.0"}   '), { zod: '^3.0' });
        });

        it('coerces numeric versions to strings', () => {
            const input = '{"lodash": 4}';
            assert.deepEqual(parseNodeDependencies(input), { lodash: '4' });
        });

        it('treats null/empty values as latest', () => {
            const input = '{"zod": null, "axios": ""}';
            assert.deepEqual(parseNodeDependencies(input), {
                zod: 'latest',
                axios: 'latest',
            });
        });

        it('skips object/array values', () => {
            const input = '{"zod": "^3.0", "bad": {"nested": true}, "alsobad": [1, 2]}';
            assert.deepEqual(parseNodeDependencies(input), { zod: '^3.0' });
        });

        it('returns {} for malformed JSON', () => {
            assert.deepEqual(parseNodeDependencies('{not valid json'), {});
        });

        it('returns {} for top-level JSON array (must be a flat object)', () => {
            // Wrapped in `{}` so it routes to JSON parsing; bare `[...]` would be
            // treated as line-format input by design.
            assert.deepEqual(parseNodeDependencies('{"deps": ["zod", "axios"]}'), {});
        });

        it('parses an empty JSON object as {}', () => {
            assert.deepEqual(parseNodeDependencies('{}'), {});
        });

        it('handles scoped packages in JSON', () => {
            const input = '{"@types/node": "^20", "@apify/sdk": "latest"}';
            assert.deepEqual(parseNodeDependencies(input), {
                '@types/node': '^20',
                '@apify/sdk': 'latest',
            });
        });
    });

    describe('format detection', () => {
        it('treats input starting with { as JSON', () => {
            assert.deepEqual(parseNodeDependencies('{"zod": "^3.0"}'), { zod: '^3.0' });
        });

        it('treats input not starting with { as line format', () => {
            assert.deepEqual(parseNodeDependencies('zod@^3.0'), { zod: '^3.0' });
        });
    });
});
