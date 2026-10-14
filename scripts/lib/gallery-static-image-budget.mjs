import { createHash } from "node:crypto";

// These two immutable files preserve the owner-approved, localized pixel edit.
// A later replacement must be reviewed again; the path alone grants no exception.
export const galleryExactPixelAssets = Object.freeze({
  "assets/img/gallery/shot-44.webp": Object.freeze({
    bytes: 2318000,
    sha256: "A620836AEB80B5856BB8D7091A9F49A1B219AAEBD1A1C6D2BB94BB505189D958",
    maximumBytes: 3 * 1024 * 1024,
    width: 1920,
    height: 1341,
  }),
  "assets/img/gallery/thumbs/shot-44.webp": Object.freeze({
    bytes: 562614,
    sha256: "6F2871A0E19F8BBBC286B0DFADF03742503C9FEF898FD785BBC5FCEAD6569247",
    maximumBytes: 600 * 1024,
    width: 900,
    height: 629,
  }),
});

export function galleryStaticImageBudget(assetPath, bytes, kind) {
  if (kind !== "full" && kind !== "thumbnail") throw new Error("Unknown gallery image kind.");
  const normalMaximum = kind === "full" ? 2 * 1024 * 1024 : 300 * 1024;
  const exception = Object.hasOwn(galleryExactPixelAssets, assetPath)
    ? galleryExactPixelAssets[assetPath]
    : null;
  if (!exception) return { maximumBytes: normalMaximum };
  if (!Buffer.isBuffer(bytes)
    || bytes.length !== exception.bytes
    || createHash("sha256").update(bytes).digest("hex").toUpperCase() !== exception.sha256) {
    throw new Error("Gallery exact-pixel asset seal rejected.");
  }
  return exception;
}
