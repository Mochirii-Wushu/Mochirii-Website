import {
  decodeGallerySourceImage,
  type GallerySourceImageDecoder,
  gallerySourcePreviewResponse,
} from "./gallery-source-decode.ts";
import { validateGallerySourceBytes } from "./gallery-source-image.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

const ONE_PIXEL_PNG = bytesFromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
);

const REAL_JPEG = bytesFromBase64(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAQDAwMDAgQDAwMEBAQFBgoGBgUFBgwICQcKDgwPDg4MDQ0PERYTDxAVEQ0NExoTFRcYGRkZDxIbHRsYHRYYGRj/2wBDAQQEBAYFBgsGBgsYEA0QGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCfgFRcj//Z",
);
const REAL_PNG = bytesFromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAARSURBVAiZY/zPsOo/AwMDAwARAQKqH5iVvgAAAABJRU5ErkJggg==",
);
const REAL_WEBP = bytesFromBase64(
  "UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoCAAIAAUAmJYgCdLoAA5gA/vmo7+1Niqnnd+hRsol8wAAA",
);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function corruptPngPixelsWithoutBreakingStructure(source: Uint8Array) {
  const bytes = Uint8Array.from(source);
  const view = new DataView(bytes.buffer);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    if (dataEnd + 4 > bytes.length) break;
    const type = String.fromCharCode(
      ...bytes.subarray(typeOffset, typeOffset + 4),
    );
    if (type === "IDAT" && length > 0) {
      bytes[dataOffset] ^= 0xff;
      view.setUint32(dataEnd, crc32(bytes, typeOffset, dataEnd), false);
      return bytes;
    }
    offset = dataEnd + 4;
  }
  throw new Error("PNG fixture has no IDAT chunk");
}

Deno.test("fully decodes every accepted source format in the Edge runtime", async () => {
  for (
    const [mimeType, bytes] of [
      ["image/jpeg", REAL_JPEG],
      ["image/png", REAL_PNG],
      ["image/webp", REAL_WEBP],
    ] as const
  ) {
    const structural = await validateGallerySourceBytes(bytes, mimeType);
    assert(structural.ok, `expected structural ${mimeType} evidence`);
    const decoded = await decodeGallerySourceImage(
      bytes,
      mimeType,
      structural.source.width,
      structural.source.height,
    );
    assert(decoded.ok, `expected the runtime decoder to accept ${mimeType}`);
  }
});

Deno.test("rejects structurally plausible PNG bytes that fail full decoding", async () => {
  const corrupt = corruptPngPixelsWithoutBreakingStructure(REAL_PNG);
  const structural = await validateGallerySourceBytes(corrupt, "image/png");
  assert(
    structural.ok,
    "expected the CRC-correct source to pass structural checks",
  );
  const decoded = await decodeGallerySourceImage(
    corrupt,
    "image/png",
    structural.source.width,
    structural.source.height,
  );
  assert(
    !decoded.ok,
    "expected corrupt compressed pixels to fail full decoding",
  );
  assert(
    decoded.error === "source_image_decode_failed",
    "expected a bounded decode failure",
  );
});

Deno.test("fully decodes a valid source with the pinned ephemeral contract", async () => {
  const result = await decodeGallerySourceImage(
    ONE_PIXEL_PNG,
    "image/png",
    1,
    1,
  );

  assert(result.ok, "expected the runtime decoder to accept the PNG");
  assert(result.decode.width === 1, "expected decoded width");
  assert(result.decode.height === 1, "expected decoded height");
  assert(
    result.decode.decoderVersion === "gallery-source-decode-v1",
    "expected the independent decode contract version",
  );
});

Deno.test("copies bytes into the decoder Blob and always closes the bitmap", async () => {
  const decodedBlobs: Blob[] = [];
  let closeCount = 0;
  const decoder: GallerySourceImageDecoder = (source) => {
    decodedBlobs.push(source);
    return Promise.resolve({
      width: 2,
      height: 3,
      close: () => {
        closeCount += 1;
      },
    });
  };
  const source = new Uint8Array([1, 2, 3]);

  const result = await decodeGallerySourceImage(
    source,
    "image/jpeg",
    2,
    3,
    decoder,
  );
  source.fill(9);

  assert(result.ok, "expected injected full decode to pass");
  assert(closeCount === 1, "expected the ephemeral bitmap to be closed");
  assert(decodedBlobs.length === 1, "expected one decoder Blob");
  const decodedBlob = decodedBlobs[0];
  assert(decodedBlob.type === "image/jpeg", "expected canonical Blob MIME");
  assert(
    JSON.stringify([...new Uint8Array(await decodedBlob.arrayBuffer())]) ===
      JSON.stringify([1, 2, 3]),
    "expected the decoder Blob to own a stable byte copy",
  );
});

