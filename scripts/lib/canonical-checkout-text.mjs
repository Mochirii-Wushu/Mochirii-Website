import { Buffer } from "node:buffer";

/**
 * Return canonical Git-style LF bytes while tolerating only CRLF checkout
 * conversion. A bare carriage return is neither a valid LF checkout nor a
 * CRLF checkout and therefore fails closed.
 */
export function canonicalizeCheckoutTextBytes(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const canonical = Buffer.allocUnsafe(bytes.length);
  let writeOffset = 0;

  for (let readOffset = 0; readOffset < bytes.length; readOffset += 1) {
    const byte = bytes[readOffset];
    if (byte !== 0x0d) {
      canonical[writeOffset] = byte;
      writeOffset += 1;
      continue;
    }

    if (bytes[readOffset + 1] !== 0x0a) {
      throw new Error("unsupported bare carriage return in text asset");
    }

    canonical[writeOffset] = 0x0a;
    writeOffset += 1;
    readOffset += 1;
  }

  return canonical.subarray(0, writeOffset);
}
