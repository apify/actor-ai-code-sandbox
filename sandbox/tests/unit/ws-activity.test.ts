/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
/* eslint-disable no-bitwise -- building WebSocket frame headers */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createWsActivityDetector, parseFrameHeader } from '../../src/ws-activity.js';

/** Build a masked client→server frame (FIN set) with the given opcode and payload. */
const frame = (opcode: number, payload: Buffer | string = ''): Buffer => {
    const body = Buffer.from(payload);
    let lenBytes: Buffer;
    if (body.length < 126) {
        lenBytes = Buffer.from([0x80 | body.length]);
    } else if (body.length < 65536) {
        lenBytes = Buffer.alloc(3);
        lenBytes[0] = 0x80 | 126;
        lenBytes.writeUInt16BE(body.length, 1);
    } else {
        lenBytes = Buffer.alloc(9);
        lenBytes[0] = 0x80 | 127;
        lenBytes.writeBigUInt64BE(BigInt(body.length), 1);
    }
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.from(body.map((b, i) => b ^ mask[i % 4]));
    return Buffer.concat([Buffer.from([0x80 | opcode]), lenBytes, mask, masked]);
};

const TEXT = 0x1;
const BINARY = 0x2;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;

/** Feed chunks through a fresh detector and return how many times it fired. */
const run = (chunks: Buffer[]): number => {
    let count = 0;
    const feed = createWsActivityDetector(() => count++);
    for (const c of chunks) feed(c);
    return count;
};

describe('parseFrameHeader', () => {
    it('parses 7-bit, 16-bit and 64-bit payload lengths', () => {
        assert.deepEqual(parseFrameHeader(frame(TEXT, 'hi')), { opcode: TEXT, headerLength: 6, payloadLength: 2 });
        assert.deepEqual(parseFrameHeader(frame(BINARY, Buffer.alloc(300))), {
            opcode: BINARY,
            headerLength: 8,
            payloadLength: 300,
        });
        assert.deepEqual(parseFrameHeader(frame(BINARY, Buffer.alloc(70000))), {
            opcode: BINARY,
            headerLength: 14,
            payloadLength: 70000,
        });
    });

    it('returns null for an incomplete header', () => {
        assert.equal(parseFrameHeader(Buffer.from([0x81])), null);
        assert.equal(parseFrameHeader(frame(TEXT, 'hi').subarray(0, 5)), null);
    });
});

describe('createWsActivityDetector', () => {
    it('ignores ping, pong and close frames', () => {
        assert.equal(run([frame(PONG, 'x')]), 0);
        assert.equal(run([frame(PING), frame(PONG), frame(CLOSE, '\x03\xe8')]), 0);
    });

    it('reports data frames', () => {
        assert.equal(run([frame(BINARY, '0ls\r')]), 1);
        assert.equal(run([frame(TEXT, '{"columns":80}')]), 1);
    });

    it('reports a data frame packed after a pong in the same chunk', () => {
        assert.equal(run([Buffer.concat([frame(PONG, 'x'), frame(BINARY, '0a')])]), 1);
    });

    it('does not mistake payload bytes for frame headers', () => {
        // A binary frame whose payload looks like pong frames, followed by a
        // real pong, split so the payload spans chunks.
        const payload = Buffer.concat([frame(PONG), frame(PONG), Buffer.alloc(200, 0x8a)]);
        const bytes = Buffer.concat([frame(BINARY, payload), frame(PONG, 'y')]);
        let count = 0;
        const feed = createWsActivityDetector(() => count++);
        feed(bytes.subarray(0, 10));
        feed(bytes.subarray(10, 150));
        assert.equal(count, 1);
        feed(bytes.subarray(150));
        assert.equal(count, 1);
    });

    it('handles headers split byte-by-byte across chunks', () => {
        const bytes = Buffer.concat([frame(PONG, 'abc'), frame(PONG, Buffer.alloc(300)), frame(PING)]);
        assert.equal(run([...bytes].map((b) => Buffer.from([b]))), 0);

        const withData = Buffer.concat([frame(PONG, 'abc'), frame(BINARY, Buffer.alloc(70000))]);
        assert.equal(run([...withData].map((b) => Buffer.from([b]))), 1);
    });
});
