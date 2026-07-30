import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  CORS_HEADERS,
  jsonResponse,
  requireModeratorAccess,
} from "../_shared/gallery-moderation.ts";

// Keep the deployed route as a compatibility stub, but expose no mutation
// path. A moderator cannot safely attest a manual share without receiving the
// exact private social derivative, and that derivative remains browser-denied.
Deno.serve((req: Request) => withProtectedCors(req, handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const access = await requireModeratorAccess(req);
  if (!access.ok) return access.response;

  return jsonResponse({
    ok: false,
    error: "instagram_manual_share_disabled",
    message:
      "Manual Instagram sharing is disabled. Use reviewed Graph publishing after activation; reconciliation remains available only for ambiguous API attempts.",
  }, 409);
}
