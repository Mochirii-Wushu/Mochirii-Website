"use client";

import { useEffect, useState } from "react";
import {
  startGalleryPreviewRequest,
  type GalleryPreviewLease,
} from "@/lib/gallery/safe-preview";
import { normalizeInstagramPostPermalink } from "@/lib/gallery/instagram-action-confirmation";
import { SUPABASE_URL } from "@/lib/supabase/config";
import {
  text,
  type GalleryReviewQueue,
  type GalleryReviewSubmission,
  type InstagramApiStatus,
  type InstagramPublishJob,
  type MemberAccessVerification,
  type ModerationStatus,
} from "@/lib/supabase/types";
import { formatBytes, formatDate } from "./format";

export const statuses: Array<{ id: ModerationStatus; label: string; empty: string }> = [
  { id: "pending", label: "Pending", empty: "No pending gallery submissions." },
  { id: "approved", label: "Approved", empty: "No approved gallery submissions." },
  { id: "rejected", label: "Rejected", empty: "No rejected gallery submissions." },
  { id: "archived", label: "Archived", empty: "No archived gallery submissions." },
];

export const instagramStatuses: Array<{ id: string; label: string; empty: string }> = [
  { id: "queued", label: "Queued", empty: "No Instagram-ready images." },
  { id: "ineligible", label: "Ineligible", empty: "No ineligible Instagram jobs." },
  { id: "failed", label: "Failed", empty: "No failed Instagram jobs." },
  { id: "reconcile_required", label: "Needs reconciliation", empty: "No Instagram jobs need reconciliation." },
  { id: "published", label: "Published", empty: "No published Instagram posts." },
  { id: "shared_manually", label: "Shared manually", empty: "No manually shared Instagram jobs." },
  { id: "all", label: "All", empty: "No Instagram publishing jobs." },
];

export const memberVerificationMethods = [
  { id: "manual_review", label: "Manual Review" },
  { id: "phone", label: "Phone" },
  { id: "apple", label: "Apple" },
  { id: "facebook", label: "Facebook" },
  { id: "google", label: "Google" },
  { id: "kakao", label: "Kakao" },
  { id: "twitch", label: "Twitch" },
  { id: "spotify", label: "Spotify" },
];

export type InstagramAction =
  | "publish"
  | "reconcile-published"
  | "reconcile-not-published";
export type InstagramJobMessage = {
  kind: "status" | "error" | "success";
  message: string;
};

export function normalizeStatus(value: unknown): ModerationStatus {
  const status = text(value, "pending").toLowerCase();
  return statuses.some((entry) => entry.id === status) ? (status as ModerationStatus) : "pending";
}

export function statusConfig(status: ModerationStatus) {
  return statuses.find((entry) => entry.id === status) || statuses[0];
}

