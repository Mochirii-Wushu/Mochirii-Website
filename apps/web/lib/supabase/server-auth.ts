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
import type { RaffleViewerResultNames } from "../raffle/public-view";
import { loadRaffleViewerResultNames } from "./raffle-viewer-adapter";
import {
  parseRaffleClaimStatus,
  type RaffleClaimStatus,
} from "./raffle-claim-status";

type VerifiedServerIdentity = {
  client: SupabaseClient;
  subject: string;
};

type RaffleRequestAuthorization =
  | { ok: true; subject: string }
  | { ok: false; status: 401 | 404 };

type RaffleClaimPageState = {
  decision: ClaimPageDecision;
  status: RaffleClaimStatus | null;
};

export type RaffleClaimMutation =
  | { action: "claim"; claimId: string; rewardChoice: "digital_choice" | "in_game" }
  | { action: "decline"; claimId: string };

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
    const { data, error } = await client.functions.invoke("verify-discord-member", {
      body: {},
    });
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

export async function getRaffleClaimPageDecision(): Promise<ClaimPageDecision> {
  return (await getRaffleClaimPageState()).decision;
}

export async function getRaffleClaimPageState(): Promise<RaffleClaimPageState> {
  const authorization = await getRaffleClaimIdentityAuthorization();
  if (!authorization.ok && authorization.status === 401) {
    return {
      decision: claimPageDecision({
        authenticated: false,
        freshGuildMember: false,
      }),
      status: null,
    };
  }
  if (!authorization.ok) {
    return {
      decision: claimPageDecision({
        authenticated: true,
        freshGuildMember: false,
      }),
      status: null,
    };
  }

  const status = await loadRaffleClaimStatus(authorization.identity.client);
  return {
    decision: claimPageDecision({
      authenticated: true,
      freshGuildMember: true,
      claimAvailable: Boolean(
        status?.claimsEnabled && status.claimState === "claimable",
      ),
    }),
    status,
  };
}

export async function getRaffleModeratorPageDecision(): Promise<ModeratorPageDecision> {
  const authorization = await authorizeRaffleModeratorRequest();
  if (!authorization.ok && authorization.status === 401) {
    return moderatorPageDecision({ authenticated: false, freshModerator: false });
  }
  return moderatorPageDecision({
    authenticated: true,
    freshModerator: authorization.ok,
  });
}

export async function getRaffleViewerResultNames(): Promise<
  RaffleViewerResultNames | undefined
> {
  return loadRaffleViewerResultNames({
    createClient: createServerSupabaseClient,
  });
}

// Route handlers and Server Actions must call these functions again instead of
// trusting a page decision, client state, or the proxy refresh.
export async function authorizeRaffleClaimRequest(): Promise<RaffleRequestAuthorization> {
  const authorization = await getRaffleClaimIdentityAuthorization();
  return authorization.ok
    ? { ok: true, subject: authorization.identity.subject }
    : authorization;
}

async function getRaffleClaimIdentityAuthorization(): Promise<
  | { ok: true; identity: VerifiedServerIdentity }
  | { ok: false; status: 401 | 404 }
> {
  const identity = await getVerifiedServerIdentity();
  if (!identity) return { ok: false, status: 401 };
  return await verifyFreshGuildMembership(identity.client)
    ? { ok: true, identity }
    : { ok: false, status: 404 };
}

async function loadRaffleClaimStatus(
  client: SupabaseClient,
): Promise<RaffleClaimStatus | null> {
  try {
    const { data, error } = await client.functions.invoke(
      "manage-raffle-claim",
      { body: { action: "status" } },
    );
    if (error) return null;
    return parseRaffleClaimStatus(functionPayload(data));
  } catch {
    return null;
  }
}

export async function performRaffleClaimMutation(
  mutation: RaffleClaimMutation,
): Promise<boolean> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(mutation.claimId)
  ) return false;
  const authorization = await getRaffleClaimIdentityAuthorization();
  if (!authorization.ok) return false;
  const status = await loadRaffleClaimStatus(authorization.identity.client);
  if (
    !status?.claimsEnabled || status.claimState !== "claimable" ||
    status.selectedClaimId !== mutation.claimId ||
    (mutation.action === "claim" && mutation.rewardChoice === "in_game" &&
      !status.inGameRewardAvailable)
  ) return false;
  const body = mutation.action === "claim"
    ? {
      action: "claim",
      claim_id: mutation.claimId,
      reward_choice: mutation.rewardChoice,
    }
    : {
      action: "decline",
      claim_id: mutation.claimId,
      reward_choice: null,
    };
  try {
    const { data, error } = await authorization.identity.client.functions
      .invoke("manage-raffle-claim", { body });
    return !error && record(data).ok === true;
  } catch {
    return false;
  }
}

export async function authorizeRaffleModeratorRequest(): Promise<RaffleRequestAuthorization> {
  const identity = await getVerifiedServerIdentity();
  if (!identity) return { ok: false, status: 401 };

  const freshModerator = await verifyFreshModeratorAccess(identity.client);
  return freshModerator
    ? { ok: true, subject: identity.subject }
    : { ok: false, status: 404 };
}
