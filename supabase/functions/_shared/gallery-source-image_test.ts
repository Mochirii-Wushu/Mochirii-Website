import {
  GALLERY_SOURCE_IMAGE_MAX_BYTES,
  validateGallerySourceBytes as validateGallerySourceImage,
} from "./gallery-source-image.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function jpegFrame(
  width: number,
  height: number,
  options: { components?: number; precision?: number; marker?: number } = {},
): Uint8Array {
  const components = options.components ?? 3;
  const precision = options.precision ?? 8;
  const marker = options.marker ?? 0xc0;
  const frame = [
    0xff,
    marker,
    ...uint16(8 + (3 * components)),
    precision,
    ...uint16(height),
    ...uint16(width),
    components,
  ];
  for (let index = 1; index <= components; index += 1) {
    frame.push(index, 0x11, 0);
  }
  return new Uint8Array(frame);
}

function jpegScan(components = 3): Uint8Array {
  const scan = [0xff, 0xda, ...uint16(6 + (2 * components)), components];
  for (let index = 1; index <= components; index += 1) {
    scan.push(index, 0);
  }
  scan.push(0, 63, 0, 0x01, 0xff, 0x00, 0x02);
  return new Uint8Array(scan);
}

function jpeg(
  width: number,
  height: number,
  options: { components?: number; precision?: number; marker?: number } = {},
): Uint8Array {
  const components = options.components ?? 3;
  return concat(
    new Uint8Array([0xff, 0xd8]),
    jpegFrame(width, height, options),
    jpegScan(components),
    new Uint8Array([0xff, 0xd9]),
  );
}

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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(
  type: string,
  data: Uint8Array = new Uint8Array(),
): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = concat(typeBytes, data);
  return concat(uint32(data.length), crcInput, uint32(crc32(crcInput)));
}

function png(
  width: number,
  height: number,
  options: {
    bitDepth?: number;
    colorType?: number;
    interlace?: number;
    beforeData?: Uint8Array[];
    afterData?: Uint8Array[];
  } = {},
): Uint8Array {
  const header = concat(
    uint32(width),
    uint32(height),
    new Uint8Array([
      options.bitDepth ?? 8,
      options.colorType ?? 6,
      0,
      0,
      options.interlace ?? 0,
    ]),
  );
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    ...(options.beforeData ?? []),
    pngChunk("IDAT", new Uint8Array([0x78, 0x01, 0x01, 0x00, 0x00])),
    ...(options.afterData ?? []),
    pngChunk("IEND"),
  );
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function appendRiffChunk(
  bytes: Uint8Array,
  fourcc: string,
  data: Uint8Array,
): Uint8Array {
  const padding = data.length % 2;
  const result = new Uint8Array(bytes.length + 8 + data.length + padding);
  result.set(bytes);
  result.set(new TextEncoder().encode(fourcc), bytes.length);
  const view = new DataView(result.buffer);
  view.setUint32(bytes.length + 4, data.length, true);
  result.set(data, bytes.length + 8);
  view.setUint32(4, result.length - 8, true);
  return result;
}

function withVp8x(
  bytes: Uint8Array,
  width: number,
  height: number,
  flags = 0,
): Uint8Array {
  const chunk = new Uint8Array(18);
  chunk.set(new TextEncoder().encode("VP8X"), 0);
  const view = new DataView(chunk.buffer);
  view.setUint32(4, 10, true);
  chunk[8] = flags;
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  chunk[12] = widthMinusOne & 0xff;
  chunk[13] = (widthMinusOne >>> 8) & 0xff;
  chunk[14] = (widthMinusOne >>> 16) & 0xff;
  chunk[15] = heightMinusOne & 0xff;
  chunk[16] = (heightMinusOne >>> 8) & 0xff;
  chunk[17] = (heightMinusOne >>> 16) & 0xff;

  const result = new Uint8Array(bytes.length + chunk.length);
  result.set(bytes.subarray(0, 12));
  result.set(chunk, 12);
  result.set(bytes.subarray(12), 12 + chunk.length);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}

const STATIC_VP8 = fromBase64(
  "UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoCAAIAAUAmJYgCdLoAA5gA/vmo7+1Niqnnd+hRsol8wAAA",
);

function structuralVp8l(
  width: number,
  height: number,
  alpha = false,
): Uint8Array {
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  const data = new Uint8Array(6);
  data[0] = 0x2f;
  data[1] = widthMinusOne & 0xff;
  data[2] = ((widthMinusOne >>> 8) & 0x3f) |
    ((heightMinusOne & 0x03) << 6);
  data[3] = (heightMinusOne >>> 2) & 0xff;
  data[4] = ((heightMinusOne >>> 10) & 0x0f) | (alpha ? 0x10 : 0);
  data[5] = 0;

  const result = new Uint8Array(12 + 8 + data.length);
  result.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  result.set(new TextEncoder().encode("WEBPVP8L"), 8);
  new DataView(result.buffer).setUint32(16, data.length, true);
  result.set(data, 20);
  return result;
}

