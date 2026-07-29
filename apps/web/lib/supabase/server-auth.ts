import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimPageDecision,
  freshGuildVerificationPasses,
  freshModeratorVerificationPasses,
  moderatorPageDecision,
  verifiedClaimsSubject,
  type ClaimPageDecision,
  type ModeratorPageDecision,
} from "./raffle-access-policy";
import { createServerSupabaseClient } from "./server";

type VerifiedServerIdentity = {
  client: SupabaseClient;
  subject: string;
};

export type RaffleRequestAuthorization =
  | { ok: true; subject: string }
  | { ok: false; status: 401 | 404 };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function functionPayload(value: unknown) {
  const direct = record(value);
  const nested = record(direct.data);
  return Object.keys(nested).length ? nested : direct;
}

export async function getVerifiedServerIdentity(): Promise<VerifiedServerIdentity | null> {
  const client = await createServerSupabaseClient();
  if (!client) return null;
  try {
    const { data, error } = await client.auth.getClaims();
    const subject = error ? null : verifiedClaimsSubject(data?.claims);
    return subject ? { client, subject } : null;
  } catch {
    return null;
  }
}

async function verifyFreshGuildMembership(client: SupabaseClient) {
  try {
    const { data, error } = await client.functions.invoke("verify-discord-member", { body: {} });
    return !error && freshGuildVerificationPasses(functionPayload(data));
  } catch {
    return false;
  }
}

async function verifyFreshModeratorAccess(client: SupabaseClient) {
  try {
    const { data, error } = await client.functions.invoke("list-gallery-review-queue", {
      body: { checkOnly: true },
    });
    return !error && freshModeratorVerificationPasses(data);
  } catch {
    return false;
  }
}

// Pages call these request-scoped functions at render time. Any future Server
// Action or Route Handler must call the matching authorization function again;
// a rendered page decision is never an operation credential.
export async function authorizeRaffleClaimRequest(): Promise<RaffleRequestAuthorization> {
  const identity = await getVerifiedServerIdentity();
  if (!identity) return { ok: false, status: 401 };
  return await verifyFreshGuildMembership(identity.client)
    ? { ok: true, subject: identity.subject }
    : { ok: false, status: 404 };
}

export async function authorizeRaffleModeratorRequest(): Promise<RaffleRequestAuthorization> {
  const identity = await getVerifiedServerIdentity();
  if (!identity) return { ok: false, status: 401 };
  return await verifyFreshModeratorAccess(identity.client)
    ? { ok: true, subject: identity.subject }
    : { ok: false, status: 404 };
}

export async function getRaffleClaimPageDecision(): Promise<ClaimPageDecision> {
  const authorization = await authorizeRaffleClaimRequest();
  return claimPageDecision({
    authenticated: authorization.ok || authorization.status !== 401,
    freshGuildMember: authorization.ok,
  });
}

export async function getRaffleModeratorPageDecision(): Promise<ModeratorPageDecision> {
  const authorization = await authorizeRaffleModeratorRequest();
  return moderatorPageDecision({
    authenticated: authorization.ok || authorization.status !== 401,
    freshModerator: authorization.ok,
  });
}
