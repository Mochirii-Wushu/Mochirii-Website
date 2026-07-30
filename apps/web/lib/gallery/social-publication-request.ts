import {
  socialPublicationConfirmationFingerprint,
  type SocialPublicationDestination,
} from "./social-publication-confirmation.ts";

type PublicationJobState = {
  id?: unknown;
  status?: unknown;
  attemptCount?: unknown;
  updatedAt?: unknown;
};

type PublicationRequestInput = {
  job: PublicationJobState;
  moderatorUserId: string;
  primaryCopy: string;
  altText?: string;
};

export type InstagramPublicationRequest = {
  job_id: string;
  caption: string;
  alt_text: string;
  expected_updated_at: string;
  confirmation_fingerprint: string;
  confirm_instagram_publish: true;
};

export type FacebookPagePublicationRequest = {
  job_id: string;
  message: string;
  expected_updated_at: string;
  confirmation_fingerprint: string;
  confirm_facebook_publish: true;
};

function clean(value: unknown, maximumLength: number): string {
  return String(value ?? "").trim().slice(0, maximumLength);
}

async function confirmation(
  destination: SocialPublicationDestination,
  input: PublicationRequestInput,
) {
  const jobId = clean(input.job.id, 80).toLowerCase();
  const status = clean(input.job.status, 40).toLowerCase();
  const updatedAt = clean(input.job.updatedAt, 80);
  const moderatorUserId = clean(input.moderatorUserId, 80).toLowerCase();
  const attemptCount = Number(input.job.attemptCount);
  const primaryCopy = clean(
    input.primaryCopy,
    destination === "instagram" ? 2200 : 5000,
  );
  const altText = destination === "instagram" ? clean(input.altText, 1000) : "";
  const result = await socialPublicationConfirmationFingerprint({
    destination,
    jobId,
    status,
    attemptCount,
    updatedAt,
    moderatorUserId,
    primaryCopy,
    altText,
  });
  return { jobId, updatedAt, primaryCopy, altText, ...result };
}

export async function buildInstagramPublicationRequest(
  input: PublicationRequestInput,
): Promise<InstagramPublicationRequest> {
  const confirmed = await confirmation("instagram", input);
  if (!confirmed.primaryCopy) {
    throw new TypeError("A final Instagram caption is required.");
  }
  if (!confirmed.altText) {
    throw new TypeError("Moderator-reviewed Instagram alt text is required.");
  }
  return {
    job_id: confirmed.jobId,
    caption: confirmed.primaryCopy,
    alt_text: confirmed.altText,
    expected_updated_at: confirmed.updatedAt,
    confirmation_fingerprint: confirmed.fingerprint,
    confirm_instagram_publish: true,
  };
}

export async function buildFacebookPagePublicationRequest(
  input: PublicationRequestInput,
): Promise<FacebookPagePublicationRequest> {
  const confirmed = await confirmation("facebook_page", input);
  if (!confirmed.primaryCopy) {
    throw new TypeError("A final Facebook Page caption is required.");
  }
  return {
    job_id: confirmed.jobId,
    message: confirmed.primaryCopy,
    expected_updated_at: confirmed.updatedAt,
    confirmation_fingerprint: confirmed.fingerprint,
    confirm_facebook_publish: true,
  };
}
