import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { getServiceRoleKey } from "./supabase-service-role.ts";
import { verifyAuthenticatedUser } from "./verified-auth.ts";

export type JsonRecord = Record<string, unknown>;

export type AuthenticatedRewardMember = {
  adminClient: SupabaseClient;
  user: User;
  memberId: string;
};

export type RewardMemberDependencies = {
  createAdminClient?: () => SupabaseClient | null;
};

export type RewardEdgeConfiguration = {
  relayUrl: string;
  relayHmacSecret: string;
};

export function rewardJson(
  body: JsonRecord,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

export function createRewardAdminClient(): SupabaseClient | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getRewardEdgeConfiguration(): RewardEdgeConfiguration | null {
  const relayUrl = Deno.env.get("REWARD_RELAY_URL") || "";
  const relayHmacSecret = Deno.env.get("REWARD_RELAY_HMAC_SECRET") || "";
  if (!relayUrl || relayHmacSecret.length < 32) return null;
  return { relayUrl, relayHmacSecret };
}

export async function requireAuthenticatedRewardMember(
  req: Request,
  dependencies: RewardMemberDependencies = {},
): Promise<
  | { ok: true; access: AuthenticatedRewardMember }
  | { ok: false; response: Response }
> {
  const token = (req.headers.get("Authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  ).trim();
  if (!token) {
    return {
      ok: false,
      response: rewardJson(
        { ok: false, error: "authentication_required" },
        401,
      ),
    };
  }
  const adminClient = (dependencies.createAdminClient ||
    createRewardAdminClient)();
  if (!adminClient) {
    return {
      ok: false,
      response: rewardJson({ ok: false, error: "service_unavailable" }, 503),
    };
  }
  const identity = await verifyAuthenticatedUser(adminClient.auth, token);
  if (!identity) {
    return {
      ok: false,
      response: rewardJson({ ok: false, error: "invalid_session" }, 401),
    };
  }
  return {
    ok: true,
    access: {
      adminClient,
      user: identity.user,
      memberId: identity.userId,
    },
  };
}

export async function readBoundedJson(
  req: Request,
  maximumBytes = 8_192,
): Promise<
  | { ok: true; value: JsonRecord }
  | { ok: false; response: Response }
> {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    return {
      ok: false,
      response: rewardJson({ ok: false, error: "request_too_large" }, 413),
    };
  }
  const bytes = await readBoundedRequestBytes(req, maximumBytes);
  if (!bytes) {
    return {
      ok: false,
      response: rewardJson({ ok: false, error: "request_too_large" }, 413),
    };
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("object required");
    }
    return { ok: true, value: value as JsonRecord };
  } catch {
    return {
      ok: false,
      response: rewardJson({ ok: false, error: "invalid_request" }, 400),
    };
  }
}

export async function readBoundedRequestBytes(
  req: Request,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    return null;
  }
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function exactObjectKeys(
  value: JsonRecord,
  expected: string[],
): boolean {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length &&
    actual.every((key, index) => key === allowed[index]);
}
