import { GALLERY_MEDIA_VERSION, GalleryImageError } from "./policy.ts";

function keyBytes(secret: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw new GalleryImageError("image_processor_unavailable");
  return Uint8Array.from(secret.match(/../g)!, (part) => Number.parseInt(part, 16));
}

export async function signGalleryMedia(body: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", keyBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(GALLERY_MEDIA_VERSION + "\n" + body));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyGalleryMedia(body: string, signature: string, secret: string) {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", keyBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g)!, (part) => Number.parseInt(part, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(GALLERY_MEDIA_VERSION + "\n" + body));
}
