"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkFacebookPageApiStatus,
  listFacebookPagePublishQueue,
  publishFacebookPageGallerySubmission,
  resolveFacebookPagePublishReconciliation,
} from "@/lib/supabase/moderation";
import {
  text,
  type FacebookPageApiStatus,
  type FacebookPagePublishJob,
  type FacebookPagePublishQueue as FacebookPagePublishQueueData,
  type FacebookPageReconciliationResolution,
} from "@/lib/supabase/types";
import { SUPABASE_URL } from "@/lib/supabase/config";
import {
  facebookPagePublishFingerprint,
  facebookPageReconciliationFingerprint,
} from "@/lib/gallery/facebook-action-confirmation";
import {
  FACEBOOK_CANONICAL_PAGE_ID,
  FACEBOOK_CANONICAL_PAGE_URL,
  normalizeFacebookPermalink,
} from "@/lib/gallery/facebook-permalink";
import { FACEBOOK_GROUP_URL } from "@/lib/public-urls";
import { formatBytes, formatDate } from "./format";
import { WorkflowEmptyState, WorkflowNotice } from "./WorkflowState";

const DEFAULT_FACEBOOK_PAGE_MESSAGE =
  "A pretty gameplay showcase from Mōchirīī.";
const FACEBOOK_PAGE_QUEUE_PAGE_SIZE = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const facebookPageStatuses = [
  { id: "queued", label: "Queued", empty: "No Facebook Page-ready images." },
  { id: "failed", label: "Failed", empty: "No failed Facebook Page jobs." },
  { id: "reconcile_required", label: "Needs reconciliation", empty: "No Facebook Page jobs need reconciliation." },
  { id: "published", label: "Published", empty: "No published Facebook Page posts." },
  { id: "ineligible", label: "Ineligible", empty: "No ineligible Facebook Page jobs." },
  { id: "all", label: "All", empty: "No Facebook Page publishing jobs." },
] as const;

type FacebookPageStatusId = (typeof facebookPageStatuses)[number]["id"];
type JobMessage = {
  kind: "status" | "error" | "success";
  message: string;
};
type ReconciliationDraft = {
  resolution: FacebookPageReconciliationResolution | "";
  note: string;
  facebookPhotoId: string;
  facebookPostId: string;
  facebookPermalink: string;
};

function facebookPageStatusConfig(value: unknown) {
  const status = text(value, "queued").toLowerCase();
  return facebookPageStatuses.find((entry) => entry.id === status) || facebookPageStatuses[0];
}

function facebookConsentSourceLabel(value: unknown) {
  const source = text(value).trim().toLowerCase();
  if (source === "website_upload") return "Website member upload";
  if (source === "discord_slash_command" || source === "discord") {
    return "Discord member submission";
  }
  if (source === "website") return "Website member submission";
  return source ? "Recorded member opt-in" : "Not set";
}

function approvedGalleryThumbnailUrl(job: FacebookPagePublishJob) {
  const publicationId = text(job.galleryPublicationId);
  const thumbnailUrl = text(job.thumbnailUrl);
  if (!SUPABASE_URL || !UUID_RE.test(publicationId) || !thumbnailUrl) return "";
  const expectedUrl = `${SUPABASE_URL}/functions/v1/list-approved-gallery-submissions?asset=thumbnail&id=${encodeURIComponent(publicationId)}`;
  return thumbnailUrl === expectedUrl ? thumbnailUrl : "";
}

function reconciliationDraft(
  job: FacebookPagePublishJob,
  draft?: ReconciliationDraft,
): ReconciliationDraft {
  return draft || {
    resolution: "",
    note: "",
    facebookPhotoId: text(job.facebookPhotoId),
    facebookPostId: text(job.facebookPostId),
    facebookPermalink: text(job.facebookPermalink),
  };
}

