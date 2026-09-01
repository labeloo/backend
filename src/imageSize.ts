/**
 * Read an image's pixel dimensions from its header.
 *
 * This replaces three `sharp(...).metadata()` calls that were the only reason
 * the API carried a native binary at all - it never resized or re-encoded
 * anything, it only ever asked how big the picture was. Dropping sharp takes a
 * platform-specific dependency out of the self-hosted image and is what lets the
 * same code run on a Worker, where a native module cannot load.
 *
 * Returns null for anything it does not recognise, so a caller that cannot read
 * a size skips that file rather than guessing one.
 */
export const imageSize = (bytes: Uint8Array): { width: number; height: number } | null => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // PNG: an 8-byte signature, then IHDR carries width and height as big-endian u32.
    if (bytes.length > 24 && view.getUint32(0) === 0x89504e47) {
        return { width: view.getUint32(16), height: view.getUint32(20) };
    }

    // GIF: "GIF8", then little-endian u16 width and height.
    if (bytes.length > 10 && view.getUint32(0) === 0x47494638) {
        return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }

    // WebP: RIFF container; the three variants keep the size in different places.
    if (bytes.length > 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
        const fourcc = view.getUint32(12);
        if (fourcc === 0x56503820) {              // "VP8 " lossy
            return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
        }
        if (fourcc === 0x5650384c) {              // "VP8L" lossless: 14 bits each, packed
            const bits = view.getUint32(21, true);
            return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (fourcc === 0x56503858) {              // "VP8X" extended: 24-bit minus one
            const w = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16);
            const h = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16);
            return { width: w + 1, height: h + 1 };
        }
        return null;
    }

    // JPEG: walk the segments to the frame header, which is the only place the
    // size is written. Everything before it is metadata of unknown length.
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < bytes.length) {
            if (bytes[offset] !== 0xff) { offset++; continue; }   // resynchronise on padding
            const marker = bytes[offset + 1]!;
            // Standalone markers carry no length field.
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
                offset += 2;
                continue;
            }
            if (marker === 0xd9 || marker === 0xda) return null;  // end, or entropy-coded data
            const length = view.getUint16(offset + 2);
            // SOF0..SOF15, except the four that are not frame headers.
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
            }
            if (length < 2) return null;                          // malformed; do not loop forever
            offset += 2 + length;
        }
    }

    return null;
};
