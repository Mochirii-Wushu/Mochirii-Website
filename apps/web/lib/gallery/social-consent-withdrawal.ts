export type GallerySocialDestination = "instagram" | "facebook_page";

export type GallerySocialWithdrawalStatus = {
  submission_id: string;
  destination: GallerySocialDestination;
  state: "withdrawn_before_queue" | "canceled" | "quarantined" | "removal_requested" | string;
  external_removal_required: boolean;
  requested_at?: string | null;
  updated_at?: string | null;
};

export type GallerySocialWithdrawalRequest = {
  submission_id: string;
  destination: GallerySocialDestination;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildGallerySocialWithdrawalRequest(
  submissionId: unknown,
  destination: GallerySocialDestination,
): GallerySocialWithdrawalRequest {
  const id = String(submissionId ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) {
    throw new TypeError("Choose a valid Gallery submission before withdrawing consent.");
  }
  return { submission_id: id, destination };
}

export function gallerySocialWithdrawalLabel(
  status: GallerySocialWithdrawalStatus | null | undefined,
): string {
  if (!status) return "Consent active";
  if (status.state === "removal_requested" || status.external_removal_required) {
    return "Removal requested; external copies may remain";
  }
  if (status.state === "quarantined") return "Withdrawn; moderator inspection required";
  return "Consent withdrawn";
}