export function instagramStatusConfig(status: string) {
  return instagramStatuses.find((entry) => entry.id === status) || instagramStatuses[0];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function approvedInstagramThumbnailUrl(job: InstagramPublishJob) {
  const publicationId = text(job.galleryPublicationId);
  const thumbnailUrl = text(job.thumbnailUrl);
  if (!SUPABASE_URL || !UUID_RE.test(publicationId) || !thumbnailUrl) return "";
  const expectedUrl = `${SUPABASE_URL}/functions/v1/list-approved-gallery-submissions?asset=thumbnail&id=${encodeURIComponent(publicationId)}`;
  return thumbnailUrl === expectedUrl ? thumbnailUrl : "";
}

function uploaderName(item: GalleryReviewSubmission) {
  const uploader = item.uploader || {};
  return uploader.discordGlobalName || uploader.displayName || uploader.discordUsername || "Mōchirīī Member";
}

function discordDetail(item: GalleryReviewSubmission) {
  const uploader = item.uploader || {};
  if (uploader.discordGlobalName && uploader.discordUsername) return `${uploader.discordGlobalName} · ${uploader.discordUsername}`;
  return uploader.discordUsername || uploader.discordUserId || "Discord identity on file";
}

function instagramConsentLabel(item: GalleryReviewSubmission) {
  return item.instagramOptIn
    ? "Official Instagram account publication"
    : "No Instagram publication opt-in";
}

function facebookPageConsentLabel(item: GalleryReviewSubmission) {
  return item.facebookPageOptIn
    ? "Public official Facebook Page; optional moderator share to the private guild group"
    : "No Facebook Page publication opt-in";
}

function moderatorName(event: NonNullable<GalleryReviewSubmission["moderationEvents"]>[number]) {
  const moderator = event.moderator || {};
  return moderator.discordGlobalName || moderator.displayName || moderator.discordUsername || "Moderator";
}

function memberVerificationMethodLabel(value: unknown) {
  const method = text(value, "manual_review").toLowerCase();
  return memberVerificationMethods.find((entry) => entry.id === method)?.label || "Manual Review";
}

export function QueueSummary({ queue, shown }: { queue: GalleryReviewQueue | null; shown: number }) {
  const summary = queue?.summary || {};
  const cards = [
    ["Pending", summary.pending],
    ["Approved", summary.approved],
    ["Needs thumbnail", summary.missingThumbnails],
    ["Rejected", summary.rejected],
    ["Archived", summary.archived],
    ["Shown", shown],
  ];

  return (
    <div className="moderation-summary" id="queueSummary" aria-label="Gallery moderation summary">
      {cards.map(([label, value]) => (
        <div className="moderation-summary__card" key={label}>
          <span>{label}</span>
          <strong>{Number(value || 0)}</strong>
        </div>
      ))}
    </div>
  );
}

type ValidatedGalleryPreviewState =
  | { status: "loading"; objectUrl: ""; blob: null }
  | ({ status: "decoding" | "ready" } & GalleryPreviewLease)
  | { status: "error"; objectUrl: ""; blob: null };

function ValidatedGalleryPreview({
  submissionId,
  title,
  previewKey,
  previewBlob,
  previewWidth,
  previewHeight,
  onBlobChange,
  onError,
}: {
  submissionId: string;
  title: string;
  previewKey: string;
  previewBlob: Blob;
  previewWidth: number;
  previewHeight: number;
  onBlobChange: (submissionId: string, previewKey: string, blob: Blob | null) => void;
  onError: (submissionId: string, previewKey: string) => void;
}) {
  const [preview, setPreview] = useState<ValidatedGalleryPreviewState>({
    status: "loading",
    objectUrl: "",
    blob: null,
  });

  useEffect(() => {
    let mounted = true;
    onBlobChange(submissionId, previewKey, null);

    const request = startGalleryPreviewRequest(async () => previewBlob);
    void request.ready.then((lease) => {
      if (!mounted || !lease) return;
      setPreview({ status: "decoding", ...lease });
    }).catch((error) => {
      if (!mounted || error instanceof DOMException && error.name === "AbortError") return;
      setPreview({ status: "error", objectUrl: "", blob: null });
      onError(submissionId, previewKey);
    });

    return () => {
      mounted = false;
      request.dispose();
      onBlobChange(submissionId, previewKey, null);
    };
  }, [
    onBlobChange,
    onError,
    previewBlob,
    previewKey,
    submissionId,
  ]);

  function confirmDecodedImage(image: HTMLImageElement) {
    if (preview.status !== "decoding") return;
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    if (naturalWidth !== previewWidth || naturalHeight !== previewHeight) {
      preview.release();
      setPreview({ status: "error", objectUrl: "", blob: null });
      onBlobChange(submissionId, previewKey, null);
      onError(submissionId, previewKey);
      return;
    }
    setPreview({ ...preview, status: "ready" });
    onBlobChange(submissionId, previewKey, preview.blob);
  }

  function rejectDecodedImage() {
    if (preview.status === "decoding" || preview.status === "ready") {
      preview.release();
    }
    setPreview({ status: "error", objectUrl: "", blob: null });
    onBlobChange(submissionId, previewKey, null);
    onError(submissionId, previewKey);
  }

  return (
    <div
      className="review-preview__validated"
      aria-busy={preview.status === "loading" || preview.status === "decoding"}
    >
      {preview.status === "loading" ? (
        <div className="review-preview__empty" role="status">
          <span>Loading prepared preview</span>
        </div>
      ) : null}
      {preview.status === "decoding" || preview.status === "ready" ? (
        <img
          src={preview.objectUrl}
          alt={`${title} preview`}
          width={previewWidth}
          height={previewHeight}
          decoding="async"
          onLoad={(event) => confirmDecodedImage(event.currentTarget)}
          onError={rejectDecodedImage}
        />
      ) : null}
      {preview.status === "error" ? (
        <div className="review-preview__empty" role="alert">
          <span>Prepared preview unavailable</span>
        </div>
      ) : null}
    </div>
  );
}

export function SubmissionCard({
  item,
  activeStatus,
  busy,
  reason,
  cleanupArmed,
  previewKey,
  previewBlob,
  previewSourceWidth,
  previewSourceHeight,
  previewWidth,
  previewHeight,
  previewReady,
  onReasonChange,
  onModerate,
  onPreparePreview,
  onPreviewBlobChange,
  onPreviewError,
  onArmCleanup,
  onCancelCleanup,
  onDeleteRejected,
}: {
  item: GalleryReviewSubmission;
  activeStatus: ModerationStatus;
  busy: boolean;
  reason: string;
  cleanupArmed: boolean;
  previewKey: string;
  previewBlob: Blob | null;
  previewSourceWidth: number;
  previewSourceHeight: number;
  previewWidth: number;
  previewHeight: number;
  previewReady: boolean;
  onReasonChange: (value: string) => void;
  onModerate: (item: GalleryReviewSubmission, action: "approved" | "rejected" | "thumbnail") => void;
  onPreparePreview: (item: GalleryReviewSubmission) => void;
  onPreviewBlobChange: (submissionId: string, previewKey: string, blob: Blob | null) => void;
  onPreviewError: (submissionId: string, previewKey: string) => void;
  onArmCleanup: (item: GalleryReviewSubmission) => void;
  onCancelCleanup: (item: GalleryReviewSubmission) => void;
  onDeleteRejected: (item: GalleryReviewSubmission) => void;
}) {
  const status = normalizeStatus(item.status || activeStatus);
  const title = text(item.title || item.originalFilename, "Untitled image");
  const events = Array.isArray(item.moderationEvents) ? item.moderationEvents : [];
  const sourceLabel = text(item.source, "website").toLowerCase() === "discord" ? "Discord" : "Website";
  const sourceValidated = item.sourceValidationState === "validated" || Boolean(previewKey);

  return (
    <article className={`review-item review-item--${status}`} data-submission-id={item.id || ""}>
      <div className="review-preview">
        {previewKey && previewBlob ? (
          <ValidatedGalleryPreview
            key={previewKey}
            submissionId={text(item.id)}
            title={title}
            previewKey={previewKey}
            previewBlob={previewBlob}
            previewWidth={previewWidth}
            previewHeight={previewHeight}
            onBlobChange={onPreviewBlobChange}
            onError={onPreviewError}
          />
        ) : (
          <div className="review-preview__empty">
            <span>Preview unavailable</span>
          </div>
        )}
      </div>
      <div className="review-details">
        <div className="review-details__head">
          <div>
            <h3>{title}</h3>
            <p className="muted">{uploaderName(item)} · {discordDetail(item)}</p>
          </div>
          <span className={`submission-status submission-status--${status}`}>{status}</span>
        </div>
        {item.caption ? <p>{item.caption}</p> : null}
        {status === "rejected" && item.rejectionReason ? <p className="review-decision">Reason: {item.rejectionReason}</p> : null}
        <dl className="review-meta">
          {[
            ["Status", item.status || activeStatus],
            ["Source", sourceLabel],
            ["Category", item.category || "Uncategorized"],
            ["Type", item.mimeType || "Unknown"],
            ["Size", formatBytes(item.sizeBytes)],
            ["Source validation", sourceValidated && (previewSourceWidth || item.sourceWidth) && (previewSourceHeight || item.sourceHeight)
              ? `${previewSourceWidth || item.sourceWidth} × ${previewSourceHeight || item.sourceHeight}`
              : "Review required"],
            ["Prepared preview", previewKey && previewWidth && previewHeight
              ? `${previewWidth} × ${previewHeight}`
              : "Not prepared"],
            ["Gallery thumbnail", item.thumbnailSizeBytes ? formatBytes(item.thumbnailSizeBytes) : "Not prepared"],
            ["Submitted", formatDate(item.createdAt, "Not set")],
            ["Reviewed", item.reviewedAt ? formatDate(item.reviewedAt, "Not reviewed") : "Not reviewed"],
            ["Instagram", instagramConsentLabel(item)],
            ["Facebook Page", facebookPageConsentLabel(item)],
            ["Facebook consent handshake", item.facebookPageOptInContractVersion || "Not current"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <details className="review-storage">
          <summary>Storage reference</summary>
          <code>{item.storagePath || "Not available"}</code>
          {item.discord?.messageId ? <code>Discord message: {item.discord.messageId}</code> : null}
        </details>
        <section className="review-history" aria-label="Moderation history">
          <h4>Moderation History</h4>
          {events.length ? (
            <ol>
              {events.map((event) => (
                <li key={event.id || `${event.action}-${event.createdAt}`}>
                  <div>
                    <strong>{event.action || "reviewed"}</strong>
                    <span>{formatDate(event.createdAt, "Not set")}</span>
                  </div>
                  <p className="muted">{moderatorName(event)}{event.reason ? ` · ${event.reason}` : ""}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No moderation history recorded yet.</p>
          )}
        </section>
        {(status === "pending" || status === "approved") && !previewKey ? (
          <section className="review-history" aria-label="Private source preview preparation">
            <h4>Private Preview</h4>
            <p className="review-action-note">
              Validate this one private image before it is loaded in the moderation browser.
            </p>
            <div className="auth-actions">
              <button className="hero-cta" type="button" onClick={() => onPreparePreview(item)} disabled={busy}>
                Prepare private preview
              </button>
            </div>
          </section>
        ) : null}
        {status === "pending" && (item.instagramOptIn || item.facebookPageOptIn) ? (
          <section className="review-history" aria-label="Social publication eligibility">
            <h4>Social publication eligibility</h4>
            <p className="review-action-note">
              The server queues a private derivative only when the consented source is a metadata-strippable JPEG already within 320–1440 pixels wide and the 4:5 through 1.91:1 feed ratio. It may retain one strict minimal first JFIF APP0 segment and strips comments. PNG, WebP, out-of-ratio, arbitrary APP0 or JFXX, duplicate JFIF, or any APP1–APP15 metadata (including EXIF, ICC, SPIFF, HDR, Photoshop, and Adobe transforms) can still be approved for the Gallery but remain explicitly ineligible for social publishing.
            </p>
            <p className="muted">The safe source preview above is for composition review. Gallery approval queues only; the separate destination queue shows the exact caption and requires explicit public-post confirmation.</p>
          </section>
        ) : null}
        {status === "pending" ? (
          <>
            <label className="form-field review-reason">
              <span>Decline reason</span>
              <textarea
                data-reason
                maxLength={500}
                rows={3}
                placeholder="Required when declining."
                value={reason}
                onChange={(event) => onReasonChange(event.target.value)}
                disabled={busy}
              />
            </label>
            {item.facebookPageOptIn ? (
              <p className="review-action-note" role="status">
                Facebook consent covers this image plus a later moderator-approved caption on the public official Facebook Page, with an optional moderator share of that Page post into the private official guild group. This Gallery action only queues the separate Page review.
              </p>
            ) : null}
            <div className="auth-actions">
              <button className="hero-cta hero-cta--primary" type="button" onClick={() => onModerate(item, "approved")} disabled={busy || !previewReady}>
                {item.facebookPageOptIn || item.instagramOptIn
                  ? "Approve for Gallery only"
                  : "Approve for Gallery"}
              </button>
              <button className="hero-cta" type="button" onClick={() => onModerate(item, "rejected")} disabled={busy}>Decline</button>
            </div>
          </>
        ) : null}
        {status === "approved" ? (
          <section className="review-history" aria-label="Gallery thumbnail preparation">
            <h4>Gallery Thumbnail</h4>
            <p className="review-action-note">
              {item.thumbnailStoragePath
                ? "Prepare a new immutable thumbnail revision when the current gallery image needs repair."
                : "Prepare the bounded gallery image before this submission can appear in the public album."}
            </p>
            <div className="auth-actions">
              <button className="hero-cta" type="button" onClick={() => onModerate(item, "thumbnail")} disabled={busy || !previewReady}>
                {item.thumbnailStoragePath ? "Refresh gallery thumbnail" : "Prepare gallery thumbnail"}
              </button>
            </div>
          </section>
        ) : null}
        {status === "rejected" ? (
          <section className="review-history" aria-label="Rejected submission cleanup">
            <h4>Rejected Cleanup</h4>
            <p className="review-action-note" role={cleanupArmed ? "status" : undefined}>
              {cleanupArmed
                ? "Confirm permanent cleanup only for smoke-test artifacts or owner-approved rejected items."
                : "Cleanup permanently removes this rejected item from the moderation queue and Storage."}
            </p>
            <div className="auth-actions">
              <button
                className="hero-cta"
                type="button"
                onClick={() => cleanupArmed ? onDeleteRejected(item) : onArmCleanup(item)}
                disabled={busy}
              >
                {cleanupArmed ? "Delete rejected item" : "Prepare cleanup"}
              </button>
              {cleanupArmed ? (
                <button className="hero-cta" type="button" onClick={() => onCancelCleanup(item)} disabled={busy}>
                  Cancel
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}

export function InstagramJobCard({
  job,
  busy,
  caption,
  altText,
  mediaIdValue,
  permalinkValue,
  moderatorNote,
  confirmation,
  jobMessage,
  metaPublishAvailable,
  onCaptionChange,
  onAltTextChange,
  onMediaIdChange,
  onPermalinkChange,
  onModeratorNoteChange,
  onCopyCaption,
  onCopyAltText,
  onArmPublish,
  onConfirmPublish,
  onArmReconciliation,
  onConfirmReconciliation,
  onCancelAction,
}: {
  job: InstagramPublishJob;
  busy: boolean;
  caption: string;
  altText: string;
  mediaIdValue: string;
  permalinkValue: string;
  moderatorNote: string;
  confirmation?: InstagramAction;
  jobMessage?: InstagramJobMessage;
  metaPublishAvailable: boolean;
  onCaptionChange: (value: string) => void;
  onAltTextChange: (value: string) => void;
  onMediaIdChange: (value: string) => void;
  onPermalinkChange: (value: string) => void;
  onModeratorNoteChange: (value: string) => void;
  onCopyCaption: () => void;
  onCopyAltText: () => void;
  onArmPublish: (job: InstagramPublishJob) => void;
  onConfirmPublish: (job: InstagramPublishJob) => void;
  onArmReconciliation: (job: InstagramPublishJob, resolution: "confirmed_published" | "confirmed_not_published") => void;
  onConfirmReconciliation: (job: InstagramPublishJob, resolution: "confirmed_published" | "confirmed_not_published") => void;
  onCancelAction: (job: InstagramPublishJob) => void;
}) {
  const submission = job.submission || {};
  const title = text(submission.title || submission.originalFilename, "Untitled image");
  const sourceLabel = text(submission.source, "website").toLowerCase() === "discord" ? "Discord" : "Website";
  const status = text(job.status, "queued").toLowerCase();
  const thumbnailUrl = approvedInstagramThumbnailUrl(job);
  const canEditPublishText = status === "queued" || status === "failed";
  const canPublish = canEditPublishText && metaPublishAvailable;
  const permalink = text(job.instagramPermalink);
  const publishArmed = confirmation === "publish";
  const reconcilable = status === "reconcile_required";
  const reconcilePublishedArmed = confirmation === "reconcile-published";
  const reconcileNotPublishedArmed = confirmation === "reconcile-not-published";

  return (
    <article className={`review-item review-item--${status}`} data-instagram-job-id={job.id || ""}>
      <div className="review-preview">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={`${title} approved Gallery preview`} loading="lazy" decoding="async" />
        ) : (
          <div className="review-preview__empty">
            <span>Preview unavailable</span>
          </div>
        )}
      </div>
      <div className="review-details">
        <div className="review-details__head">
          <div>
            <h3>{title}</h3>
            <p className="muted">{submission.uploader?.displayName || "Mōchirīī Member"} - {sourceLabel}</p>
          </div>
          <span className={`submission-status submission-status--${status}`}>{status}</span>
        </div>
        {job.eligibilityReason ? <p className="review-decision">Eligibility: {job.eligibilityReason}</p> : null}
        {job.lastError ? <p className="review-decision">Last error: {job.lastError}</p> : null}
        {jobMessage ? (
          <p className={`review-action-message review-action-message--${jobMessage.kind}`} role={jobMessage.kind === "error" ? "alert" : "status"}>
            {jobMessage.message}
          </p>
        ) : null}
        {permalink ? (
          <p>
            <a href={permalink} target="_blank" rel="noopener noreferrer">Open Instagram post</a>
          </p>
        ) : null}
        <dl className="review-meta">
          {[
            ["Consent", submission.instagramOptIn ? "Instagram opt-in" : "No opt-in"],
            ["Consent source", submission.instagramOptInSource || "Not set"],
            ["Consent version", submission.instagramOptInCopyVersion || "Not set"],
            ["Consent handshake", submission.instagramOptInContractVersion || "Not set"],
            ["Type", submission.mimeType || "Unknown"],
            ["Size", formatBytes(submission.sizeBytes)],
            ["Attempts", String(job.attemptCount || 0)],
            ["Queued", formatDate(job.createdAt, "Not set")],
            ["Completed", job.publishedAt ? formatDate(job.publishedAt, "Not completed") : "Not completed"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <label className="form-field">
          <span>Instagram caption</span>
          <textarea
            maxLength={2200}
            rows={4}
            value={caption}
            disabled={busy || !canEditPublishText}
            onChange={(event) => onCaptionChange(event.target.value.slice(0, 2200))}
          />
        </label>
        <label className="form-field">
          <span>Instagram alt text</span>
          <textarea
            maxLength={1000}
            rows={3}
            value={altText}
            disabled={busy || !canEditPublishText}
            onChange={(event) => onAltTextChange(event.target.value.slice(0, 1000))}
          />
        </label>
        {reconcilable ? (
          <label className="form-field">
            <span>Instagram media ID when publication is confirmed</span>
            <input
              inputMode="numeric"
              maxLength={255}
              value={mediaIdValue}
              disabled={busy}
              onChange={(event) => onMediaIdChange(event.target.value.replace(/\D/g, "").slice(0, 255))}
              placeholder="Numeric media ID"
            />
          </label>
        ) : null}
        {reconcilable ? (
          <>
            <label className="form-field">
              <span>Official Instagram permalink</span>
              <input
                type="url"
                maxLength={1000}
                value={permalinkValue}
                disabled={busy}
                onChange={(event) => onPermalinkChange(event.target.value.slice(0, 1000))}
                placeholder="https://www.instagram.com/p/..."
              />
            </label>
            <label className="form-field">
              <span>Required reconciliation note</span>
              <textarea
                maxLength={500}
                rows={2}
                value={moderatorNote}
                disabled={busy}
                onChange={(event) => onModeratorNoteChange(event.target.value.slice(0, 500))}
                placeholder="Record what you inspected on the official account."
              />
            </label>
          </>
        ) : null}
        {status === "queued" && !metaPublishAvailable ? (
          <p className="review-action-note">
            Manual Instagram sharing is disabled. This job remains queued until reviewed Graph publishing is activated.
          </p>
        ) : null}
        {publishArmed ? (
          <p className="review-action-note" role="status">
            Confirm only with action-time approval to publish this image through the Meta API.
          </p>
        ) : null}
        {reconcilePublishedArmed || reconcileNotPublishedArmed ? (
          <p className="review-action-note" role="status">
            Confirm this result only after inspecting the public official Mōchirīī Instagram account. This does not publish a new post.
          </p>
        ) : null}
        <div className="auth-actions">
          {thumbnailUrl ? (
            <a className="hero-cta" href={thumbnailUrl} target="_blank" rel="noopener noreferrer">Open approved Gallery preview</a>
          ) : (
            <button className="hero-cta" type="button" disabled>Preview unavailable</button>
          )}
          <button className="hero-cta" type="button" disabled={busy || !caption.trim()} onClick={onCopyCaption}>Copy caption</button>
          <button className="hero-cta" type="button" disabled={busy || !altText.trim()} onClick={onCopyAltText}>Copy alt text</button>
          {reconcilable ? (
            <>
              <button
                className="hero-cta hero-cta--primary"
                type="button"
                disabled={
                  busy ||
                  !moderatorNote.trim() ||
                  !/^\d{5,255}$/.test(mediaIdValue.trim()) ||
                  !normalizeInstagramPostPermalink(permalinkValue)
                }
                onClick={() => reconcilePublishedArmed
                  ? onConfirmReconciliation(job, "confirmed_published")
                  : onArmReconciliation(job, "confirmed_published")}
              >
                {reconcilePublishedArmed ? "Confirm recorded publication" : "Record as published"}
              </button>
              <button
                className="hero-cta"
                type="button"
                disabled={busy || !moderatorNote.trim()}
                onClick={() => reconcileNotPublishedArmed
                  ? onConfirmReconciliation(job, "confirmed_not_published")
                  : onArmReconciliation(job, "confirmed_not_published")}
              >
                {reconcileNotPublishedArmed ? "Confirm no post exists" : "Record as not published"}
              </button>
            </>
          ) : null}
          {confirmation ? (
            <button className="hero-cta" type="button" disabled={busy} onClick={() => onCancelAction(job)}>
              Cancel
            </button>
          ) : null}
          <button
            className="hero-cta"
            type="button"
            disabled={busy || !canPublish}
            onClick={() => publishArmed ? onConfirmPublish(job) : onArmPublish(job)}
          >
            {publishArmed ? "Confirm Meta publish" : metaPublishAvailable ? "Publish with Meta API" : "Meta API unavailable"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function MemberVerificationResult({
  userId,
  verification,
}: {
  userId?: string | null;
  verification?: MemberAccessVerification | null;
}) {
  if (!verification) return null;

  const status = text(verification.status, "pending").toLowerCase();
  const rows = [
    ["User", userId || "Not set"],
    ["Status", status],
    ["Method", memberVerificationMethodLabel(verification.method)],
    ["Reviewed", verification.reviewedAt ? formatDate(verification.reviewedAt, "Not set") : "Not set"],
    ["Verified", verification.verifiedAt ? formatDate(verification.verifiedAt, "Not set") : "Not set"],
    ["Expires", verification.expiresAt ? formatDate(verification.expiresAt, "No expiry") : "No expiry"],
    ["Note", verification.reason || "No note recorded"],
  ];

  return (
    <dl className="review-meta" aria-label="Last member verification review">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InstagramApiStatusCard({
  status,
  busy,
  onRefresh,
}: {
  status: InstagramApiStatus | null;
  busy: boolean;
  onRefresh: () => void;
}) {
  const configured = Boolean(status?.configured);
  const accountReachable = Boolean(status?.accountReachable);
  const publishEnabled = Boolean(status?.publishEnabled);
  const accountIdPinned = Boolean(status?.accountIdPinned);
  const ready = configured && accountReachable && accountIdPinned && publishEnabled;
  const label = ready ? "Configured" : configured ? "Needs review" : "Not configured";
  const message = text(status?.message, "Meta API status has not been checked yet.");

  return (
    <div className={`review-decision instagram-api-status instagram-api-status--${ready ? "ready" : configured ? "review" : "missing"}`}>
      <div>
        <strong>Meta API Status: {label}</strong>
        <p>{message}</p>
      </div>
      <dl className="review-meta instagram-api-status__meta" aria-label="Meta API diagnostic details">
        <div>
          <dt>Account</dt>
          <dd>{status?.account?.username ? `@${status.account.username}` : "Not verified"}</dd>
        </div>
        <div>
          <dt>Account check</dt>
          <dd>{accountReachable ? "Passed" : "Not passed"}</dd>
        </div>
        <div>
          <dt>Graph user ID pin</dt>
          <dd>{accountIdPinned ? "Pinned" : "Required"}</dd>
        </div>
        <div>
          <dt>Server activation</dt>
          <dd>{publishEnabled ? "On" : "Off"}</dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd>{status?.checkedAt ? formatDate(status.checkedAt, "Not checked") : "Not checked"}</dd>
        </div>
      </dl>
      <button className="hero-cta" type="button" onClick={onRefresh} disabled={busy}>
        {busy ? "Checking Meta API" : "Check Meta API"}
      </button>
    </div>
  );
}
