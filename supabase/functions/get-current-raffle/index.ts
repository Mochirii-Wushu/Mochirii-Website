import "@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  protectedOptionsResponse,
  withProtectedCors,
} from "../_shared/cors.ts";
import {
  asRecord,
  createRaffleAdminClient,
  jsonResponse,
  loadCurrentCycle,
  loadMostRecentResultsCycle,
  type MemberAccess,
  memberResultNames,
  PUBLIC_CORS_HEADERS,
  publicCycleDto,
  publicDrawEvidence,
  raffleMemberProfileIsVerified,
  readJson,
  requireRaffleMember,
} from "../_shared/raffle-edge.ts";

const MEMBER_CORS_OPTIONS = { allowedMethods: "POST, OPTIONS" } as const;

export type CurrentRaffleDependencies = {
  createAdminClient?: () => SupabaseClient | null;
  requireMember?: (req: Request) => Promise<MemberAccess>;
  loadCurrent?: (
    client: SupabaseClient,
  ) => Promise<Record<string, unknown> | null>;
  loadResults?: (
    client: SupabaseClient,
  ) => Promise<Record<string, unknown> | null>;
  loadEvidence?: (
    client: SupabaseClient,
    cycleId: string,
  ) => Promise<Record<string, unknown> | null>;
  loadMemberNames?: (
    client: SupabaseClient,
    cycleId: string,
  ) => Promise<Record<string, string>>;
  now?: () => number;
};

export async function handleCurrentRaffleRequest(
  req: Request,
  dependencies: CurrentRaffleDependencies = {},
): Promise<Response> {
  if (req.method === "OPTIONS") {
    const requestedMethod =
      (req.headers.get("access-control-request-method") || "")
        .trim().toUpperCase();
    return requestedMethod === "POST"
      ? protectedOptionsResponse(req, MEMBER_CORS_OPTIONS)
      : new Response("ok", { headers: PUBLIC_CORS_HEADERS });
  }

  if (req.method === "POST") {
    return withProtectedCors(
      req,
      handleMemberPost(req, dependencies),
      MEMBER_CORS_OPTIONS,
    );
  }

  if (req.method !== "GET") {
    return jsonResponse(
      { ok: false, message: "Method not allowed." },
      405,
      true,
    );
  }

  return handlePublicGet(dependencies);
}

async function handleMemberPost(
  req: Request,
  dependencies: CurrentRaffleDependencies,
): Promise<Response> {
  let body;
  try {
    body = await readJson(req, 4_096);
  } catch {
    return jsonResponse(
      { ok: false, message: "Request could not be read." },
      400,
    );
  }
  if (asRecord(body).action !== "member_results") {
    return jsonResponse(
      { ok: false, message: "Request is not supported." },
      400,
    );
  }

  const access = await (dependencies.requireMember || requireRaffleMember)(req);
  if (!access.ok) return access.response;
  if (
    !raffleMemberProfileIsVerified(
      access.profile,
      (dependencies.now || Date.now)(),
    )
  ) {
    return jsonResponse(
      { ok: false, message: "Member access could not be verified." },
      403,
    );
  }

  try {
    const resultsCycle = await (dependencies.loadResults ||
      loadMostRecentResultsCycle)(access.adminClient);
    const names = resultsCycle
      ? await (dependencies.loadMemberNames || memberResultNames)(
        access.adminClient,
        String(resultsCycle.id),
      )
      : {};
    return jsonResponse(
      { ok: true, data: { resultNames: names } },
      200,
    );
  } catch {
    console.error("member raffle result lookup failed", { failed: true });
    return jsonResponse(
      { ok: false, message: "Raffle results could not be loaded." },
      500,
    );
  }
}

async function handlePublicGet(
  dependencies: CurrentRaffleDependencies,
): Promise<Response> {
  const adminClient = (dependencies.createAdminClient ||
    createRaffleAdminClient)();
  if (!adminClient) {
    return jsonResponse(
      { ok: false, message: "Raffle information is not configured yet." },
      500,
      true,
    );
  }

  try {
    const [cycle, resultsCycle] = await Promise.all([
      (dependencies.loadCurrent || loadCurrentCycle)(adminClient),
      (dependencies.loadResults || loadMostRecentResultsCycle)(adminClient),
    ]);
    if (!cycle) {
      return jsonResponse(
        {
          ok: true,
          data: null,
          status: "not_open",
          message: "The Mochirii Monthly Raffle is not open.",
        },
        200,
        true,
      );
    }

    const evidence = resultsCycle
      ? await (dependencies.loadEvidence || publicDrawEvidence)(
        adminClient,
        String(resultsCycle.id),
      )
      : null;
    return jsonResponse(
      {
        ok: true,
        data: {
          ...publicCycleDto(cycle),
          drawEvidence: evidence,
        },
      },
      200,
      true,
    );
  } catch {
    console.error("current raffle lookup failed", { failed: true });
    return jsonResponse(
      { ok: false, message: "Raffle information could not be loaded." },
      500,
      true,
    );
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleCurrentRaffleRequest(req));
}
