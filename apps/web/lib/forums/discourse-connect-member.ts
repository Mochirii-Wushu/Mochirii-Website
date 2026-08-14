import { createClient } from "@supabase/supabase-js";
import { normalizedForumsDisplayName, normalizedForumsEmail } from "./discourse-connect-core.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BEARER_BYTES = 8_192;

export type ForumsMember = Readonly<{
  id: string;
  email: string;
  displayName: string;
}>;

export type ForumsMemberResult =
  | Readonly<{ ok: true; member: ForumsMember }>
  | Readonly<{ ok: false; status: 401 | 403 | 503 }>;

function validBearerToken(token: string) {
  const length = Buffer.byteLength(token, "utf8");
  return length > 0 && length <= MAX_BEARER_BYTES && /^[A-Za-z0-9._~-]+$/.test(token);
}

function envelopeData(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const envelope = value as { ok?: unknown; data?: unknown };
  return envelope.ok === true && envelope.data && typeof envelope.data === "object"
    ? envelope.data as Record<string, unknown>
    : null;
}

export function resolveForumsMember({
  user: userValue,
  accessEnvelope,
  nowMs = Date.now(),
}: {
  user: unknown;
  accessEnvelope: unknown;
  nowMs?: number;
}): ForumsMemberResult {
  if (!userValue || typeof userValue !== "object") return { ok: false, status: 503 };
  const user = userValue as Record<string, unknown>;
  const memberId = String(user.id || "").trim().toLowerCase();
  const email = normalizedForumsEmail(user.email);
  const emailConfirmedAt = String(user.email_confirmed_at || "").trim();
  const confirmationTime = Date.parse(emailConfirmedAt);
  if (!UUID_PATTERN.test(memberId)) return { ok: false, status: 503 };
  if (
    !email
    || !emailConfirmedAt
    || !Number.isFinite(confirmationTime)
    || confirmationTime > nowMs
  ) {
    return { ok: false, status: 403 };
  }

  const access = envelopeData(accessEnvelope);
  const profile = access?.profile && typeof access.profile === "object"
    ? access.profile as Record<string, unknown>
    : null;
  const displayName = normalizedForumsDisplayName(profile?.display_name);
  if (!access || !profile || !displayName) return { ok: false, status: 503 };

  if (
    access.memberStatus !== "active"
    || profile.member_status !== "active"
    || access.discordVerified !== true
    || String(profile.id || "").toLowerCase() !== memberId
  ) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    member: {
      id: memberId,
      email,
      displayName,
    },
  };
}

export async function loadForumsMember({
  token,
  supabaseUrl,
  publishableKey,
}: {
  token: string;
  supabaseUrl: string;
  publishableKey: string;
}): Promise<ForumsMemberResult> {
  if (!supabaseUrl.startsWith("https://") || !publishableKey) return { ok: false, status: 503 };
  if (!validBearerToken(token)) return { ok: false, status: 401 };

  const client = createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  let userResult: Awaited<ReturnType<typeof client.auth.getUser>>;
  try {
    userResult = await client.auth.getUser(token);
  } catch {
    return { ok: false, status: 503 };
  }

  const user = userResult.data.user;
  if (userResult.error || !user) {
    return { ok: false, status: userResult.error?.status === 401 ? 401 : 503 };
  }

  let accessResult: Awaited<ReturnType<typeof client.functions.invoke>>;
  try {
    accessResult = await client.functions.invoke("verify-member-access", {
      body: { refreshDiscord: true },
    });
  } catch {
    return { ok: false, status: 503 };
  }

  if (accessResult.error) {
    const context = typeof accessResult.error === "object" && accessResult.error
      ? (accessResult.error as { context?: unknown }).context
      : null;
    const status = context instanceof Response ? context.status : 0;
    return { ok: false, status: status === 401 ? 401 : status === 403 ? 403 : 503 };
  }
  return resolveForumsMember({ user, accessEnvelope: accessResult.data });
}
