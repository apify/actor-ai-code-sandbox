/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isFlatJsonObject, safeParseJson } from '../../src/safe-json.js';

describe('isFlatJsonObject', () => {
    it('returns true for an empty object', () => {
        assert.equal(isFlatJsonObject({}), true);
    });

    it('returns true for a non-empty object', () => {
        assert.equal(isFlatJsonObject({ foo: 1 }), true);
    });

    it('returns true for an object with nested values (only the top-level is checked)', () => {
        assert.equal(isFlatJsonObject({ foo: { bar: 1 } }), true);
    });

    it('returns false for an empty array', () => {
        assert.equal(isFlatJsonObject([]), false);
    });

    it('returns false for a non-empty array', () => {
        assert.equal(isFlatJsonObject([1, 2, 3]), false);
    });

    it('returns false for null', () => {
        assert.equal(isFlatJsonObject(null), false);
    });

    it('returns false for primitive values', () => {
        assert.equal(isFlatJsonObject('string'), false);
        assert.equal(isFlatJsonObject(42), false);
        assert.equal(isFlatJsonObject(true), false);
        assert.equal(isFlatJsonObject(undefined), false);
    });
});

describe('safeParseJson', () => {
    const shapeMsg = 'must be a flat object';
    const arrayMsg = 'must be an array';

    describe('with isFlatJsonObject predicate', () => {
        it('returns the parsed object on success', () => {
            assert.deepEqual(safeParseJson('{"foo": "bar"}', 'test', isFlatJsonObject, shapeMsg), { foo: 'bar' });
        });

        it('parses a pretty-printed object', () => {
            const input = '{\n  "foo": "bar",\n  "baz": 1\n}';
            assert.deepEqual(safeParseJson(input, 'test', isFlatJsonObject, shapeMsg), { foo: 'bar', baz: 1 });
        });

        it('returns null for an array', () => {
            assert.equal(safeParseJson('["foo"]', 'test', isFlatJsonObject, shapeMsg), null);
        });

        it('returns null for a JSON null literal', () => {
            assert.equal(safeParseJson('null', 'test', isFlatJsonObject, shapeMsg), null);
        });

        it('returns null for a primitive value', () => {
            assert.equal(safeParseJson('42', 'test', isFlatJsonObject, shapeMsg), null);
            assert.equal(safeParseJson('"hello"', 'test', isFlatJsonObject, shapeMsg), null);
        });
    });

    describe('with Array.isArray predicate', () => {
        it('returns the parsed array on success', () => {
            assert.deepEqual(safeParseJson('["a", "b"]', 'test', Array.isArray, arrayMsg), ['a', 'b']);
        });

        it('parses an empty array', () => {
            assert.deepEqual(safeParseJson('[]', 'test', Array.isArray, arrayMsg), []);
        });

        it('returns null for an object', () => {
            assert.equal(safeParseJson('{"foo": 1}', 'test', Array.isArray, arrayMsg), null);
        });
    });

    describe('malformed JSON', () => {
        it('returns null for syntactically invalid JSON', () => {
            assert.equal(safeParseJson('{not valid json', 'test', isFlatJsonObject, shapeMsg), null);
        });

        it('returns null for an unterminated string', () => {
            assert.equal(safeParseJson('"unterminated', 'test', isFlatJsonObject, shapeMsg), null);
        });

        it('returns null for empty input', () => {
            assert.equal(safeParseJson('', 'test', isFlatJsonObject, shapeMsg), null);
        });

        it('returns null for whitespace-only input', () => {
            assert.equal(safeParseJson('   ', 'test', isFlatJsonObject, shapeMsg), null);
        });
    });

    describe('custom predicates', () => {
        it('honors a stricter type guard', () => {
            const isStringArray = (v: unknown): v is string[] =>
                Array.isArray(v) && v.every((x) => typeof x === 'string');
            assert.deepEqual(safeParseJson('["a", "b"]', 'test', isStringArray, 'string[]'), ['a', 'b']);
            assert.equal(safeParseJson('[1, 2]', 'test', isStringArray, 'string[]'), null);
        });
    });
});
