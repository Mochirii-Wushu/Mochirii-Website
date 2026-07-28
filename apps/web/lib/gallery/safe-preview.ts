export type GalleryPreviewLease = {
  blob: Blob;
  objectUrl: string;
  release: () => void;
};

type GalleryPreviewObjectUrlApi = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

export type GalleryPreviewRequest = {
  ready: Promise<GalleryPreviewLease | null>;
  dispose: () => void;
};

export function startGalleryPreviewRequest(
  loadSource: (signal: AbortSignal) => Promise<Blob>,
  objectUrlApi: GalleryPreviewObjectUrlApi = URL,
): GalleryPreviewRequest {
  const controller = new AbortController();
  let disposed = false;
  let activeLease: GalleryPreviewLease | null = null;

  const ready = loadSource(controller.signal).then((blob) => {
    if (disposed) return null;

    const objectUrl = objectUrlApi.createObjectURL(blob);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      objectUrlApi.revokeObjectURL(objectUrl);
    };
    const lease = { blob, objectUrl, release };
    activeLease = lease;

    if (disposed) {
      release();
      return null;
    }
    return lease;
  });

  return {
    ready,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      activeLease?.release();
      activeLease = null;
    },
  };
}
