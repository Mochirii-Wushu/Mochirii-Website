import type { Upload, UploadOptions } from "tus-js-client";

export type GalleryUploadProgress = { uploaded: number; total: number };
const resumable = new WeakMap<File, { endpoint: string; objectName: string; url: string }>();

export function galleryUploadEndpoint(supabaseUrl: string) {
  const target = new URL(supabaseUrl);
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(target.hostname);
  if (!match || target.protocol !== "https:" || target.username || target.password || target.port
    || target.pathname !== "/" || target.search || target.hash) throw new Error("The upload target could not be verified.");
  return `https://${match[1]}.storage.supabase.co/storage/v1/upload/resumable`;
}

export async function uploadGalleryOriginal(
  file: File,
  options: {
    endpoint: string;
    objectName: string;
    mimeType: string;
    token: () => Promise<string>;
    signal?: AbortSignal;
    onProgress?: (progress: GalleryUploadProgress) => void;
    createUpload?: (file: File, options: UploadOptions) => Pick<Upload, "start" | "abort"> & { url?: string | null };
  },
) {
  options.signal?.throwIfAborted();
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== "/storage/v1/upload/resumable") throw new Error("The upload target could not be verified.");
  const factory = options.createUpload || await import("tus-js-client").then(
    ({ Upload }) => (file: File, settings: UploadOptions) => new Upload(file, settings),
  );
  if (!factory) throw new Error("The upload is temporarily unavailable.");
  options.signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let expired = false;
    const deadline = setTimeout(() => { expired = true; cancel(); }, 10 * 60 * 1000);
    const state: { upload?: Pick<Upload, "start" | "abort"> & { url?: string | null } } = {};
    const cancel = () => {
      // Never delete a possibly completed immutable original on uncertain cancellation.
      void Promise.resolve().then(() => state.upload?.abort(false)).catch(() => {}).finally(
        () => finish(expired ? new Error("The upload took too long. Retry to continue.")
          : new DOMException("Upload cancelled.", "AbortError")),
      );
    };
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve();
    };
    try {
      const previous = resumable.get(file);
      state.upload = factory(file, {
        endpoint: options.endpoint,
        uploadUrl: previous?.endpoint === options.endpoint && previous.objectName === options.objectName ? previous.url : null,
        chunkSize: 6 * 1024 * 1024,
        uploadDataDuringCreation: true,
        storeFingerprintForResuming: false,
        removeFingerprintOnSuccess: true,
        retryDelays: [0, 1000, 3000, 5000],
        headers: { "x-upsert": "false" },
        metadata: { bucketName: "member-gallery", objectName: options.objectName,
          contentType: options.mimeType, cacheControl: "3600" },
        onBeforeRequest: async (request) => {
          options.signal?.throwIfAborted();
          const target = new URL(request.getURL());
          if (target.href.length > 4096 || target.origin !== endpoint.origin || target.username || target.password || target.search || target.hash
            || (target.pathname !== endpoint.pathname && !target.pathname.startsWith(endpoint.pathname + "/"))) {
            throw new Error("The upload target could not be verified.");
          }
          const token = await options.token();
          if (!token) throw new Error("Sign in again before retrying the upload.");
          request.setHeader("authorization", `Bearer ${token}`);
        },
        onProgress: (uploaded, total) => {
          if (!finished) options.onProgress?.({ uploaded, total });
        },
        onError: () => finish(new Error("The upload did not finish. Retry to continue or choose another image.")),
        onUploadUrlAvailable: () => {
          if (state.upload?.url) resumable.set(file, { endpoint: options.endpoint, objectName: options.objectName, url: state.upload.url });
        },
        onSuccess: () => { resumable.delete(file); finish(); },
      });
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel(); else if (!finished) state.upload.start();
    } catch {
      finish(new Error("The upload could not start. Retry to continue."));
    }
  });
}
