import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { runSocialAuthorizationDecision } from "@/lib/oauth/authorization-decision-core";
import { approvedSocialOAuthRedirect } from "@/lib/oauth/approved-social-redirect";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { supabaseServerFetch } from "@/lib/supabase/server-fetch";

type DecisionBody = {
  authorization_id?: unknown;
  decision?: unknown;
};

type MemberAccessPayload = {
  ok?: boolean;
  data?: MemberAccessPayload;
  galleryEligible?: boolean;
  discordVerified?: boolean;
  profile?: {
    member_status?: string | null;
    has_required_discord_roles?: boolean | null;
    discord_verified_at?: string | null;
  } | null;
  message?: string | null;
};

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const SOCIAL_OAUTH_CLIENT_ID = (process.env.MOCHIRII_SOCIAL_OAUTH_CLIENT_ID || "").trim();

type OAuthConsentPayload = {
  redirect_url?: unknown;
};

async function loadAuthorizationDetails(authorizationId: string, token: string) {
  const endpoint = new URL(
    `/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}`,
    SUPABASE_URL,
  );
  const response = await supabaseServerFetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) return null;
  return response.json().catch(() => null) as Promise<unknown>;
}

function json(payload: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);

  return NextResponse.json(payload, {
    ...init,
    headers,
  });
}

function bearerToken(request: Request) {
  return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function memberAccessPayload(value: unknown): MemberAccessPayload {
  if (!value || typeof value !== "object") return {};
  const payload = value as MemberAccessPayload;
  return payload.data && typeof payload.data === "object" ? payload.data : payload;
}

function memberAccessIsActive(access: MemberAccessPayload) {
  const profile = access.profile || null;
  return Boolean(
    profile?.member_status === "active" &&
      (access.galleryEligible === true || access.discordVerified === true),
  );
}

async function submitAuthorizationDecision({
  authorizationId,
  decision,
  token,
}: {
  authorizationId: string;
  decision: "approve" | "deny";
  token: string;
}) {
  const endpoint = new URL(
    `/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`,
    SUPABASE_URL,
  );
  try {
    const response = await supabaseServerFetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: decision }),
    });
    const payload = (await response.json().catch(() => ({}))) as OAuthConsentPayload;
    const redirectUrl = approvedSocialOAuthRedirect(payload.redirect_url);

    if (response.ok && redirectUrl) return { ok: true as const, redirectUrl };
    return {
      ok: false as const,
      status: response.status >= 500 ? 502 : 400,
      error: "Authorization decision could not be completed.",
    };
  } catch {
    return {
      ok: false as const,
      status: 502,
      error: "Authorization decision could not be completed.",
    };
  }
}

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SOCIAL_OAUTH_CLIENT_ID) {
    return json({ error: "Guild social authorization is unavailable." }, { status: 503 });
  }

  const token = bearerToken(request);
  if (!token) return json({ error: "Missing signed-in session." }, { status: 401 });

  let body: DecisionBody;
  try {
    body = await request.json() as DecisionBody;
  } catch {
    return json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const authorizationId = String(body.authorization_id || "").trim();
  const decision = String(body.decision || "").trim();
  if (!authorizationId) return json({ error: "Missing authorization_id." }, { status: 400 });
  if (decision !== "approve" && decision !== "deny") {
    return json({ error: "Decision must be approve or deny." }, { status: 400 });
  }

  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: supabaseServerFetch,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const gate = await runSocialAuthorizationDecision({
    authorizationId,
    expectedClientId: SOCIAL_OAUTH_CLIENT_ID,
    decision: decision as "approve" | "deny",
    loadAuthorization: () => loadAuthorizationDetails(authorizationId, token),
    verifyMembership: async () => {
      const accessResult = await client.functions.invoke("verify-member-access", {
        body: { refreshDiscord: true },
      });
      if (accessResult.error) return "unavailable";

      const access = memberAccessPayload(accessResult.data);
      return memberAccessIsActive(access) ? "active" : "inactive";
    },
    submitDecision: () => submitAuthorizationDecision({ authorizationId, decision: decision as "approve" | "deny", token }),
  });

  if (gate.status === "authorization-rejected") {
    return json({ error: "This guild social request could not be verified." }, { status: 403 });
  }
  if (gate.status === "membership-unavailable") {
    return json({ error: "Guild membership could not be verified." }, { status: 503 });
  }
  if (gate.status === "membership-required") {
    return json({ error: "Active guild membership is required before authorizing guild social access." }, { status: 403 });
  }

  const result = gate.submission;
  if (!result.ok) return json({ error: result.error }, { status: result.status });

  return json({ redirectUrl: result.redirectUrl });
}
