import type { Session, User } from "@supabase/supabase-js";

export type JsonRecord = Record<string, unknown>;

export type ResultError = {
  message: string;
  details?: unknown;
  hint?: string | null;
  code?: string | null;
};

export type SupabaseResult<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  data: T | null;
  error: ResultError | null;
  message: string | null;
  count?: string | null;
};

export type AuthUserResult = {
  user: User;
};

export type AuthSessionResult = {
  session: Session | null;
};

export type MemberStatus = "pending" | "active" | "suspended" | "archived";

export type MemberProfile = {
  id: string;
  discord_user_id?: string | null;
  discord_username?: string | null;
  discord_global_name?: string | null;
  discord_avatar_url?: string | null;
  discord_roles?: string[] | null;
  has_required_discord_roles?: boolean | null;
  discord_member_pending?: boolean | null;
  discord_verified_at?: string | null;
  discord_checked_at?: string | null;
  display_name?: string | null;
  game_uid?: string | null;
  discord_handle?: string | null;
  region?: string | null;
  timezone?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  profile_slug?: string | null;
  profile_public_enabled?: boolean | null;
  profile_published_at?: string | null;
  approved_avatar_media_id?: string | null;
  approved_banner_media_id?: string | null;
  member_status?: MemberStatus | string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SocialAccountStatus = "pending_sso" | "active" | "revoked" | "suspended" | "archived";

export type SocialAccount = {
  id: string;
  user_id?: string | null;
  member_profile_id?: string | null;
  provider?: "pixelfed" | string | null;
  provider_subject?: string | null;
  provider_user_id?: string | null;
  username?: string | null;
  profile_url?: string | null;
  status?: SocialAccountStatus | string | null;
  profile_link_visible?: boolean | null;
  federation_enabled?: boolean | null;
  last_login_at?: string | null;
  last_synced_at?: string | null;
  revoked_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MemberSocialLink = {
  id: string;
  user_id: string;
  provider: "instagram" | "facebook" | "tiktok" | "twitch" | "youtube" | "x" | "bluesky" | "mastodon" | "spotify" | "linkedin" | "custom" | string;
  display_label: string;
  profile_url: string;
  sort_order: number;
  is_visible: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export type EditableProfilePayload = {
  display_name?: string | null;
  game_uid?: string | null;
  region?: string | null;
  timezone?: string | null;
  bio?: string | null;
};

export type GallerySubmission = {
  id: string;
  user_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  original_filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  title?: string | null;
  caption?: string | null;
  category?: string | null;
  status?: string | null;
  rejection_reason?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  submission_source?: string | null;
  discord_guild_id?: string | null;
  discord_channel_id?: string | null;
  discord_message_id?: string | null;
  discord_attachment_id?: string | null;
  discord_user_id?: string | null;
  instagram_opt_in?: boolean | null;
  instagram_opt_in_at?: string | null;
  instagram_opt_in_source?: string | null;
  instagram_opt_in_copy_version?: string | null;
  instagram_opt_in_contract_version?: string | null;
  instagram_consent_version?: string | null;
  facebook_page_opt_in?: boolean | null;
  facebook_page_opt_in_at?: string | null;
  facebook_page_opt_in_source?: string | null;
  facebook_page_opt_in_copy_version?: string | null;
  facebook_page_opt_in_contract_version?: string | null;
  facebook_page_consent_version?: string | null;
  upload_rights_confirmed?: boolean | null;
  social_withdrawals?: GallerySocialWithdrawalStatus[];
};

export type GallerySubmissionMetadata = {
  title?: string | null;
  caption?: string | null;
  category?: string | null;
  instagramOptIn?: boolean | null;
  facebookPageOptIn?: boolean | null;
  uploadRightsConfirmed?: boolean | null;
};

export type GallerySocialDestination = "instagram" | "facebook_page";

export type GallerySocialWithdrawalStatus = {
  submission_id: string;
  destination: GallerySocialDestination;
  state: "withdrawn_before_queue" | "canceled" | "quarantined" | "removal_requested" | string;
  external_removal_required: boolean;
  requested_at?: string | null;
  updated_at?: string | null;
};

export type GallerySocialWithdrawalResponse = {
  destination?: GallerySocialDestination | string | null;
  action?: string | null;
  status?: string | null;
  requiresModeratorInspection?: boolean | null;
  removalRequestCreated?: boolean | null;
};

export type VerificationResponse = {
  verified?: boolean;
  hasGuildMembership?: boolean;
  hasRequiredRoles?: boolean;
  pending?: boolean;
  missingRoleIds?: string[];
  memberStatus?: string;
  message?: string;
};

export type MemberAccessIdentity = {
  provider?: string | null;
  providerSubject?: string | null;
  displayLabel?: string | null;
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
  active?: boolean | null;
  lastObservedAt?: string | null;
};

export type MemberAccessVerification = {
  status?: string | null;
  method?: string | null;
  verifiedAt?: string | null;
  expiresAt?: string | null;
  reviewedAt?: string | null;
  reason?: string | null;
};

export type MemberAccessResponse = {
  galleryEligible?: boolean;
  method?: "discord" | "manual_review" | string | null;
  memberStatus?: string | null;
  discordVerified?: boolean;
  manualApproved?: boolean;
  identities?: MemberAccessIdentity[];
  verification?: MemberAccessVerification | null;
  profile?: MemberProfile | null;
  message?: string;
  next?: string;
};

export type MemberVerificationReviewResponse = {
  verification?: MemberAccessVerification | null;
  userId?: string | null;
};

export type ModerationStatus = "pending" | "approved" | "rejected" | "archived";

export type GalleryModerationEvent = {
  id?: string | null;
  action?: string | null;
  reason?: string | null;
  createdAt?: string | null;
  moderator?: {
    displayName?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
    discordUserId?: string | null;
  } | null;
};

export type GalleryReviewSubmission = {
  id?: string | null;
  status?: string | null;
  source?: string | null;
  uploader?: {
    displayName?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
  } | null;
  reviewer?: JsonRecord | null;
  title?: string | null;
  caption?: string | null;
  category?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
  reviewedAt?: string | null;
  updatedAt?: string | null;
  rejectionReason?: string | null;
  thumbnailMimeType?: string | null;
  thumbnailSizeBytes?: number | null;
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
  publicationReady?: boolean | null;
  sourceValidationState?: "required" | "validated" | string | null;
  previewError?: string | null;
  instagramOptIn?: boolean | null;
  facebookPageOptIn?: boolean | null;
  moderationEvents?: GalleryModerationEvent[];
};

export type GalleryReviewQueue = {
  submissions: GalleryReviewSubmission[];
  count?: number;
  status?: string;
  thumbnailState?: string;
  summary?: Record<string, number | string | undefined>;
  pagination?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
    hasPrevious?: boolean;
    hasNext?: boolean;
  };
};

export type RejectedGalleryCleanupResponse = {
  submissionId?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  removedObjectCount?: number | null;
  deletedAt?: string | null;
};

export type InstagramPublishJobStatus =
  | "queued"
  | "ineligible"
  | "publishing"
  | "published"
  | "failed"
  | "reconcile_required"
  | "canceled"
  | "shared_manually";

export type InstagramReconciliationResolution =
  | "confirmed_published"
  | "confirmed_not_published";

export type InstagramReconciliationResult = {
  jobId?: string | null;
  status?: InstagramPublishJobStatus | string | null;
  instagramMediaId?: string | null;
  instagramPermalink?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
};

export type InstagramPublishEvent = {
  id?: string | null;
  action?: string | null;
  createdAt?: string | null;
  actor?: {
    displayName?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
  } | null;
};

export type InstagramPublishJob = {
  id?: string | null;
  status?: InstagramPublishJobStatus | string | null;
  eligibilityReason?: string | null;
  caption?: string | null;
  altText?: string | null;
  instagramMediaId?: string | null;
  instagramPermalink?: string | null;
  attemptCount?: number | null;
  attemptStartedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  galleryPublicationId?: string | null;
  thumbnailUrl?: string | null;
  previewError?: string | null;
  submission?: GalleryReviewSubmission | null;
  events?: InstagramPublishEvent[];
};

export type InstagramPublishQueue = {
  jobs: InstagramPublishJob[];
  items?: InstagramPublishJob[];
  count?: number;
  status?: string;
  pageSize?: number;
  nextCursor?: string | null;
  summary?: Record<string, number | string | undefined>;
};

export type MetaProviderDiagnostic = {
  configured?: boolean | null;
  publishEnabled?: boolean | null;
  provider?: string | null;
  apiVersion?: string | null;
  tokenDebuggerCalled?: boolean | null;
  tokenDebuggerTransportApproved?: boolean | null;
  tokenBindingVerified?: boolean | null;
  tokenTypeVerified?: boolean | null;
  scopesVerified?: boolean | null;
  expiryVerified?: boolean | null;
  dataAccessExpiryVerified?: boolean | null;
  tokenExpiryWindow?: string | null;
  dataAccessExpiryWindow?: string | null;
  identityReachable?: boolean | null;
  identityMatches?: boolean | null;
  ready?: boolean | null;
  errorCategory?: string | null;
  providerErrorCategory?: string | null;
  checkedAt?: string | null;
  message?: string | null;
};

export type InstagramApiStatus = MetaProviderDiagnostic & {
  facebookPageReachable?: boolean | null;
  facebookPageIdentityMatches?: boolean | null;
  instagramBusinessAccountPresent?: boolean | null;
  instagramBusinessAccountMatches?: boolean | null;
  pageToInstagramLinkageVerified?: boolean | null;
  quotaReadable?: boolean | null;
  quotaExhausted?: boolean | null;
  businessAccountSubtypeVerification?: string | null;
};

export type FacebookPagePublishJobStatus =
  | "queued"
  | "ineligible"
  | "publishing"
  | "published"
  | "failed"
  | "reconcile_required"
  | "canceled";

export type FacebookPageReconciliationResolution =
  | "confirmed_published"
  | "confirmed_not_published";

export type FacebookPageReconciliationResult = {
  jobId?: string | null;
  status?: FacebookPagePublishJobStatus | string | null;
  facebookPhotoId?: string | null;
  facebookPostId?: string | null;
  facebookPermalink?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
};

export type FacebookPagePublishEvent = InstagramPublishEvent;

export type FacebookPagePublishSubmission = {
  id?: string | null;
  status?: string | null;
  source?: string | null;
  uploader?: {
    displayName?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
  } | null;
  title?: string | null;
  caption?: string | null;
  category?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
  reviewedAt?: string | null;
  facebookPageOptIn?: boolean | null;
  facebookPageOptInAt?: string | null;
  facebookPageOptInSource?: string | null;
  facebookPageOptInCopyVersion?: string | null;
  facebookPageOptInContractVersion?: string | null;
};

export type FacebookPagePublishJob = {
  id?: string | null;
  status?: FacebookPagePublishJobStatus | string | null;
  eligibilityReason?: string | null;
  message?: string | null;
  facebookPhotoId?: string | null;
  facebookPostId?: string | null;
  facebookPermalink?: string | null;
  attemptCount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  galleryPublicationId?: string | null;
  thumbnailUrl?: string | null;
  previewError?: string | null;
  submission?: FacebookPagePublishSubmission | null;
  events?: FacebookPagePublishEvent[];
};

export type FacebookPagePublishQueue = {
  jobs: FacebookPagePublishJob[];
  count?: number;
  status?: string;
  pageSize?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
  summary?: Record<string, number | string | undefined>;
};

export type FacebookPageApiStatus = MetaProviderDiagnostic & {
  createContentTaskVerified?: boolean | null;
};

export type ModerateGallerySubmissionResponse = {
  submission?: JsonRecord | null;
  action?: string | null;
  reviewedAt?: string | null;
  instagramJob?: {
    id?: string | null;
    status?: InstagramPublishJobStatus | string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
  facebookPageJob?: {
    id?: string | null;
    status?: FacebookPagePublishJobStatus | string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
  warnings?: string[];
};

export type PublicMemberProfile = {
  id?: string | null;
  slug?: string | null;
  displayName?: string | null;
  gameUid?: string | null;
  discordHandle?: string | null;
  region?: string | null;
  timezone?: string | null;
  bio?: string | null;
  guildTitle?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  profilePublishedAt?: string | null;
  socialProvider?: string | null;
  socialUsername?: string | null;
  socialProfileUrl?: string | null;
  updatedAt?: string | null;
};

export type PublicMemberProfileList = {
  profiles: PublicMemberProfile[];
  count?: number;
  signedUrlSeconds?: number;
};

export type PublicMemberProfileResponse = {
  profile: PublicMemberProfile | null;
  signedUrlSeconds?: number;
};

export type CurrentSpotlightWinner = {
  winnerName?: string | null;
  monthKey?: string | null;
  publishedAt?: string | null;
  source?: string | null;
};

export type ProfileMediaKind = "avatar" | "banner";
export type ProfileMediaStatus = "pending" | "approved" | "rejected" | "archived";

export type MemberProfileMedia = {
  id?: string | null;
  user_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  original_filename?: string | null;
  media_kind?: ProfileMediaKind | string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  status?: ProfileMediaStatus | string | null;
  rejection_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProfileMediaQueueItem = {
  id?: string | null;
  status?: ProfileMediaStatus | string | null;
  kind?: ProfileMediaKind | string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  originalFilename?: string | null;
  createdAt?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  storagePath?: string | null;
  signedPreviewUrl?: string | null;
  uploader?: {
    displayName?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
    profileSlug?: string | null;
  } | null;
};

export type ProfileMediaQueue = {
  media: ProfileMediaQueueItem[];
  count?: number;
  status?: string;
  summary?: Record<string, number | string | undefined>;
  signedUrlSeconds?: number;
};

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function text(value: unknown, fallback = "") {
  const clean = String(value ?? "").trim();
  return clean || fallback;
}

export function createError(value: unknown, fallback = "Supabase request could not be completed."): ResultError {
  if (value instanceof Error) return { message: value.message || fallback, details: value };
  const record = asRecord(value);
  const message =
    text(record.message) ||
    text(record.error_description) ||
    text(record.error) ||
    (typeof value === "string" ? text(value) : "") ||
    fallback;

  return {
    message,
    details: Object.keys(record).length ? record : value,
    hint: text(record.hint) || null,
    code: text(record.code) || null,
  };
}

export function createResult<T>({
  ok,
  status = 0,
  statusText = "",
  data = null,
  error = null,
  count = null,
  message,
}: {
  ok: boolean;
  status?: number;
  statusText?: string;
  data?: T | null;
  error?: ResultError | null;
  count?: string | null;
  message?: string | null;
}): SupabaseResult<T> {
  return {
    ok,
    status,
    statusText,
    data,
    error,
    count,
    message: message ?? error?.message ?? null,
  };
}

export function okResult<T>(data: T, message: string | null = null): SupabaseResult<T> {
  return createResult({
    ok: true,
    status: 200,
    statusText: "OK",
    data,
    error: null,
    message,
  });
}

export function failedResult<T = null>(error: unknown, data: T | null = null): SupabaseResult<T> {
  const normalized = createError(error);
  return createResult({
    ok: false,
    status: 0,
    statusText: "Client Error",
    data,
    error: normalized,
    message: normalized.message,
  });
}
