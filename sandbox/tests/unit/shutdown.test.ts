/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
/* eslint-disable no-bitwise -- decoding a WebSocket frame in the test mirrors the bit-level wire format */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { broadcastToTerminals, buildShutdownBanner, encodeTtydOutputMessage } from '../../src/shutdown.js';

describe('buildShutdownBanner', () => {
    it('includes the shutdown headline and the reason', () => {
        const banner = buildShutdownBanner('Out for lunch.');
        assert.ok(banner.includes('Apify AI Sandbox is shutting down'));
        assert.ok(banner.includes('Out for lunch.'));
    });

    it('uses CRLF line endings for raw-mode terminals', () => {
        const banner = buildShutdownBanner('reason');
        // A bare \n (not preceded by \r) would not return the cursor to column 0.
        for (let i = 0; i < banner.length; i += 1) {
            if (banner[i] === '\n') {
                assert.equal(banner[i - 1], '\r', `bare \\n at index ${i}`);
            }
        }
    });

    it('includes a restart link when a run ID is provided', () => {
        const banner = buildShutdownBanner('reason', 'RUN123');
        assert.ok(banner.includes('https://console.apify.com/view/runs/RUN123'));
    });

    it('omits the restart link when no run ID is provided', () => {
        const banner = buildShutdownBanner('reason');
        assert.ok(!banner.includes('console.apify.com'));
    });
});

describe('broadcastToTerminals', () => {
    it('does nothing and does not throw when the pts directory is absent', () => {
        assert.doesNotThrow(() => broadcastToTerminals('hi', '/no/such/pts/dir'));
    });
});

describe('encodeTtydOutputMessage', () => {
    /** Decode a frame the way ttyd's browser client does: one binary frame, drop the command byte. */
    const decode = (frame: Buffer): { command: string; text: string } => {
        assert.equal(frame[0], 0x82, 'first byte must be FIN + binary opcode');
        assert.equal(frame[1] & 0x80, 0, 'server-to-client frames must not be masked');

        let len = frame[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
            len = frame.readUInt16BE(2);
            offset = 4;
        } else if (len === 127) {
            len = Number(frame.readBigUInt64BE(2));
            offset = 10;
        }

        const payload = frame.subarray(offset, offset + len);
        return { command: String.fromCharCode(payload[0]), text: payload.subarray(1).toString('utf8') };
    };

    it('wraps text as a ttyd OUTPUT ("0") message that round-trips', () => {
        const { command, text } = decode(encodeTtydOutputMessage('hello world'));
        assert.equal(command, '0');
        assert.equal(text, 'hello world');
    });

    it('round-trips a full shutdown banner (length > 125 uses the extended header)', () => {
        const banner = buildShutdownBanner('Actor shut down after 15 minutes of inactivity.', 'RUN123');
        assert.ok(banner.length > 125, 'banner should be long enough to exercise the 16-bit length path');
        const { command, text } = decode(encodeTtydOutputMessage(banner));
        assert.equal(command, '0');
        assert.equal(text, banner);
    });

    it('preserves multi-byte UTF-8 by measuring length in bytes, not characters', () => {
        const { text } = decode(encodeTtydOutputMessage('héllo — 🚀'));
        assert.equal(text, 'héllo — 🚀');
    });
});