async function expectError(
  bytes: Uint8Array,
  error: string,
  declaredMimeType?: string,
): Promise<void> {
  const result = await validateGallerySourceImage(bytes, declaredMimeType);
  assert(!result.ok, `expected ${error}, received a valid image`);
  assert(result.error === error, `expected ${error}, received ${result.error}`);
}

Deno.test("returns canonical JPEG evidence after strict structural validation", async () => {
  const bytes = jpeg(1600, 900);
  const result = await validateGallerySourceImage(bytes, "image/jpeg");
  assert(result.ok, "expected JPEG to pass");
  assert(result.source.mimeType === "image/jpeg", "canonical MIME was wrong");
  assert(
    result.source.width === 1600 && result.source.height === 900,
    "dimensions were wrong",
  );
  assert(result.source.sizeBytes === bytes.length, "encoded size was wrong");
  assert(
    /^[0-9a-f]{64}$/.test(result.source.sha256),
    "SHA-256 was not canonical hex",
  );
  assert(
    result.source.validatorVersion === "gallery-source-v1",
    "validator version was not recorded",
  );
});

Deno.test("accepts baseline, progressive, grayscale, RGB, and CMYK JPEG structures", async () => {
  for (
    const bytes of [
      jpeg(1, 1, { components: 1 }),
      jpeg(320, 180, { components: 3, marker: 0xc2 }),
      jpeg(640, 480, { components: 4 }),
    ]
  ) {
    assert(
      (await validateGallerySourceImage(bytes)).ok,
      "supported JPEG structure failed",
    );
  }
});

Deno.test("rejects unsafe JPEG precision, component counts, and coding modes", async () => {
  await expectError(
    jpeg(320, 180, { precision: 12 }),
    "source_image_jpeg_precision_unsupported",
  );
  await expectError(
    jpeg(320, 180, { components: 5 }),
    "source_image_jpeg_components_unsupported",
  );
  await expectError(
    jpeg(320, 180, { marker: 0xc1 }),
    "source_image_jpeg_mode_unsupported",
  );
});

Deno.test("rejects JPEG duplicate dimensions, truncation, and trailing data", async () => {
  const valid = jpeg(320, 180);
  const duplicate = concat(
    valid.subarray(0, 2),
    jpegFrame(320, 180),
    valid.subarray(2),
  );
  await expectError(duplicate, "source_image_jpeg_invalid");
  await expectError(
    valid.subarray(0, valid.length - 2),
    "source_image_jpeg_invalid",
  );
  await expectError(
    concat(valid, new Uint8Array([0])),
    "source_image_jpeg_invalid",
  );
});

Deno.test("returns canonical PNG evidence and permits standard ancillary chunks", async () => {
  const bytes = png(1200, 800, {
    beforeData: [pngChunk("tEXt", new TextEncoder().encode("key\0value"))],
  });
  const result = await validateGallerySourceImage(bytes, "image/png");
  assert(result.ok, "expected PNG to pass");
  assert(result.source.mimeType === "image/png", "canonical MIME was wrong");
  assert(
    result.source.width === 1200 && result.source.height === 800,
    "dimensions were wrong",
  );
});

Deno.test("accepts every supported 8-bit PNG color mode and Adam7", async () => {
  for (const colorType of [0, 2, 4, 6]) {
    assert(
      (await validateGallerySourceImage(png(2, 2, { colorType }))).ok,
      `color type ${colorType} failed`,
    );
  }
  const palette = pngChunk("PLTE", new Uint8Array([0, 0, 0, 255, 255, 255]));
  assert(
    (await validateGallerySourceImage(
      png(2, 2, { colorType: 3, beforeData: [palette] }),
    )).ok,
    "indexed PNG failed",
  );
  assert(
    (await validateGallerySourceImage(png(2, 2, { interlace: 1 }))).ok,
    "Adam7 PNG failed",
  );
});

Deno.test("rejects unsupported PNG depth, color, interlace, animation, and critical chunks", async () => {
  await expectError(
    png(2, 2, { bitDepth: 16 }),
    "source_image_png_mode_unsupported",
  );
  await expectError(
    png(2, 2, { colorType: 1 }),
    "source_image_png_mode_unsupported",
  );
  await expectError(
    png(2, 2, { interlace: 2 }),
    "source_image_png_mode_unsupported",
  );
  await expectError(
    png(2, 2, { beforeData: [pngChunk("acTL", new Uint8Array(8))] }),
    "source_image_png_animated",
  );
  await expectError(
    png(2, 2, { beforeData: [pngChunk("ABCD", new Uint8Array([1]))] }),
    "source_image_png_mode_unsupported",
  );
});

