import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import { CORS_HEADERS, jsonResponse, requireModeratorAccess } from "../_shared/gallery-moderation.ts";
import { runGalleryModeration } from "../_shared/gallery-moderation-operation.ts";

Deno.serve((req: Request) => withProtectedCors(req, handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  const access = await requireModeratorAccess(req);
  if (!access.ok) return access.response;
  try {
    return await runGalleryModeration(req, access, Deno.env.get("GALLERY_MEDIA_PROCESSOR_SECRET") || "");
  } catch {
    return jsonResponse({ ok: false, error: "moderation_unavailable", message: "Moderation could not complete. Refresh the queue." }, 503);
  }
}
