"use client";

import { useEffect, useState } from "react";
import {
  startGalleryPreviewRequest,
  type GalleryPreviewLease,
} from "@/lib/gallery/safe-preview";
import {
  text,
  type GalleryReviewQueue,
  type GalleryReviewSubmission,
  type InstagramApiStatus,
  type InstagramPublishJob,
  type InstagramReconciliationResolution,
  type MemberAccessVerification,
  type ModerationStatus,
} from "@/lib/supabase/types";
import { formatBytes, formatDate } from "./format";
import { normalizeInstagramPostPermalink } from "@/lib/gallery/instagram-action-confirmation";
import { validateSocialPublicationCopy } from "@/lib/gallery/social-publication-copy";

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
  { id: "canceled", label: "Canceled", empty: "No canceled Instagram jobs." },
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

function uploaderName(item: GalleryReviewSubmission) {
  const uploader = item.uploader || {};
  return uploader.discordGlobalName || uploader.displayName || uploader.discordUsername || "Mōchirīī Member";
}

function discordDetail(item: GalleryReviewSubmission) {
  const uploader = item.uploader || {};
  if (uploader.discordGlobalName && uploader.discordUsername) return `${uploader.discordGlobalName} · ${uploader.discordUsername}`;
  return uploader.discordUsername || "Discord identity on file";
}

function instagramConsentLabel(item: GalleryReviewSubmission) {
  return item.instagramOptIn ? "Instagram selected" : "Not selected";
}