Deno.test("rejects PNG duplicate headers, CRC changes, nonconsecutive data, and truncation", async () => {
  const valid = png(2, 2);
  const duplicateHeader = concat(
    valid.subarray(0, 33),
    valid.subarray(8, 33),
    valid.subarray(33),
  );
  await expectError(duplicateHeader, "source_image_png_invalid");

  const corruptCrc = valid.slice();
  corruptCrc[29] ^= 1;
  await expectError(corruptCrc, "source_image_png_invalid");

  const separated = png(2, 2, {
    afterData: [
      pngChunk("tEXt", new Uint8Array([1])),
      pngChunk("IDAT", new Uint8Array([1])),
    ],
  });
  await expectError(separated, "source_image_png_invalid");
  await expectError(
    valid.subarray(0, valid.length - 1),
    "source_image_png_invalid",
  );
  await expectError(
    concat(valid, new Uint8Array([0])),
    "source_image_png_invalid",
  );
  await expectError(
    png(2, 2, { beforeData: [pngChunk("tere", new Uint8Array([1]))] }),
    "source_image_png_invalid",
  );
});

Deno.test("returns canonical evidence for simple and extended static WebP", async () => {
  const simple = await validateGallerySourceImage(STATIC_VP8, "image/webp");
  assert(simple.ok, "simple VP8 WebP failed");
  assert(
    simple.source.width === 2 && simple.source.height === 2,
    "VP8 dimensions were wrong",
  );

  const extended = await validateGallerySourceImage(withVp8x(STATIC_VP8, 2, 2));
  assert(extended.ok, "extended static WebP failed");
  assert(
    (await validateGallerySourceImage(structuralVp8l(16, 12))).ok,
    "VP8L WebP failed",
  );
});

Deno.test("rejects WebP metadata, animation, unknown chunks, and unsafe VP8X flags", async () => {
  for (const chunk of ["ICCP", "EXIF", "XMP ", "ANIM", "ANMF", "JUNK"]) {
    await expectError(
      appendRiffChunk(STATIC_VP8, chunk, new Uint8Array([1, 2])),
      "source_image_webp_features_unsupported",
    );
  }
  for (const flag of [0x20, 0x08, 0x04, 0x02, 0x01, 0x40, 0x80]) {
    await expectError(
      withVp8x(STATIC_VP8, 2, 2, flag),
      "source_image_webp_features_unsupported",
    );
  }
});

Deno.test("rejects WebP duplicate dimensions, mismatches, invalid order, and truncation", async () => {
  await expectError(withVp8x(STATIC_VP8, 3, 2), "source_image_webp_invalid");
  await expectError(
    withVp8x(withVp8x(STATIC_VP8, 2, 2), 2, 2),
    "source_image_webp_invalid",
  );
  await expectError(
    appendRiffChunk(STATIC_VP8, "VP8 ", STATIC_VP8.subarray(20)),
    "source_image_webp_invalid",
  );
  await expectError(
    STATIC_VP8.subarray(0, STATIC_VP8.length - 1),
    "source_image_webp_invalid",
  );
  const badRiffLength = STATIC_VP8.slice();
  new DataView(badRiffLength.buffer).setUint32(4, 1, true);
  await expectError(badRiffLength, "source_image_webp_invalid");
});

Deno.test("enforces encoded-byte, edge, and pixel ceilings independently", async () => {
  await expectError(
    new Uint8Array(GALLERY_SOURCE_IMAGE_MAX_BYTES + 1),
    "source_image_bytes_too_large",
  );
  await expectError(jpeg(4097, 1), "source_image_dimensions_out_of_bounds");
  assert(
    (await validateGallerySourceImage(jpeg(4096, 3076))).ok,
    "bounded pixel edge failed",
  );
  await expectError(jpeg(4096, 3077), "source_image_pixel_count_out_of_bounds");
});

Deno.test("rejects unsupported bytes and MIME confusion", async () => {
  await expectError(new Uint8Array(), "source_image_bytes_invalid");
  await expectError(
    new TextEncoder().encode("not an image"),
    "source_image_type_unsupported",
  );
  await expectError(jpeg(1, 1), "source_image_mime_mismatch", "image/png");
  await expectError(
    jpeg(1, 1),
    "source_image_declared_mime_invalid",
    "image/jpg",
  );
});
