export const GALLERY_MODERATOR_PREVIEW_VERSION = "gallery-moderator-preview-v1";
export const GALLERY_SOURCE_DECODE_VERSION = "gallery-source-decode-v1";
export const GALLERY_MODERATOR_PREVIEW_MIME_TYPE = "image/webp";
export const GALLERY_MODERATOR_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const GALLERY_MODERATOR_PREVIEW_MAX_EDGE = 2560;
export const GALLERY_SANITIZER_ATTESTATION_HEADER =
  "x-gallery-sanitizer-attestation";
export const GALLERY_LOCAL_SANITIZER_ATTESTATION =
  "gallery-local-sanitizer-v1";

export type GalleryPreparedPreview = {
  blob: Blob;
  submissionId: string;
  sourceWidth: number;
  sourceHeight: number;
  previewWidth: number;
  previewHeight: number;
  sourceValidatedAt: string;
  sourceDecodeVersion: typeof GALLERY_SOURCE_DECODE_VERSION;
  previewVersion: typeof GALLERY_MODERATOR_PREVIEW_VERSION;
};
