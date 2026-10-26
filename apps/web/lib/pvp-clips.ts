export type PvpClip = {
  id: string;
  title: string;
  description: string;
  durationSeconds: number;
  width: number;
  height: number;
  poster: string;
  source: string;
  meaningfulSpeech: boolean;
  captions?: { source: string; language: string; label: string };
  transcript?: string;
  export: { container: "mp4"; videoCodec: "h264"; audioCodec: "aac" | "none"; fps: number; bytes: number; sha256: string };
  review: { status: "approved"; id: string; reviewedAt: string; boundaries: true; identityResult: true; frames: true; color: true; audio: true; privacy: true; rights: true; captions: true; backupRestore: true };
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim() && !/[\u0000-\u001f\u007f<>]/u.test(value);
const positive = (value: unknown, maximum: number): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum;

function mediaUrl(value: unknown, id: string, file: string, origins: readonly string[]) {
  if (typeof value !== "string" || value.length > 1024) return false;
  const pathname = `/assets/home/pvp/${id}/${file}`;
  if (value === pathname) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && origins.includes(url.origin) && url.pathname === pathname && url.href === value;
  } catch { return false; }
}

// Source-controlled, publication-cleared metadata only. Never discover private
// media or accept arbitrary remote/signed URLs in this presentation helper.
export function reviewedPvpClip(value: unknown, origins: readonly string[] = []): value is PvpClip {
  if (!record(value) || typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) || value.id.length > 64
    || !text(value.title, 100) || !text(value.description, 400)
    || !positive(value.durationSeconds, 900) || !positive(value.width, 3840) || !positive(value.height, 2160)
    || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || !mediaUrl(value.poster, value.id, "poster.webp", origins) || !mediaUrl(value.source, value.id, "clip-h264.mp4", origins)
    || typeof value.meaningfulSpeech !== "boolean" || !record(value.export) || !record(value.review)) return false;
  const exported = value.export, review = value.review;
  if (exported.container !== "mp4" || exported.videoCodec !== "h264" || !["aac", "none"].includes(String(exported.audioCodec))
    || !positive(exported.fps, 60) || !positive(exported.bytes, 250 * 1024 * 1024) || !Number.isInteger(exported.bytes)
    || typeof exported.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(exported.sha256)
    || review.status !== "approved" || !text(review.id, 100) || !text(review.reviewedAt, 24)
    || !Number.isFinite(Date.parse(review.reviewedAt)) || new Date(review.reviewedAt).toISOString() !== review.reviewedAt
    || ["boundaries", "identityResult", "frames", "color", "audio", "privacy", "rights", "captions", "backupRestore"].some(key => review[key] !== true)) return false;
  if (value.captions !== undefined && (!record(value.captions)
    || !mediaUrl(value.captions.source, value.id, "captions.vtt", origins)
    || !text(value.captions.label, 60) || typeof value.captions.language !== "string" || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.captions.language))) return false;
  if (value.transcript !== undefined && !text(value.transcript, 12000)) return false;
  return !value.meaningfulSpeech || value.captions !== undefined && text(value.transcript, 12000);
}

export function selectPvpClips(values: readonly unknown[], origins: readonly string[] = [], random: () => number = Math.random): PvpClip[] {
  const ids = new Set<string>(), sources = new Set<string>();
  const clips = values.slice(0, 103).filter((value): value is PvpClip => {
    if (!reviewedPvpClip(value, origins) || ids.has(value.id) || sources.has(value.source)) return false;
    ids.add(value.id); sources.add(value.source); return true;
  });
  for (let i = clips.length - 1; i > 0; i--) {
    const sample = random();
    const j = Number.isFinite(sample) && sample >= 0 && sample < 1 ? Math.floor(sample * (i + 1)) : 0;
    [clips[i], clips[j]] = [clips[j], clips[i]];
  }
  return clips.slice(0, 4);
}

export function pvpDuration(seconds: number) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
