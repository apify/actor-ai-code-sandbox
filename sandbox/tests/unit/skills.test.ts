/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSkills } from '../../src/skills.js';

describe('parseSkills', () => {
    describe('empty input', () => {
        it('returns [] for undefined', () => {
            assert.deepEqual(parseSkills(undefined), []);
        });

        it('returns [] for null', () => {
            assert.deepEqual(parseSkills(null), []);
        });

        it('returns [] for empty string', () => {
            assert.deepEqual(parseSkills(''), []);
        });

        it('returns [] for whitespace-only input', () => {
            assert.deepEqual(parseSkills('   \n  \t  \n'), []);
        });

        it('returns [] for an empty array', () => {
            assert.deepEqual(parseSkills([]), []);
        });
    });

    describe('line format', () => {
        it('parses a single skill', () => {
            assert.deepEqual(parseSkills('apify/agent-skills'), ['apify/agent-skills']);
        });

        it('parses multiple skills, one per line', () => {
            const input = 'apify/agent-skills\nanthropics/skills';
            assert.deepEqual(parseSkills(input), ['apify/agent-skills', 'anthropics/skills']);
        });

        it('ignores blank lines', () => {
            const input = '\n\napify/agent-skills\n\n\nanthropics/skills\n\n';
            assert.deepEqual(parseSkills(input), ['apify/agent-skills', 'anthropics/skills']);
        });

        it('ignores # comment lines', () => {
            const input = '# my skills\napify/agent-skills\n# another comment\nanthropics/skills';
            assert.deepEqual(parseSkills(input), ['apify/agent-skills', 'anthropics/skills']);
        });

        it('trims whitespace around skill names', () => {
            const input = '   apify/agent-skills   \n\t anthropics/skills\t';
            assert.deepEqual(parseSkills(input), ['apify/agent-skills', 'anthropics/skills']);
        });

        it('handles \\r\\n line endings', () => {
            assert.deepEqual(parseSkills('apify/agent-skills\r\nanthropics/skills'), [
                'apify/agent-skills',
                'anthropics/skills',
            ]);
        });

        it('de-duplicates while preserving order', () => {
            const input = 'apify/agent-skills\nanthropics/skills\napify/agent-skills';
            assert.deepEqual(parseSkills(input), ['apify/agent-skills', 'anthropics/skills']);
        });
    });

    describe('JSON array format', () => {
        it('parses a JSON array', () => {
            const input = '["apify/agent-skills", "anthropics/skills"]';
            assert.deepEqual(parseSkills(input), ['apify/agent-skills', 'anthropics/skills']);
        });

        it('parses a JSON array with leading whitespace', () => {
            assert.deepEqual(parseSkills('   ["apify/agent-skills"]   '), ['apify/agent-skills']);
        });

        it('trims and drops empty entries', () => {
            assert.deepEqual(parseSkills('[" apify/agent-skills ", ""]'), ['apify/agent-skills']);
        });

        it('skips non-string entries', () => {
            assert.deepEqual(parseSkills('["apify/agent-skills", 42, null, {"x": 1}]'), ['apify/agent-skills']);
        });

        it('de-duplicates entries', () => {
            assert.deepEqual(parseSkills('["apify/agent-skills", "apify/agent-skills"]'), ['apify/agent-skills']);
        });

        it('returns [] for malformed JSON', () => {
            assert.deepEqual(parseSkills('[not valid json'), []);
        });

        it('returns [] for a non-array JSON value', () => {
            assert.deepEqual(parseSkills('{"skills": ["apify/agent-skills"]}'), []);
        });

        it('parses an empty JSON array as []', () => {
            assert.deepEqual(parseSkills('[]'), []);
        });
    });

    describe('GitHub repo URLs', () => {
        it('passes a repo URL through unchanged (line format)', () => {
            assert.deepEqual(parseSkills('https://github.com/anthropics/skills'), [
                'https://github.com/anthropics/skills',
            ]);
        });

        it('passes a repo URL with a subpath through unchanged', () => {
            const input = 'https://github.com/anthropics/skills/tree/main/skills/web-design';
            assert.deepEqual(parseSkills(input), [input]);
        });

        it('mixes owner/repo shorthand and repo URLs across lines', () => {
            const input = 'apify/agent-skills\nhttps://github.com/anthropics/skills';
            assert.deepEqual(parseSkills(input), ['apify/agent-skills', 'https://github.com/anthropics/skills']);
        });

        it('passes repo URLs through unchanged (JSON array)', () => {
            const input = '["apify/agent-skills", "https://github.com/anthropics/skills"]';
            assert.deepEqual(parseSkills(input), ['apify/agent-skills', 'https://github.com/anthropics/skills']);
        });
    });

    describe('array input (legacy stringList)', () => {
        it('cleans and de-duplicates a string array', () => {
            const input = [' apify/agent-skills ', 'anthropics/skills', 'apify/agent-skills', ''];
            assert.deepEqual(parseSkills(input), ['apify/agent-skills', 'anthropics/skills']);
        });
    });

    describe('format detection', () => {
        it('treats input starting with [ as JSON', () => {
            assert.deepEqual(parseSkills('["apify/agent-skills"]'), ['apify/agent-skills']);
        });

        it('treats input not starting with [ as line format', () => {
            assert.deepEqual(parseSkills('apify/agent-skills'), ['apify/agent-skills']);
        });
    });
});