function reconciliationValidation(draft: ReconciliationDraft): string {
  if (!draft.resolution) {
    return "Choose whether the Facebook Page post was published or not published.";
  }
  if (!draft.note.trim()) {
    return "Record what you inspected on the Facebook Page.";
  }
  if (
    draft.resolution === "confirmed_published" &&
    !draft.facebookPhotoId.trim() &&
    !draft.facebookPostId.trim()
  ) {
    return "A Facebook photo or post id is required to confirm publication.";
  }
  if (
    draft.resolution === "confirmed_not_published" &&
    (
      draft.facebookPhotoId.trim() || draft.facebookPostId.trim() ||
      draft.facebookPermalink.trim()
    )
  ) {
    return "Remove every Facebook photo id, post id, and permalink when no Page post exists.";
  }
  if (
    draft.facebookPermalink.trim() &&
    !normalizeFacebookPermalink(draft.facebookPermalink)
  ) {
    return "Use a canonical HTTPS facebook.com post permalink without credentials or a fragment.";
  }
  return "";
}

function FacebookPageApiStatusCard({
  status,
  busy,
  onRefresh,
}: {
  status: FacebookPageApiStatus | null;
  busy: boolean;
  onRefresh: () => void;
}) {
  const configured = Boolean(status?.configured);
  const pageReachable = Boolean(status?.pageReachable);
  const publishEnabled = Boolean(status?.publishEnabled);
  const publishAuthorityConfirmed = Boolean(status?.publishAuthorityConfirmed);
  const ready = configured && pageReachable && publishEnabled;
  const label = ready
    ? publishAuthorityConfirmed ? "Configured" : "Armed"
    : configured ? "Needs review" : "Not configured";
  const message = text(status?.message, "Facebook Page API status has not been checked yet.");
  const pageLink = text(status?.page?.id) === FACEBOOK_CANONICAL_PAGE_ID
    ? FACEBOOK_CANONICAL_PAGE_URL
    : "";

  return (
    <div className={`review-decision facebook-page-api-status facebook-page-api-status--${ready ? "ready" : configured ? "review" : "missing"}`}>
      <div>
        <strong>Facebook Page API: {label}</strong>
        <p>{message}</p>
        {pageLink ? (
          <p><a href={pageLink} target="_blank" rel="noopener noreferrer">Open {status?.page?.name || "Facebook Page"}</a></p>
        ) : null}
      </div>
      <dl className="review-meta" aria-label="Facebook Page API diagnostic details">
        <div>
          <dt>Page check</dt>
          <dd>{pageReachable ? "Passed" : "Not passed"}</dd>
        </div>
        <div>
          <dt>Server activation</dt>
          <dd>{publishEnabled ? "On" : "Off"}</dd>
        </div>
        <div>
          <dt>Publish authority</dt>
          <dd>{publishAuthorityConfirmed ? "Confirmed" : ready ? "Unconfirmed; first approved post is the canary" : "Unconfirmed"}</dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd>{status?.checkedAt ? formatDate(status.checkedAt, "Not checked") : "Not checked"}</dd>
        </div>
      </dl>
      <button className="hero-cta" type="button" onClick={onRefresh} disabled={busy}>
        {busy ? "Checking Page API" : "Check Page API"}
      </button>
    </div>
  );
}