function facebookConsentLabel(item: GalleryReviewSubmission) {
  return item.facebookPageOptIn ? "Facebook Page selected" : "Not selected";
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
  }, [onBlobChange, onError, previewBlob, previewKey, submissionId]);

  function confirmDecodedImage(image: HTMLImageElement) {
    if (preview.status !== "decoding") return;
    if (image.naturalWidth !== previewWidth || image.naturalHeight !== previewHeight) {
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
    if (preview.status === "decoding" || preview.status === "ready") preview.release();
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
        <div className="review-preview__empty" role="status"><span>Loading prepared preview</span></div>
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
        <div className="review-preview__empty" role="alert"><span>Prepared preview unavailable</span></div>
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
          <div className="review-preview__empty"><span>Preview unavailable</span></div>
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
            ["Source validation", previewSourceWidth && previewSourceHeight
              ? `${previewSourceWidth} × ${previewSourceHeight}`
              : "Review required"],
            ["Prepared preview", previewKey && previewWidth && previewHeight
              ? `${previewWidth} × ${previewHeight}`
              : "Not prepared"],
            ["Gallery thumbnail", item.thumbnailSizeBytes ? formatBytes(item.thumbnailSizeBytes) : "Not prepared"],
            ["Submitted", formatDate(item.createdAt, "Not set")],
            ["Reviewed", item.reviewedAt ? formatDate(item.reviewedAt, "Not reviewed") : "Not reviewed"],
            ["Instagram", instagramConsentLabel(item)],
            ["Facebook Page", facebookConsentLabel(item)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
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
              Validate and inspect this one private image before approving or preparing public Gallery media.
            </p>
            <div className="auth-actions">
              <button className="hero-cta" type="button" onClick={() => onPreparePreview(item)} disabled={busy}>
                Prepare private preview
              </button>
            </div>
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
            <div className="auth-actions">
              <button className="hero-cta hero-cta--primary" type="button" onClick={() => onModerate(item, "approved")} disabled={busy || !previewReady}>Approve</button>
              <button className="hero-cta" type="button" onClick={() => onModerate(item, "rejected")} disabled={busy}>Decline</button>
            </div>
          </>
        ) : null}
        {status === "approved" ? (
          <section className="review-history" aria-label="Gallery thumbnail preparation">
            <h4>Gallery Thumbnail</h4>
            <p className="review-action-note">
              {item.publicationReady
                ? "Prepare a new immutable thumbnail revision when the current gallery image needs repair."
                : "Prepare the bounded gallery image before this submission can appear in the public album."}
            </p>
            <div className="auth-actions">
              <button className="hero-cta" type="button" onClick={() => onModerate(item, "thumbnail")} disabled={busy || !previewReady}>
                {item.publicationReady ? "Refresh gallery thumbnail" : "Prepare gallery thumbnail"}
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

export type InstagramReconciliationDraft = {
  resolution: InstagramReconciliationResolution | "";
  note: string;
  instagramMediaId: string;
  instagramPermalink: string;
};

export function InstagramJobCard({
  job,
  busy,
  caption,
  altText,
  confirmationArmed,
  reconciliation,
  reconciliationArmed,
  jobMessage,
  metaPublishAvailable,
  onCaptionChange,
  onAltTextChange,
  onArmPublish,
  onConfirmPublish,
  onCancelPublish,
  onReconciliationChange,
  onArmReconciliation,
  onConfirmReconciliation,
  onCancelReconciliation,
}: {
  job: InstagramPublishJob;
  busy: boolean;
  caption: string;
  altText: string;
  confirmationArmed: boolean;
  reconciliation: InstagramReconciliationDraft;
  reconciliationArmed: boolean;
  jobMessage?: InstagramJobMessage;
  metaPublishAvailable: boolean;
  onCaptionChange: (value: string) => void;
  onAltTextChange: (value: string) => void;
  onArmPublish: (job: InstagramPublishJob) => void;
  onConfirmPublish: (job: InstagramPublishJob) => void;
  onCancelPublish: (job: InstagramPublishJob) => void;
  onReconciliationChange: (draft: InstagramReconciliationDraft) => void;
  onArmReconciliation: (job: InstagramPublishJob) => void;
  onConfirmReconciliation: (job: InstagramPublishJob) => void;
  onCancelReconciliation: (job: InstagramPublishJob) => void;
}) {
  const submission = job.submission || {};
  const title = text(submission.title || submission.originalFilename, "Untitled image");
  const sourceLabel = text(submission.source, "website").toLowerCase() === "discord" ? "Discord" : "Website";
  const status = text(job.status, "queued").toLowerCase();
  const canEditPublishText = status === "queued" || status === "failed";
  const canPublish = canEditPublishText && metaPublishAvailable && Boolean(caption.trim()) && Boolean(altText.trim());
  const reconcilable = status === "reconcile_required";
  const permalink = normalizeInstagramPostPermalink(job.instagramPermalink);
  const copyValidation = validateSocialPublicationCopy([caption, altText]);
  const reconciliationError = !reconciliation.resolution
    ? "Choose whether a matching Instagram post exists."
    : !reconciliation.note.trim()
      ? "Record what you inspected on the official account."
      : reconciliation.resolution === "confirmed_published" &&
          (!/^\d{5,255}$/.test(reconciliation.instagramMediaId.trim()) ||
            !normalizeInstagramPostPermalink(reconciliation.instagramPermalink))
        ? "Enter a numeric media ID and canonical post or reel permalink."
        : "";

  return (
    <article className={`review-item review-item--${status}`} data-instagram-job-id={job.id || ""}>
      <div className="review-preview">
        {job.thumbnailUrl ? (
          <div className="review-preview__empty"><span>Approved Gallery thumbnail available</span><a className="hero-cta" href={job.thumbnailUrl} target="_blank" rel="noopener noreferrer">Open approved Gallery preview</a></div>
        ) : <div className="review-preview__empty"><span>Approved preview unavailable</span></div>}
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
        {jobMessage ? (
          <p className={`review-action-message review-action-message--${jobMessage.kind}`} role={jobMessage.kind === "error" ? "alert" : "status"}>
            {jobMessage.message}
          </p>
        ) : null}
        {permalink ? (
          <p><a href={permalink} target="_blank" rel="noopener noreferrer">Open verified Instagram post</a></p>
        ) : null}
        <dl className="review-meta">
          {[
            ["Consent", submission.instagramOptIn ? "Instagram opt-in" : "No opt-in"],
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
        {canEditPublishText ? <><label className="form-field">
          <span>Final Instagram caption</span>
          <textarea
            maxLength={2200}
            rows={4}
            value={caption}
            disabled={busy || !canEditPublishText}
            onChange={(event) => onCaptionChange(event.target.value.slice(0, 2200))}
          />
        </label>
        {!caption.trim() ? <p className="review-action-note" role="alert">A final Instagram caption is required.</p> : null}
        <label className="form-field">
          <span>Required moderator-reviewed Instagram alt text</span>
          <textarea
            maxLength={1000}
            rows={3}
            value={altText}
            disabled={busy || !canEditPublishText}
            onChange={(event) => onAltTextChange(event.target.value.slice(0, 1000))}
          />
        </label>
        {!altText.trim() ? <p className="review-action-note" role="alert">Alt text is required before publication.</p> : null}
        {!copyValidation.ok ? <p className="review-action-note" role="alert">{copyValidation.message}</p> : null}
        {confirmationArmed ? <div className="review-action-note" role="status"><strong>Second moderator confirmation</strong><p>{caption}</p><p>Alt text: {altText}</p><p>Editing either field cancels this confirmation.</p></div> : null}
        <div className="auth-actions">
          <button
            className="hero-cta hero-cta--primary" type="button"
            disabled={busy || !canPublish || !copyValidation.ok}
            onClick={() => confirmationArmed ? onConfirmPublish(job) : onArmPublish(job)}
          >
            {confirmationArmed ? "Confirm public Instagram post" : metaPublishAvailable ? "Prepare Instagram publication" : "Instagram publishing blocked"}
          </button>
          {confirmationArmed ? <button className="hero-cta" type="button" disabled={busy} onClick={() => onCancelPublish(job)}>Cancel</button> : null}
        </div>
        </> : null}
        {reconcilable ? <section className="review-history" aria-label="Instagram reconciliation">
          <h4>Inspect before reconciliation</h4>
          <p className="review-action-note" role="alert">Meta may have received this image. Inspect the official account; never retry this job automatically.</p>
          <label className="form-field"><span>Inspection outcome</span><select value={reconciliation.resolution} disabled={busy} onChange={(event) => {
            const resolution = event.target.value as InstagramReconciliationResolution | "";
            onReconciliationChange(resolution === "confirmed_not_published" ? { ...reconciliation, resolution, instagramMediaId: "", instagramPermalink: "" } : { ...reconciliation, resolution });
          }}><option value="">Choose after inspecting the account</option><option value="confirmed_not_published">No matching post found</option><option value="confirmed_published">Matching post confirmed</option></select></label>
          <label className="form-field"><span>Inspection note</span><textarea maxLength={500} rows={3} value={reconciliation.note} disabled={busy} onChange={(event) => onReconciliationChange({ ...reconciliation, note: event.target.value.slice(0, 500) })} /></label>
          {reconciliation.resolution === "confirmed_published" ? <><label className="form-field"><span>Instagram media ID</span><input maxLength={255} inputMode="numeric" value={reconciliation.instagramMediaId} disabled={busy} onChange={(event) => onReconciliationChange({ ...reconciliation, instagramMediaId: event.target.value.slice(0, 255) })} /></label><label className="form-field"><span>Canonical Instagram post or reel permalink</span><input type="url" maxLength={1000} value={reconciliation.instagramPermalink} disabled={busy} onChange={(event) => onReconciliationChange({ ...reconciliation, instagramPermalink: event.target.value.slice(0, 1000) })} /></label></> : null}
          {reconciliationArmed ? <p className="review-action-note" role="status">Confirm this exact inspection result. No publication request will be sent.</p> : null}
          <div className="auth-actions"><button className="hero-cta hero-cta--primary" type="button" disabled={busy || Boolean(reconciliationError)} onClick={() => reconciliationArmed ? onConfirmReconciliation(job) : onArmReconciliation(job)}>{reconciliationArmed ? "Confirm reconciliation" : "Prepare reconciliation"}</button>{reconciliationArmed ? <button className="hero-cta" type="button" disabled={busy} onClick={() => onCancelReconciliation(job)}>Cancel</button> : null}</div>
        </section> : null}
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
  const publishEnabled = Boolean(status?.publishEnabled);
  const ready = Boolean(status?.ready && configured && publishEnabled);
  const label = ready ? "Ready" : configured ? "Blocked" : "Not configured";
  const message = text(status?.message, "Meta API status has not been checked yet.");

  return (
    <div className={`review-decision instagram-api-status instagram-api-status--${ready ? "ready" : configured ? "review" : "missing"}`}>
      <div>
        <strong>Meta API Status: {label}</strong>
        <p>{message}</p>
      </div>
      <dl className="review-meta instagram-api-status__meta" aria-label="Meta API diagnostic details">
        <div>
          <dt>Pinned identity</dt>
          <dd>{status?.identityMatches && status?.pageToInstagramLinkageVerified ? "Passed" : "Not passed"}</dd>
        </div>
        <div>
          <dt>Token and scopes</dt>
          <dd>{status?.tokenBindingVerified && status?.scopesVerified && status?.expiryVerified ? "Passed" : "Not passed"}</dd>
        </div>
        <div>
          <dt>Quota</dt>
          <dd>{status?.quotaReadable && !status?.quotaExhausted ? "Passed" : "Not passed"}</dd>
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
