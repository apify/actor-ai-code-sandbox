/* eslint-disable no-bitwise -- WebSocket frame headers are bit fields */
/**
 * Detects user activity in a raw client→server WebSocket byte stream.
 *
 * Proxied WebSockets (the /shell terminal, bridged apps) are piped as raw
 * bytes, so counting every inbound byte as activity lets keepalive traffic
 * hold the sandbox open forever: ttyd pings the browser every 5 s and the
 * browser pongs automatically. This parser walks the frame headers and only
 * reports data frames (text, binary, continuation); ping, pong and close
 * frames are ignored. Payloads are skipped, never buffered.
 */

/** WebSocket opcodes >= 0x8 are control frames (close, ping, pong). */
const FIRST_CONTROL_OPCODE = 0x8;

/** Longest possible frame header: 2 + 8 (64-bit length) + 4 (mask). */
const MAX_HEADER_LENGTH = 14;

interface FrameHeader {
    opcode: number;
    headerLength: number;
    payloadLength: number;
}

/** Parse a frame header from the start of `buf`, or null if it's incomplete. */
export const parseFrameHeader = (buf: Buffer): FrameHeader | null => {
    if (buf.length < 2) return null;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    const len7 = buf[1] & 0x7f;

    let headerLength = 2;
    let payloadLength = len7;
    if (len7 === 126) {
        headerLength += 2;
        if (buf.length < headerLength) return null;
        payloadLength = buf.readUInt16BE(2);
    } else if (len7 === 127) {
        headerLength += 8;
        if (buf.length < headerLength) return null;
        payloadLength = Number(buf.readBigUInt64BE(2));
    }
    if (masked) headerLength += 4;
    if (buf.length < headerLength) return null;

    return { opcode, headerLength, payloadLength };
};

/**
 * Create a stateful chunk handler for one connection's inbound byte stream.
 * Frames may be split across (or packed into) chunks arbitrarily. `onActivity`
 * is called once per chunk that contains the start of at least one data frame.
 */
export const createWsActivityDetector = (onActivity: () => void): ((chunk: Buffer) => void) => {
    // Partial frame header carried over from the previous chunk.
    let header = Buffer.alloc(0);
    // Payload bytes of the current frame still to skip.
    let skip = 0;

    return (chunk: Buffer) => {
        let offset = 0;
        let sawData = false;

        while (offset < chunk.length) {
            if (skip > 0) {
                const n = Math.min(skip, chunk.length - offset);
                skip -= n;
                offset += n;
                continue;
            }

            const carried = header.length;
            header = Buffer.concat([header, chunk.subarray(offset, offset + MAX_HEADER_LENGTH - carried)]);
            const parsed = parseFrameHeader(header);
            if (!parsed) {
                // Incomplete header: the rest of this chunk is kept in `header`.
                break;
            }

            if (parsed.opcode < FIRST_CONTROL_OPCODE) sawData = true;
            offset += parsed.headerLength - carried;
            header = Buffer.alloc(0);
            skip = parsed.payloadLength;
        }

        if (sawData) onActivity();
    };
};
