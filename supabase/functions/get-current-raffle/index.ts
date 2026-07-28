import "@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  protectedOptionsResponse,
  withProtectedCors,
} from "../_shared/cors.ts";
import {
  parseRaffleLeaderboard,
  RAFFLE_LEADERBOARD_HMAC_ENV,
  type RaffleLeaderboard,
  type SocialLeaderboardVerification,
  verifySocialLeaderboardRequest,
} from "../_shared/raffle-leaderboard.ts";
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
const LEADERBOARD_CACHE_CONTROL = "private, no-store, max-age=0";
const LEADERBOARD_SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
} as const;

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
  loadLeaderboard?: (
    client: SupabaseClient,
    viewerId: string,
  ) => Promise<RaffleLeaderboard | null>;
  verifySocialRequest?: (
    headers: Headers,
    body: unknown,
    client: SupabaseClient,
  ) => Promise<SocialLeaderboardVerification>;
  now?: () => number;
  hmacSecret?: string;
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
      handlePost(req, dependencies).then(withLeaderboardHeaders),
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

async function handlePost(
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

  const record = asRecord(body);
  if (
    Object.keys(record).length === 1 &&
    Object.prototype.hasOwnProperty.call(record, "sub")
  ) {
    return handleSocialLeaderboardPost(req, record, dependencies);
  }
  return handleWebsiteMemberPost(req, record, dependencies);
}

async function handleWebsiteMemberPost(
  req: Request,
  body: Record<string, unknown>,
  dependencies: CurrentRaffleDependencies,
): Promise<Response> {
  const action = body.action;
  if (
    Object.keys(body).length !== 1 ||
    !["member_results", "member_leaderboard"].includes(String(action))
  ) {
    return jsonResponse(
      { ok: false, message: "Request is not supported." },
      400,
    );
  }

  const access = await (dependencies.requireMember || requireRaffleMember)(req);
  if (!access.ok) {
    return action === "member_leaderboard"
      ? withLeaderboardHeaders(access.response)
      : access.response;
  }

  if (action === "member_leaderboard") {
    if (
      !raffleMemberProfileIsVerified(
        access.profile,
        (dependencies.now || Date.now)(),
      )
    ) {
      return leaderboardJsonResponse(
        { ok: false, message: "Member access could not be verified." },
        403,
      );
    }
    try {
      const leaderboard = await (dependencies.loadLeaderboard ||
        loadRaffleLeaderboard)(access.adminClient, access.userId);
      return leaderboardJsonResponse({
        ok: true,
        data: leaderboard
          ? {
            ...leaderboard,
            asOf: new Date((dependencies.now || Date.now)()).toISOString(),
          }
          : null,
      });
    } catch {
      return leaderboardJsonResponse(
        { ok: false, message: "Member access could not be verified." },
        403,
      );
    }
  }

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

async function handleSocialLeaderboardPost(
  req: Request,
  body: Record<string, unknown>,
  dependencies: CurrentRaffleDependencies,
): Promise<Response> {
  const adminClient = (dependencies.createAdminClient ||
    createRaffleAdminClient)();
  if (!adminClient) {
    return leaderboardJsonResponse(
      { ok: false, message: "Raffle information is not configured yet." },
      503,
    );
  }

  let verification: SocialLeaderboardVerification;
  try {
    verification = await (dependencies.verifySocialRequest ||
      ((headers, value, client) =>
        verifySocialLeaderboardRequest(headers, value, {
          secret: dependencies.hmacSecret ??
            Deno.env.get(RAFFLE_LEADERBOARD_HMAC_ENV) ?? "",
          nowMs: (dependencies.now || Date.now)(),
          consumeNonce: async (subject, nonce, expiresAt) => {
            const { data, error } = await client.rpc(
              "consume_raffle_leaderboard_nonce",
              {
                p_subject_id: subject,
                p_nonce: nonce,
                p_expires_at: expiresAt,
              },
            );
            return !error && data === true;
          },
        })))(req.headers, body, adminClient);
  } catch {
    return leaderboardJsonResponse(
      { ok: false, message: "Raffle information is unavailable." },
      503,
    );
  }

  if (!verification.ok) {
    return leaderboardJsonResponse(
      { ok: false, message: "Raffle information is unavailable." },
      verification.status,
    );
  }

  try {
    const leaderboard = await (dependencies.loadLeaderboard ||
      loadRaffleLeaderboard)(adminClient, verification.subject);
    if (!leaderboard) {
      return leaderboardJsonResponse({
        cycleLabel: "No active drawing",
        asOf: new Date((dependencies.now || Date.now)()).toISOString(),
        entries: [],
      });
    }
    return leaderboardJsonResponse({
      cycleLabel: cycleLabel(leaderboard.drawAt),
      asOf: new Date((dependencies.now || Date.now)()).toISOString(),
      entries: leaderboard.entries.map((entry) => ({
        rank: entry.rank,
        displayName: entry.displayName,
        entryCount: entry.entryCount,
      })),
    });
  } catch {
    return leaderboardJsonResponse(
      { ok: false, message: "Raffle information is unavailable." },
      403,
    );
  }
}

function leaderboardJsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": LEADERBOARD_CACHE_CONTROL,
      Vary: "Authorization",
      ...LEADERBOARD_SECURITY_HEADERS,
    },
  });
}

function withLeaderboardHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", LEADERBOARD_CACHE_CONTROL);
  for (const [name, value] of Object.entries(LEADERBOARD_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  const vary = new Map<string, string>();
  for (const value of (headers.get("Vary") || "").split(",")) {
    const token = value.trim();
    if (token) vary.set(token.toLowerCase(), token);
  }
  vary.set("authorization", "Authorization");
  headers.set("Vary", [...vary.values()].join(", "));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cycleLabel(drawAt: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(new Date(drawAt));
}

export async function loadRaffleLeaderboard(
  adminClient: SupabaseClient,
  viewerId: string,
): Promise<RaffleLeaderboard | null> {
  const { data, error } = await adminClient.rpc(
    "get_current_raffle_leaderboard",
    { p_viewer_id: viewerId },
  );
  if (error) throw error;
  if (data === null) return null;
  const parsed = parseRaffleLeaderboard(data);
  if (!parsed) throw new Error("invalid_raffle_leaderboard");
  return parsed;
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
          message: "The Mōchirīī Monthly Raffle is not open.",
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
