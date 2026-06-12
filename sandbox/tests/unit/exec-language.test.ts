/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeLanguage, SUPPORTED_LANGUAGES } from '../../src/operations.js';

describe('normalizeLanguage', () => {
    it('maps aliases to canonical languages', () => {
        assert.equal(normalizeLanguage('js'), 'js');
        assert.equal(normalizeLanguage('javascript'), 'js');
        assert.equal(normalizeLanguage('ts'), 'ts');
        assert.equal(normalizeLanguage('typescript'), 'ts');
        assert.equal(normalizeLanguage('py'), 'py');
        assert.equal(normalizeLanguage('python'), 'py');
        assert.equal(normalizeLanguage('bash'), 'shell');
        assert.equal(normalizeLanguage('sh'), 'shell');
    });

    it('is case-insensitive', () => {
        assert.equal(normalizeLanguage('Python'), 'py');
        assert.equal(normalizeLanguage('TYPESCRIPT'), 'ts');
    });

    it('returns null for missing or unknown languages', () => {
        assert.equal(normalizeLanguage(undefined), null);
        assert.equal(normalizeLanguage(''), null);
        assert.equal(normalizeLanguage('rust'), null);
    });
});

describe('SUPPORTED_LANGUAGES', () => {
    it('lists every accepted alias for error messages', () => {
        // The /exec and MCP error messages embed this list; keep it stable.
        assert.equal(SUPPORTED_LANGUAGES, 'js, javascript, ts, typescript, py, python, bash, sh');
    });
});
