/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises by design */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { broadcastToTerminals, buildShutdownBanner } from '../../src/shutdown.js';

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
