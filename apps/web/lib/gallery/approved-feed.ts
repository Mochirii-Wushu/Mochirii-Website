import { SUPABASE_PROJECT_REF } from "@/lib/public-urls";

export type ApprovedGallerySubmission = {
  id?: string | null;
  title?: string | null;
  caption?: string | null;
  category?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  created_at?: string | null;
  reviewed_at?: string | null;
  uploader_display_name?: string | null;
  uploader_discord_name?: string | null;
  full_signed_url?: string | null;
  thumbnail_signed_url?: string | null;
  thumbnail_size_bytes?: number | null;
  preview_error?: string | null;
};

export type ApprovedGalleryFeed = {
  submissions: ApprovedGallerySubmission[];
  count?: number;
  signedUrlSeconds?: number;
};

type PublicGalleryFeedResult = {
  ok: boolean;
  status: number;
  statusText: string;
  data: ApprovedGalleryFeed | null;
  message: string | null;
};

const unavailableMessage = "Approved gallery feed could not be loaded.";

function publicApprovedGalleryFeedUrl() {
  const configuredUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const baseUrl = configuredUrl || `https://${SUPABASE_PROJECT_REF}.supabase.co`;
  return `${baseUrl}/functions/v1/list-approved-gallery-submissions`;
}

function asFeed(value: unknown): ApprovedGalleryFeed | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ApprovedGalleryFeed>;
  if (!Array.isArray(candidate.submissions)) return null;
  return candidate as ApprovedGalleryFeed;
}

export async function listApprovedGallerySubmissions(signal?: AbortSignal): Promise<PublicGalleryFeedResult> {
  try {
    const response = await fetch(publicApprovedGalleryFeedUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
      signal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const data = asFeed(payload?.data || payload);
    const message = typeof payload?.message === "string" ? payload.message : null;
    const payloadFailed = payload?.ok === false;

    if (!response.ok || payloadFailed || !data) {
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        data,
        message: unavailableMessage,
      };
    }

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      data,
      message,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;

    return {
      ok: false,
      status: 0,
      statusText: "",
      data: null,
      message: unavailableMessage,
    };
  }
}
