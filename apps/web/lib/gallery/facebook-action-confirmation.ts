type FacebookActionJob = {
  id?: unknown;
  status?: unknown;
  attemptCount?: unknown;
  updatedAt?: unknown;
};

type FacebookReconciliationDraft = {
  resolution: unknown;
  note: unknown;
  facebookPhotoId: unknown;
  facebookPostId: unknown;
  facebookPermalink: unknown;
};

function normalizedText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedAttemptCount(value: unknown): number {
  const attemptCount = Number(value);
  return Number.isSafeInteger(attemptCount) && attemptCount >= 0
    ? attemptCount
    : 0;
}

function jobState(job: FacebookActionJob): [string, string, number, string] {
  return [
    normalizedText(job.id),
    normalizedText(job.status).toLowerCase(),
    normalizedAttemptCount(job.attemptCount),
    normalizedText(job.updatedAt),
  ];
}

export function facebookPagePublishFingerprint(
  job: FacebookActionJob,
  message: unknown,
): string {
  return JSON.stringify([
    "facebook-page-publish-v1",
    ...jobState(job),
    normalizedText(message),
  ]);
}

export function facebookPageReconciliationFingerprint(
  job: FacebookActionJob,
  draft: FacebookReconciliationDraft,
): string {
  return JSON.stringify([
    "facebook-page-reconciliation-v1",
    ...jobState(job),
    normalizedText(draft.resolution),
    normalizedText(draft.note),
    normalizedText(draft.facebookPhotoId),
    normalizedText(draft.facebookPostId),
    normalizedText(draft.facebookPermalink),
  ]);
}