Deno.test("fails closed when decoded dimensions disagree with structural evidence", async () => {
  let closeCount = 0;
  const result = await decodeGallerySourceImage(
    new Uint8Array([1]),
    "image/webp",
    2,
    3,
    () =>
      Promise.resolve({
        width: 3,
        height: 2,
        close: () => {
          closeCount += 1;
        },
      }),
  );

  assert(!result.ok, "expected a decoded-dimension mismatch");
  assert(
    result.error === "source_image_decode_dimensions_mismatch",
    "expected a bounded mismatch error",
  );
  assert(closeCount === 1, "expected rejected bitmap to be closed");
});

Deno.test("permits only the JPEG orientation-swapped dimension pair", async () => {
  const jpeg = await decodeGallerySourceImage(
    new Uint8Array([1]),
    "image/jpeg",
    2,
    3,
    () => Promise.resolve({ width: 3, height: 2, close: () => undefined }),
  );
  const png = await decodeGallerySourceImage(
    new Uint8Array([1]),
    "image/png",
    2,
    3,
    () => Promise.resolve({ width: 3, height: 2, close: () => undefined }),
  );

  assert(jpeg.ok, "expected EXIF-oriented JPEG dimensions to be accepted");
  assert(!png.ok, "expected non-JPEG swapped dimensions to be rejected");
  assert(
    png.error === "source_image_decode_dimensions_mismatch",
    "expected the bounded non-JPEG mismatch error",
  );
});

Deno.test("fails closed without leaking decoder exceptions", async () => {
  const result = await decodeGallerySourceImage(
    new Uint8Array([1]),
    "image/png",
    1,
    1,
    () => Promise.reject(new Error("attacker-controlled decoder detail")),
  );

  assert(!result.ok, "expected decoder rejection to fail closed");
  assert(
    result.error === "source_image_decode_failed",
    "expected a bounded decode error",
  );
  assert(
    !JSON.stringify(result).includes("attacker-controlled"),
    "expected no decoder detail in the result",
  );
});

Deno.test("rejects invalid decode contracts before invoking the decoder", async () => {
  let calls = 0;
  const decoder: GallerySourceImageDecoder = () => {
    calls += 1;
    return Promise.resolve({ width: 1, height: 1, close: () => undefined });
  };
  const result = await decodeGallerySourceImage(
    new Uint8Array(),
    "image/png",
    1,
    1,
    decoder,
  );

  assert(!result.ok, "expected an empty source to fail closed");
  assert(
    result.error === "source_image_decode_contract_invalid",
    "expected the bounded contract error",
  );
  assert(calls === 0, "expected no decoder call for an invalid contract");
});

Deno.test("returns private binary source transport without source evidence headers", async () => {
  const validatedAt = "2026-07-28T12:34:56.000Z";
  const response = gallerySourcePreviewResponse(
    new Uint8Array([1, 2, 3, 4]),
    {
      submissionId: "123e4567-e89b-42d3-a456-426614174000",
      mimeType: "image/webp",
      width: 640,
      height: 480,
      validatedAt,
    },
  );

  assert(response.status === 200, "expected a successful binary response");
  assert(response.headers.get("Content-Type") === "image/webp", "MIME");
  assert(response.headers.get("Content-Length") === "4", "byte length");
  assert(
    response.headers.get("Cache-Control") === "private, no-store",
    "cache boundary",
  );
  assert(
    response.headers.get("Pragma") === "no-cache",
    "legacy cache boundary",
  );
  assert(
    response.headers.get("X-Content-Type-Options") === "nosniff",
    "MIME boundary",
  );
  assert(
    response.headers.get("X-Robots-Tag")?.includes("noindex"),
    "robot boundary",
  );
  assert(
    response.headers.get("Referrer-Policy") === "no-referrer",
    "referrer boundary",
  );
  assert(
    [...response.headers.keys()].every((name) =>
      !name.toLowerCase().startsWith("x-gallery-source") &&
      name.toLowerCase() !== "x-gallery-submission-id"
    ),
    "private source evidence reached response headers",
  );
  assert(
    JSON.stringify([...new Uint8Array(await response.arrayBuffer())]) ===
      JSON.stringify([1, 2, 3, 4]),
    "expected the validated source bytes",
  );
  assert(!response.headers.has("Location"), "must not return a signed URL");
});