function FacebookPageJobCard({
  job,
  busy,
  message,
  confirmationArmed,
  reconciliation,
  reconciliationArmed,
  jobMessage,
  pagePublishAvailable,
  pageLink,
  onMessageChange,
  onArmPublish,
  onConfirmPublish,
  onCancelPublish,
  onReconciliationChange,
  onArmReconciliation,
  onConfirmReconciliation,
  onCancelReconciliation,
}: {
  job: FacebookPagePublishJob;
  busy: boolean;
  message: string;
  confirmationArmed: boolean;
  reconciliation: ReconciliationDraft;
  reconciliationArmed: boolean;
  jobMessage?: JobMessage;
  pagePublishAvailable: boolean;
  pageLink: string;
  onMessageChange: (value: string) => void;
  onArmPublish: (job: FacebookPagePublishJob) => void;
  onConfirmPublish: (job: FacebookPagePublishJob) => void;
  onCancelPublish: (job: FacebookPagePublishJob) => void;
  onReconciliationChange: (job: FacebookPagePublishJob, draft: ReconciliationDraft) => void;
  onArmReconciliation: (job: FacebookPagePublishJob) => void;
  onConfirmReconciliation: (job: FacebookPagePublishJob) => void;
  onCancelReconciliation: (job: FacebookPagePublishJob) => void;
}) {
  const submission = job.submission || {};
  const title = text(submission.title || submission.originalFilename, "Untitled image");
  const sourceLabel = text(submission.source, "website").toLowerCase() === "discord" ? "Discord" : "Website";
  const status = text(job.status, "queued").toLowerCase();
  const retryable = status === "queued" || status === "failed";
  const reconcilable = status === "reconcile_required";
  const canPublish = retryable && pagePublishAvailable && Boolean(message.trim());
  const permalink = normalizeFacebookPermalink(job.facebookPermalink) || "";
  const published = status === "published";
  const thumbnailUrl = approvedGalleryThumbnailUrl(job);
  const reconciliationError = reconciliationValidation(reconciliation);

  return (
    <article className={`review-item review-item--${status}`} data-facebook-page-job-id={job.id || ""}>
      <div className="review-preview">
        {thumbnailUrl ? (
          <div className="review-preview__empty">
            <span>Approved Gallery thumbnail available</span>
            <a className="hero-cta" href={thumbnailUrl} target="_blank" rel="noopener noreferrer">Open approved Gallery preview</a>
          </div>
        ) : (
          <div className="review-preview__empty">
            <span>Private source withheld</span>
            <small>Review the approved Gallery record before publishing.</small>
          </div>
        )}
      </div>
      <div className="review-details">
        <div className="review-details__head">
          <div>
            <h3>{title}</h3>
            <p className="muted">{submission.uploader?.displayName || "Mōchirīī Member"} · {sourceLabel}</p>
          </div>
          <span className={`submission-status submission-status--${status}`}>{status.replaceAll("_", " ")}</span>
        </div>
        {job.eligibilityReason ? <p className="review-decision">Eligibility: {job.eligibilityReason}</p> : null}
        {job.lastError ? <p className="review-decision">Last error: {job.lastError}</p> : null}
        {reconcilable ? (
          <div className="review-action-note" role="alert">
            <p>Meta may have received this image. Inspect the Page before resolving it; this job cannot be retried automatically.</p>
            {pageLink ? <a href={pageLink} target="_blank" rel="noopener noreferrer">Open configured Facebook Page</a> : null}
          </div>
        ) : null}
        {jobMessage ? (
          <p className={`review-action-message review-action-message--${jobMessage.kind}`} role={jobMessage.kind === "error" ? "alert" : "status"}>
            {jobMessage.message}
          </p>
        ) : null}
        {permalink ? (
          <p><a href={permalink} target="_blank" rel="noopener noreferrer">Open Facebook Page post</a></p>
        ) : null}
        {published ? (
          <div className="review-decision">
            <strong>Manual guild-group handoff</strong>
            <p>Facebook does not provide API publishing to Groups. Open the private guild group and share this completed Page post manually.</p>
            <a href={FACEBOOK_GROUP_URL} target="_blank" rel="noopener noreferrer">Open Mōchirīī Guild Facebook group</a>
          </div>
        ) : null}
        <dl className="review-meta">
          {[
            ["Consent", submission.facebookPageOptIn
              ? "Image + moderator-approved caption on the public official Facebook Page; optional moderator share to the private official guild group"
              : "No Facebook Page publication opt-in"],
            ["Consent source", facebookConsentSourceLabel(submission.facebookPageOptInSource)],
            ["Consent handshake", submission.facebookPageOptInContractVersion || "Not current"],
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
        {retryable ? (
          <>
            <label className="form-field">
              <span>Facebook Page caption</span>
              <textarea
                maxLength={5000}
                rows={4}
                value={message}
                disabled={busy}
                onChange={(event) => onMessageChange(event.target.value.slice(0, 5000))}
              />
            </label>
            {!message.trim() ? <p className="review-action-note" role="alert">Add a Facebook Page caption before publishing.</p> : null}
            {confirmationArmed ? (
              <div className="review-action-note" role="status">
                <strong>Exact moderator-approved Page caption</strong>
                <p>{message}</p>
                <p>This creates a public post on the official Mōchirīī Facebook Page. Editing the caption cancels this confirmation.</p>
              </div>
            ) : null}
            <div className="auth-actions">
              <button
                className="hero-cta hero-cta--primary"
                type="button"
                disabled={busy || !canPublish}
                onClick={() => confirmationArmed ? onConfirmPublish(job) : onArmPublish(job)}
              >
                {confirmationArmed ? "Confirm public Page post" : pagePublishAvailable ? "Publish to Facebook Page" : "Page publishing not armed"}
              </button>
              {confirmationArmed ? (
                <button className="hero-cta" type="button" disabled={busy} onClick={() => onCancelPublish(job)}>
                  Cancel
                </button>
              ) : null}
            </div>
          </>
        ) : null}
        {reconcilable ? (
          <section className="review-history" aria-label="Facebook Page reconciliation">
            <h4>Resolve after Page inspection</h4>
            <label className="form-field">
              <span>Inspection outcome</span>
              <select
                value={reconciliation.resolution}
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.value;
                  const resolution = value === "confirmed_published" || value === "confirmed_not_published"
                    ? value
                    : "";
                  onReconciliationChange(job, resolution === "confirmed_not_published"
                    ? {
                      ...reconciliation,
                      resolution,
                      facebookPhotoId: "",
                      facebookPostId: "",
                      facebookPermalink: "",
                    }
                    : { ...reconciliation, resolution });
                }}
              >
                <option value="">Choose after inspecting the Page</option>
                <option value="confirmed_not_published">No matching Page post found</option>
                <option value="confirmed_published">Matching Page post confirmed</option>
              </select>
            </label>
            <label className="form-field">
              <span>Moderator inspection note</span>
              <textarea
                maxLength={500}
                rows={3}
                value={reconciliation.note}
                disabled={busy}
                placeholder="Record where you checked and how you matched the image."
                onChange={(event) => onReconciliationChange(job, {
                  ...reconciliation,
                  note: event.target.value.slice(0, 500),
                })}
              />
            </label>
            {reconciliation.resolution === "confirmed_published" ? (
              <>
                <p className="review-action-note">Use the retained provider evidence when present, or enter at least one Facebook photo or post id from the inspected post.</p>
                <label className="form-field">
                  <span>Facebook photo id</span>
                  <input
                    maxLength={255}
                    value={reconciliation.facebookPhotoId}
                    disabled={busy}
                    onChange={(event) => onReconciliationChange(job, {
                      ...reconciliation,
                      facebookPhotoId: event.target.value.slice(0, 255),
                    })}
                  />
                </label>
                <label className="form-field">
                  <span>Facebook post id</span>
                  <input
                    maxLength={255}
                    value={reconciliation.facebookPostId}
                    disabled={busy}
                    onChange={(event) => onReconciliationChange(job, {
                      ...reconciliation,
                      facebookPostId: event.target.value.slice(0, 255),
                    })}
                  />
                </label>
                <label className="form-field">
                  <span>Facebook post permalink (optional)</span>
                  <input
                    type="url"
                    maxLength={1000}
                    value={reconciliation.facebookPermalink}
                    disabled={busy}
                    placeholder="https://www.facebook.com/..."
                    onChange={(event) => onReconciliationChange(job, {
                      ...reconciliation,
                      facebookPermalink: event.target.value.slice(0, 1000),
                    })}
                  />
                </label>
              </>
            ) : null}
            {reconciliationArmed ? (
              <p className="review-action-note" role="status">
                {reconciliation.resolution === "confirmed_published"
                  ? "Confirm that the inspected Page post and provider id match this exact job. This records the job as published without sending another post."
                  : "Confirm that no matching Page post exists. This returns the job to Failed; publishing still requires a separate approval."}
              </p>
            ) : null}
            <div className="auth-actions">
              <button
                className="hero-cta hero-cta--primary"
                type="button"
                disabled={busy || Boolean(reconciliationError)}
                onClick={() => reconciliationArmed ? onConfirmReconciliation(job) : onArmReconciliation(job)}
              >
                {reconciliationArmed
                  ? reconciliation.resolution === "confirmed_published"
                    ? "Confirm inspected Page post"
                    : "Confirm no Page post found"
                  : "Arm reconciliation result"}
              </button>
              {reconciliationArmed ? (
                <button className="hero-cta" type="button" disabled={busy} onClick={() => onCancelReconciliation(job)}>
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

export function FacebookPagePublishQueue() {
  const [activeStatus, setActiveStatus] = useState<FacebookPageStatusId>("queued");
  const [queue, setQueue] = useState<FacebookPagePublishQueueData | null>(null);
  const [apiStatus, setApiStatus] = useState<FacebookPageApiStatus | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [busyJobId, setBusyJobId] = useState("");
  const [queueCursor, setQueueCursor] = useState("");
  const [queueCursorHistory, setQueueCursorHistory] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("Facebook Page queue has not loaded yet.");
  const [queueError, setQueueError] = useState("");
  const [apiError, setApiError] = useState("");
  const [publicationError, setPublicationError] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [confirmations, setConfirmations] = useState<Record<string, string | undefined>>({});
  const [reconciliationDrafts, setReconciliationDrafts] = useState<Record<string, ReconciliationDraft | undefined>>({});
  const [reconciliationConfirmations, setReconciliationConfirmations] = useState<Record<string, string | undefined>>({});
  const [jobMessages, setJobMessages] = useState<Record<string, JobMessage | undefined>>({});
  const mountedRef = useRef(true);
  const externalActionRef = useRef("");

  const loadQueue = useCallback(async (
    requestedStatus: FacebookPageStatusId,
    options: {
      cursor?: string;
      history?: string[];
      successMessage?: string;
    } = {},
  ) => {
    const config = facebookPageStatusConfig(requestedStatus);
    const cursor = options.cursor || "";
    const history = options.history || [];
    setActiveStatus(config.id);
    setQueueBusy(true);
    setQueueError("");
    setConfirmations({});
    setReconciliationConfirmations({});
    setStatusMessage(`Loading ${config.label.toLowerCase()} Facebook Page jobs.`);

    const result = await listFacebookPagePublishQueue({
      status: config.id,
      cursor,
      pageSize: FACEBOOK_PAGE_QUEUE_PAGE_SIZE,
    });
    if (!mountedRef.current) return;
    if (!result.ok) {
      setQueue(null);
      setQueueError(result.message || "Facebook Page publishing queue could not be loaded.");
      setStatusMessage("");
      setQueueBusy(false);
      return;
    }

    const data = result.data || { jobs: [] };
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    setQueue({ ...data, jobs, count: jobs.length });
    setQueueCursor(cursor);
    setQueueCursorHistory(history);
    setStatusMessage(
      options.successMessage || (jobs.length
        ? `${jobs.length} ${config.label.toLowerCase()} Facebook Page job${jobs.length === 1 ? "" : "s"} shown.`
        : config.empty),
    );
    setQueueBusy(false);
  }, []);

  const loadApiStatus = useCallback(async (successMessage = "") => {
    setApiBusy(true);
    setApiError("");
    const result = await checkFacebookPageApiStatus();
    if (!mountedRef.current) return;
    if (!result.ok) {
      setApiStatus(null);
      setApiError(result.message || "Facebook Page API status could not be checked.");
      setApiBusy(false);
      return;
    }

    const data = result.data || null;
    setApiStatus(data);
    if (successMessage || result.message || data?.message) {
      setStatusMessage(successMessage || result.message || data?.message || "Facebook Page API status checked.");
    }
    setApiBusy(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(() => Promise.allSettled([
      loadQueue("queued"),
      loadApiStatus(),
    ]));
    return () => {
      mountedRef.current = false;
      externalActionRef.current = "";
    };
  }, [loadApiStatus, loadQueue]);

  function setJobMessage(jobId: string, message: JobMessage | undefined) {
    setJobMessages((current) => ({ ...current, [jobId]: message }));
  }

  function acquireExternalAction(jobId: string) {
    if (externalActionRef.current) return false;
    externalActionRef.current = jobId;
    setBusyJobId(jobId);
    return true;
  }

  function releaseExternalAction(jobId: string) {
    if (externalActionRef.current !== jobId) return;
    externalActionRef.current = "";
    if (mountedRef.current) setBusyJobId("");
  }

  function armPublish(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    if (!jobId) {
      setPublicationError("Choose a Facebook Page publishing job before continuing.");
      return;
    }
    const message = (messages[jobId] ?? text(
      job.message || job.submission?.caption,
      DEFAULT_FACEBOOK_PAGE_MESSAGE,
    )).trim();
    if (!message) {
      setPublicationError("Add a Facebook Page caption before publishing.");
      setJobMessage(jobId, { kind: "error", message: "Add a Facebook Page caption before publishing." });
      return;
    }
    setPublicationError("");
    setMessages((current) => ({ ...current, [jobId]: message }));
    setConfirmations((current) => ({
      ...current,
      [jobId]: facebookPagePublishFingerprint(job, message),
    }));
    setJobMessage(jobId, {
      kind: "status",
      message: "Ready for final confirmation. This action creates a public Facebook Page post.",
    });
  }

  function cancelPublish(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    if (!jobId) return;
    setConfirmations((current) => ({ ...current, [jobId]: undefined }));
    setJobMessage(jobId, undefined);
  }

  function updateReconciliation(job: FacebookPagePublishJob, draft: ReconciliationDraft) {
    const jobId = text(job.id);
    if (!jobId) return;
    setReconciliationDrafts((current) => ({ ...current, [jobId]: draft }));
    setReconciliationConfirmations((current) => ({ ...current, [jobId]: undefined }));
    setJobMessage(jobId, undefined);
    setPublicationError("");
  }

  function armReconciliation(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    if (!jobId) {
      setPublicationError("Choose a Facebook Page reconciliation job before continuing.");
      return;
    }
    const draft = reconciliationDraft(job, reconciliationDrafts[jobId]);
    const validationError = reconciliationValidation(draft);
    if (validationError) {
      setPublicationError(validationError);
      setJobMessage(jobId, { kind: "error", message: validationError });
      return;
    }

    setPublicationError("");
    setReconciliationConfirmations((current) => ({
      ...current,
      [jobId]: facebookPageReconciliationFingerprint(job, draft),
    }));
    setJobMessage(jobId, {
      kind: "status",
      message: draft.resolution === "confirmed_published"
        ? "Reconciliation is armed. Confirm only if the inspected Page post and provider id match this job."
        : "Reconciliation is armed. Confirm only after checking that no matching Page post exists.",
    });
  }

  function cancelReconciliation(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    if (!jobId) return;
    setReconciliationConfirmations((current) => ({ ...current, [jobId]: undefined }));
    setJobMessage(jobId, undefined);
    setPublicationError("");
  }

  async function publish(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    if (!jobId) {
      setPublicationError("Choose a Facebook Page publishing job before publishing.");
      return;
    }
    const message = (messages[jobId] ?? text(
      job.message || job.submission?.caption,
      DEFAULT_FACEBOOK_PAGE_MESSAGE,
    )).trim();
    if (
      confirmations[jobId] !== facebookPagePublishFingerprint(job, message)
    ) {
      armPublish(job);
      return;
    }

    const pageApiReady = Boolean(
      apiStatus?.configured &&
      apiStatus.pageReachable &&
      apiStatus.publishEnabled,
    );
    if (!pageApiReady) {
      setJobMessage(jobId, { kind: "error", message: "Facebook Page publishing is not armed. Check the server activation and Page diagnostic." });
      setPublicationError("Facebook Page publishing is not armed. Check the server activation and Page diagnostic.");
      return;
    }
    if (!acquireExternalAction(jobId)) {
      setPublicationError("Wait for the active Facebook Page action to finish.");
      return;
    }

    setPublicationError("");
    setStatusMessage("Publishing image to the official Facebook Page.");
    setJobMessage(jobId, { kind: "status", message: "Publishing this image to the official Facebook Page." });
    setConfirmations((current) => ({ ...current, [jobId]: undefined }));

    let result;
    try {
      result = await publishFacebookPageGallerySubmission({ jobId, message, confirmPublish: true });
    } catch {
      releaseExternalAction(jobId);
      if (mountedRef.current) {
        setJobMessage(jobId, { kind: "error", message: "Facebook Page publishing failed." });
        setPublicationError("Facebook Page publishing failed.");
        setStatusMessage("");
      }
      return;
    }
    releaseExternalAction(jobId);
    if (!mountedRef.current) return;
    if (!result.ok) {
      setJobMessage(jobId, { kind: "error", message: result.message || "Facebook Page publishing failed." });
      setStatusMessage("");
      await loadQueue(activeStatus);
      if (mountedRef.current) setPublicationError(result.message || "Facebook Page publishing failed.");
      return;
    }

    setConfirmations((current) => ({ ...current, [jobId]: undefined }));
    setJobMessage(jobId, { kind: "success", message: result.message || "Image published to the Facebook Page." });
    await loadQueue(activeStatus, {
      successMessage: result.message || "Image published to the Facebook Page.",
    });
  }

  async function resolveReconciliation(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    if (!jobId) {
      setPublicationError("Choose a Facebook Page reconciliation job before continuing.");
      return;
    }
    const draft = reconciliationDraft(job, reconciliationDrafts[jobId]);
    const validationError = reconciliationValidation(draft);
    if (validationError) {
      setPublicationError(validationError);
      setJobMessage(jobId, { kind: "error", message: validationError });
      return;
    }
    if (
      !draft.resolution ||
      reconciliationConfirmations[jobId] !==
        facebookPageReconciliationFingerprint(job, draft)
    ) {
      armReconciliation(job);
      return;
    }
    if (!acquireExternalAction(jobId)) {
      setPublicationError("Wait for the active Facebook Page action to finish.");
      return;
    }

    setPublicationError("");
    setStatusMessage("Recording the inspected Facebook Page result.");
    setJobMessage(jobId, { kind: "status", message: "Recording the inspected Facebook Page result." });
    setReconciliationConfirmations((current) => ({ ...current, [jobId]: undefined }));

    let result;
    try {
      result = await resolveFacebookPagePublishReconciliation({
        jobId,
        resolution: draft.resolution,
        note: draft.note,
        facebookPhotoId: draft.facebookPhotoId,
        facebookPostId: draft.facebookPostId,
        facebookPermalink: draft.facebookPermalink,
        confirmReconciliation: true,
      });
    } catch {
      releaseExternalAction(jobId);
      if (mountedRef.current) {
        setJobMessage(jobId, { kind: "error", message: "The Facebook Page reconciliation result could not be recorded." });
        setPublicationError("The Facebook Page reconciliation result could not be recorded.");
        setStatusMessage("");
      }
      return;
    }
    releaseExternalAction(jobId);
    if (!mountedRef.current) return;
    if (!result.ok) {
      const message = result.message || "The Facebook Page reconciliation result could not be recorded.";
      setJobMessage(jobId, { kind: "error", message });
      setStatusMessage("");
      await loadQueue(activeStatus);
      if (mountedRef.current) setPublicationError(message);
      return;
    }

    const message = result.message || "The Facebook Page reconciliation result was recorded.";
    setReconciliationDrafts((current) => ({ ...current, [jobId]: undefined }));
    setJobMessage(jobId, { kind: "success", message });
    await loadQueue(activeStatus, { successMessage: message });
  }

  const jobs = Array.isArray(queue?.jobs) ? queue.jobs : [];
  const config = facebookPageStatusConfig(activeStatus);
  const pagePublishAvailable = Boolean(
    apiStatus?.configured &&
    apiStatus.pageReachable &&
    apiStatus.publishEnabled,
  );
  const error = [queueError, apiError, publicationError].filter(Boolean).join(" ");

  return (
    <section className="glass-card glass-card--primary glass-pad auth-panel" id="facebookPageQueuePanel" aria-busy={queueBusy}>
      <div className="auth-panel__head">
        <div>
          <p className="kicker">Facebook Page Queue</p>
          <h2 className="section-title">Approved Page Publishing</h2>
        </div>
        <button className="hero-cta" type="button" onClick={() => loadQueue(activeStatus)} disabled={queueBusy || Boolean(busyJobId)}>Refresh</button>
      </div>

      <p className="lede">Approved, opted-in images can be published to the official Page. Sharing a completed Page post into the private guild group remains a separate manual action.</p>

      <div className="queue-tabs" role="group" aria-label="Facebook Page publishing queues">
        {facebookPageStatuses.map((status) => (
          <button
            className="queue-tab"
            type="button"
            data-status={status.id}
            aria-pressed={status.id === activeStatus}
            disabled={queueBusy || Boolean(busyJobId)}
            key={status.id}
            onClick={() => loadQueue(status.id)}
          >
            {status.label} - {Number(queue?.summary?.[status.id === "all" ? "total" : status.id] || 0)}
          </button>
        ))}
      </div>

      <WorkflowNotice hidden={!statusMessage}>{statusMessage}</WorkflowNotice>
      <WorkflowNotice tone="danger" role="alert" hidden={!error}>{error}</WorkflowNotice>

      <FacebookPageApiStatusCard
        status={apiStatus}
        busy={apiBusy || Boolean(busyJobId)}
        onRefresh={() => void loadApiStatus("Facebook Page API status checked.")}
      />

      <div className="review-list" aria-live="polite">
        {jobs.length ? (
          jobs.map((job) => {
            const id = text(job.id, "unknown");
            const message = messages[id] ?? text(
              job.message || job.submission?.caption,
              DEFAULT_FACEBOOK_PAGE_MESSAGE,
            );
            const reconciliation = reconciliationDraft(job, reconciliationDrafts[id]);
            const reconciliationArmed = reconciliationConfirmations[id] ===
              facebookPageReconciliationFingerprint(job, reconciliation);
            return (
              <FacebookPageJobCard
                job={job}
                busy={queueBusy || Boolean(busyJobId)}
                message={message}
                confirmationArmed={confirmations[id] ===
                  facebookPagePublishFingerprint(job, message)}
                reconciliation={reconciliation}
                reconciliationArmed={reconciliationArmed}
                jobMessage={jobMessages[id]}
                pagePublishAvailable={pagePublishAvailable}
                pageLink={text(apiStatus?.page?.id) === FACEBOOK_CANONICAL_PAGE_ID
                  ? FACEBOOK_CANONICAL_PAGE_URL
                  : ""}
                key={id}
                onMessageChange={(value) => {
                  setMessages((current) => ({ ...current, [id]: value }));
                  setConfirmations((current) => ({ ...current, [id]: undefined }));
                  setJobMessage(id, undefined);
                }}
                onArmPublish={armPublish}
                onConfirmPublish={publish}
                onCancelPublish={cancelPublish}
                onReconciliationChange={updateReconciliation}
                onArmReconciliation={armReconciliation}
                onConfirmReconciliation={resolveReconciliation}
                onCancelReconciliation={cancelReconciliation}
              />
            );
          })
        ) : (
          <WorkflowEmptyState title={queueBusy ? "Loading Facebook Page jobs" : "No Facebook Page jobs shown"}>
            {queueBusy ? "Checking the Facebook Page publishing queue." : config.empty}
          </WorkflowEmptyState>
        )}
      </div>
      {queueCursorHistory.length > 0 || Boolean(queue?.nextCursor) ? (
        <nav className="auth-actions" aria-label="Facebook Page publishing pages">
          <button
            className="hero-cta"
            type="button"
            disabled={queueBusy || Boolean(busyJobId) || queueCursorHistory.length === 0}
            onClick={() => {
              const history = queueCursorHistory.slice(0, -1);
              const cursor = queueCursorHistory[queueCursorHistory.length - 1] || "";
              void loadQueue(activeStatus, { cursor, history });
            }}
          >
            Previous page
          </button>
          <span className="review-action-note">Page {queueCursorHistory.length + 1}</span>
          <button
            className="hero-cta"
            type="button"
            disabled={queueBusy || Boolean(busyJobId) || !queue?.hasMore || !queue.nextCursor}
            onClick={() => {
              if (!queue?.nextCursor) return;
              void loadQueue(activeStatus, {
                cursor: queue.nextCursor,
                history: [...queueCursorHistory, queueCursor],
              });
            }}
          >
            Next page
          </button>
        </nav>
      ) : null}
    </section>
  );
}
