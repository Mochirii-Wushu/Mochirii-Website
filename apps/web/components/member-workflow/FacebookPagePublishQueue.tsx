"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentSession } from "@/lib/supabase/auth";
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
import {
  facebookPagePublishConfirmation,
  facebookPageReconciliationFingerprint,
  normalizeFacebookPermalink,
  type FacebookReconciliationDraft,
} from "@/lib/gallery/facebook-action-confirmation";
import { validateSocialPublicationCopy } from "@/lib/gallery/social-publication-copy";
import type { FacebookPagePublicationRequest } from "@/lib/gallery/social-publication-request";
import { formatBytes, formatDate } from "./format";
import { WorkflowEmptyState, WorkflowNotice } from "./WorkflowState";

const FACEBOOK_GROUP_URL = "https://www.facebook.com/groups/mochiriiguild";
const DEFAULT_FACEBOOK_PAGE_MESSAGE = "A pretty guild showcase from Mōchirīī.";
const PAGE_SIZE = 25;

const statuses = [
  { id: "queued", label: "Queued", empty: "No Facebook Page-ready images." },
  { id: "failed", label: "Failed", empty: "No failed Facebook Page jobs." },
  { id: "reconcile_required", label: "Needs reconciliation", empty: "No Facebook Page jobs need reconciliation." },
  { id: "published", label: "Published", empty: "No published Facebook Page posts." },
  { id: "ineligible", label: "Ineligible", empty: "No ineligible Facebook Page jobs." },
  { id: "canceled", label: "Canceled", empty: "No canceled Facebook Page jobs." },
  { id: "all", label: "All", empty: "No Facebook Page publishing jobs." },
] as const;

type StatusId = (typeof statuses)[number]["id"];
type JobMessage = { kind: "status" | "error" | "success"; message: string };

function statusConfig(value: unknown) {
  const status = text(value, "queued").toLowerCase();
  return statuses.find((entry) => entry.id === status) || statuses[0];
}

function initialReconciliation(job: FacebookPagePublishJob): FacebookReconciliationDraft {
  return {
    resolution: "",
    note: "",
    facebookPhotoId: text(job.facebookPhotoId),
    facebookPostId: text(job.facebookPostId),
    facebookPermalink: text(job.facebookPermalink),
  };
}

function reconciliationError(draft: FacebookReconciliationDraft) {
  if (!draft.resolution) return "Choose whether a matching Page post exists.";
  if (!draft.note.trim()) return "Record what you inspected on the official Page.";
  if (
    draft.resolution === "confirmed_published" &&
    !draft.facebookPhotoId.trim() && !draft.facebookPostId.trim()
  ) return "Enter the verified Facebook photo or post ID.";
  if (
    draft.resolution === "confirmed_not_published" &&
    (draft.facebookPhotoId.trim() || draft.facebookPostId.trim() || draft.facebookPermalink.trim())
  ) return "Remove publication identifiers when no matching Page post exists.";
  if (draft.facebookPermalink.trim() && !normalizeFacebookPermalink(draft.facebookPermalink)) {
    return "Use a canonical Facebook post permalink.";
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
  const ready = Boolean(status?.ready && status.configured && status.publishEnabled);
  return (
    <div className={`review-decision facebook-page-api-status facebook-page-api-status--${ready ? "ready" : status?.configured ? "review" : "missing"}`}>
      <div>
        <strong>Facebook Page API: {ready ? "Ready" : status?.configured ? "Blocked" : "Not configured"}</strong>
        <p>{text(status?.message, "Facebook Page diagnostics have not been checked.")}</p>
      </div>
      <dl className="review-meta" aria-label="Facebook Page API diagnostic details">
        {[
          ["Graph version", status?.apiVersion || "Not checked"],
          ["Pinned identity", status?.identityMatches ? "Passed" : "Not passed"],
          ["CREATE_CONTENT", status?.createContentTaskVerified ? "Passed" : "Not passed"],
          ["Token binding", status?.tokenBindingVerified ? "Passed" : "Not passed"],
          ["Required scopes", status?.scopesVerified ? "Passed" : "Not passed"],
          ["Expiry", status?.expiryVerified ? "Passed" : "Not passed"],
          ["Server activation", status?.publishEnabled ? "On" : "Off"],
          ["Checked", status?.checkedAt ? formatDate(status.checkedAt, "Not checked") : "Not checked"],
        ].map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
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
  publishAvailable,
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
  reconciliation: FacebookReconciliationDraft;
  reconciliationArmed: boolean;
  jobMessage?: JobMessage;
  publishAvailable: boolean;
  onMessageChange: (value: string) => void;
  onArmPublish: (job: FacebookPagePublishJob) => void;
  onConfirmPublish: (job: FacebookPagePublishJob) => void;
  onCancelPublish: (job: FacebookPagePublishJob) => void;
  onReconciliationChange: (draft: FacebookReconciliationDraft) => void;
  onArmReconciliation: (job: FacebookPagePublishJob) => void;
  onConfirmReconciliation: (job: FacebookPagePublishJob) => void;
  onCancelReconciliation: (job: FacebookPagePublishJob) => void;
}) {
  const submission = job.submission || {};
  const status = text(job.status, "queued").toLowerCase();
  const retryable = status === "queued" || status === "failed";
  const reconcilable = status === "reconcile_required";
  const permalink = normalizeFacebookPermalink(job.facebookPermalink);
  const verifiedPublished = status === "published" && Boolean(permalink);
  const validation = validateSocialPublicationCopy([message]);
  const captionPresent = Boolean(message.trim());
  const draftError = reconciliationError(reconciliation);

  return (
    <article className={`review-item review-item--${status}`} data-facebook-page-job-id={job.id || ""} tabIndex={-1}>
      <div className="review-preview">
        {job.thumbnailUrl ? (
          <div className="review-preview__empty">
            <span>Approved Gallery thumbnail available</span>
            <a className="hero-cta" href={job.thumbnailUrl} target="_blank" rel="noopener noreferrer">Open approved Gallery preview</a>
          </div>
        ) : <div className="review-preview__empty"><span>Approved preview unavailable</span></div>}
      </div>
      <div className="review-details">
        <div className="review-details__head">
          <div>
            <h3>{text(submission.title || submission.caption, "Untitled image")}</h3>
            <p className="muted">{submission.uploader?.displayName || "Mōchirīī Member"} · {text(submission.source, "website")}</p>
          </div>
          <span className={`submission-status submission-status--${status}`}>{status.replaceAll("_", " ")}</span>
        </div>
        {job.eligibilityReason ? <p className="review-decision">Eligibility: {job.eligibilityReason}</p> : null}
        {jobMessage ? (
          <p className={`review-action-message review-action-message--${jobMessage.kind}`} role={jobMessage.kind === "error" ? "alert" : "status"}>
            {jobMessage.message}
          </p>
        ) : null}
        {permalink ? <p><a href={permalink} target="_blank" rel="noopener noreferrer">Open verified Facebook Page post</a></p> : null}
        {verifiedPublished ? (
          <div className="review-decision" data-facebook-group-handoff>
            <strong>Manual Page-to-Group handoff</strong>
            <p>After inspecting the verified Page post above, open the official Guild group and share that Page post manually. No Groups API is used.</p>
            <a href={FACEBOOK_GROUP_URL} target="_blank" rel="noopener noreferrer">Open Mōchirīī Guild Facebook group</a>
          </div>
        ) : null}
        <dl className="review-meta">
          {[
            ["Consent", submission.facebookPageOptIn ? "Facebook Page destination selected" : "No current consent"],
            ["Type", submission.mimeType || "Unknown"],
            ["Size", formatBytes(submission.sizeBytes)],
            ["Attempts", String(job.attemptCount || 0)],
            ["Queued", formatDate(job.createdAt, "Not set")],
            ["Completed", job.publishedAt ? formatDate(job.publishedAt, "Not completed") : "Not completed"],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {retryable ? (
          <>
            <label className="form-field">
              <span>Final Facebook Page caption</span>
              <textarea maxLength={5000} rows={4} value={message} disabled={busy} onChange={(event) => onMessageChange(event.target.value.slice(0, 5000))} />
            </label>
            {!captionPresent ? <p className="review-action-note" role="alert">A final Facebook Page caption is required.</p> : null}
            {!validation.ok ? <p className="review-action-note" role="alert">{validation.message}</p> : null}
            {confirmationArmed ? (
              <div className="review-action-note" role="status">
                <strong>Second moderator confirmation</strong>
                <p>{message || "No caption"}</p>
                <p>This creates one public Page post. Editing this caption cancels the confirmation.</p>
              </div>
            ) : null}
            <div className="auth-actions">
              <button
                className="hero-cta hero-cta--primary"
                type="button"
                disabled={busy || !publishAvailable || !captionPresent || !validation.ok}
                onClick={() => confirmationArmed ? onConfirmPublish(job) : onArmPublish(job)}
              >
                {confirmationArmed ? "Confirm public Page post" : publishAvailable ? "Prepare Page publication" : "Page publishing blocked"}
              </button>
              {confirmationArmed ? <button className="hero-cta" type="button" disabled={busy} onClick={() => onCancelPublish(job)}>Cancel</button> : null}
            </div>
          </>
        ) : null}
        {reconcilable ? (
          <section className="review-history" aria-label="Facebook Page reconciliation">
            <h4>Inspect before reconciliation</h4>
            <p className="review-action-note" role="alert">Meta may have received this image. Inspect the official Page; never retry this job automatically.</p>
            <label className="form-field">
              <span>Inspection outcome</span>
              <select
                value={reconciliation.resolution}
                disabled={busy}
                onChange={(event) => {
                  const resolution = event.target.value as FacebookPageReconciliationResolution | "";
                  onReconciliationChange(resolution === "confirmed_not_published"
                    ? { ...reconciliation, resolution, facebookPhotoId: "", facebookPostId: "", facebookPermalink: "" }
                    : { ...reconciliation, resolution });
                }}
              >
                <option value="">Choose after inspecting the Page</option>
                <option value="confirmed_not_published">No matching Page post found</option>
                <option value="confirmed_published">Matching Page post confirmed</option>
              </select>
            </label>
            <label className="form-field">
              <span>Inspection note</span>
              <textarea maxLength={500} rows={3} value={reconciliation.note} disabled={busy} onChange={(event) => onReconciliationChange({ ...reconciliation, note: event.target.value.slice(0, 500) })} />
            </label>
            {reconciliation.resolution === "confirmed_published" ? (
              <>
                <label className="form-field"><span>Facebook photo ID</span><input maxLength={255} value={reconciliation.facebookPhotoId} disabled={busy} onChange={(event) => onReconciliationChange({ ...reconciliation, facebookPhotoId: event.target.value.slice(0, 255) })} /></label>
                <label className="form-field"><span>Facebook post ID</span><input maxLength={255} value={reconciliation.facebookPostId} disabled={busy} onChange={(event) => onReconciliationChange({ ...reconciliation, facebookPostId: event.target.value.slice(0, 255) })} /></label>
                <label className="form-field"><span>Canonical Facebook permalink (optional)</span><input type="url" maxLength={1000} value={reconciliation.facebookPermalink} disabled={busy} onChange={(event) => onReconciliationChange({ ...reconciliation, facebookPermalink: event.target.value.slice(0, 1000) })} /></label>
              </>
            ) : null}
            {reconciliationArmed ? <p className="review-action-note" role="status">Confirm this exact inspection result. No provider publication request will be sent.</p> : null}
            <div className="auth-actions">
              <button className="hero-cta hero-cta--primary" type="button" disabled={busy || Boolean(draftError)} onClick={() => reconciliationArmed ? onConfirmReconciliation(job) : onArmReconciliation(job)}>
                {reconciliationArmed ? "Confirm reconciliation" : "Prepare reconciliation"}
              </button>
              {reconciliationArmed ? <button className="hero-cta" type="button" disabled={busy} onClick={() => onCancelReconciliation(job)}>Cancel</button> : null}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}

export function FacebookPagePublishQueue() {
  const [activeStatus, setActiveStatus] = useState<StatusId>("queued");
  const [queue, setQueue] = useState<FacebookPagePublishQueueData | null>(null);
  const [apiStatus, setApiStatus] = useState<FacebookPageApiStatus | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [busyJobId, setBusyJobId] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("Facebook Page queue has not loaded yet.");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [confirmations, setConfirmations] = useState<Record<string, FacebookPagePublicationRequest | undefined>>({});
  const [reconciliationDrafts, setReconciliationDrafts] = useState<Record<string, FacebookReconciliationDraft | undefined>>({});
  const [reconciliationConfirmations, setReconciliationConfirmations] = useState<Record<string, string | undefined>>({});
  const [jobMessages, setJobMessages] = useState<Record<string, JobMessage | undefined>>({});
  const mountedRef = useRef(true);
  const outcomeRef = useRef<HTMLDivElement>(null);

  const focusOutcome = () => requestAnimationFrame(() => outcomeRef.current?.focus());
  const setJobMessage = (jobId: string, message: JobMessage | undefined) =>
    setJobMessages((current) => ({ ...current, [jobId]: message }));

  const loadQueue = useCallback(async (
    requestedStatus: StatusId,
    options: { cursor?: string; history?: string[]; successMessage?: string } = {},
  ) => {
    const config = statusConfig(requestedStatus);
    setActiveStatus(config.id);
    setQueueBusy(true);
    setError("");
    setConfirmations({});
    setReconciliationConfirmations({});
    setStatusMessage(`Loading ${config.label.toLowerCase()} Facebook Page jobs.`);
    const result = await listFacebookPagePublishQueue({
      status: config.id,
      cursor: options.cursor || "",
      pageSize: PAGE_SIZE,
    });
    if (!mountedRef.current) return;
    if (!result.ok) {
      setQueue(null);
      setError(result.message || "Facebook Page queue could not be loaded.");
      setStatusMessage("");
    } else {
      const jobs = Array.isArray(result.data?.jobs) ? result.data.jobs : [];
      setQueue({ ...(result.data || { jobs: [] }), jobs });
      setCursor(options.cursor || "");
      setCursorHistory(options.history || []);
      setStatusMessage(options.successMessage || (jobs.length
        ? `${jobs.length} ${config.label.toLowerCase()} Facebook Page job${jobs.length === 1 ? "" : "s"} shown.`
        : config.empty));
    }
    setQueueBusy(false);
  }, []);

  const loadApiStatus = useCallback(async () => {
    setApiBusy(true);
    const result = await checkFacebookPageApiStatus();
    if (!mountedRef.current) return;
    if (!result.ok) setError(result.message || "Facebook Page diagnostics could not be checked.");
    else {
      setApiStatus(result.data || null);
      setStatusMessage(result.message || "Facebook Page diagnostics checked.");
    }
    setApiBusy(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const initialLoad = window.setTimeout(() => {
      void Promise.allSettled([loadQueue("queued"), loadApiStatus()]);
    }, 0);
    return () => {
      window.clearTimeout(initialLoad);
      mountedRef.current = false;
    };
  }, [loadApiStatus, loadQueue]);

  async function moderatorUserId() {
    const session = await getCurrentSession();
    const id = text(session.data?.session?.user?.id).toLowerCase();
    if (!session.ok || !id) throw new Error("Sign in again before confirming publication.");
    return id;
  }

  async function armPublish(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    const message = (messages[jobId] ?? text(job.message || job.submission?.caption, DEFAULT_FACEBOOK_PAGE_MESSAGE)).trim();
    const validation = validateSocialPublicationCopy([message]);
    if (!jobId || !message || !validation.ok) {
      const reason = !jobId
        ? "Choose a Facebook Page job."
        : !message
          ? "A final Facebook Page caption is required."
        : validation.message || "URLs are not allowed in Meta publication copy.";
      setError(reason);
      if (jobId) setJobMessage(jobId, { kind: "error", message: reason });
      focusOutcome();
      return;
    }
    try {
      const request = await facebookPagePublishConfirmation(job, await moderatorUserId(), message);
      setMessages((current) => ({ ...current, [jobId]: message }));
      setConfirmations((current) => ({ ...current, [jobId]: request }));
      setJobMessage(jobId, { kind: "status", message: "Second confirmation prepared for this exact Page caption and job revision." });
      setError("");
      focusOutcome();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publication confirmation could not be prepared.");
      focusOutcome();
    }
  }

  async function publish(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    const armed = confirmations[jobId];
    const message = messages[jobId] ?? text(job.message || job.submission?.caption, DEFAULT_FACEBOOK_PAGE_MESSAGE);
    if (!armed) return armPublish(job);
    try {
      const current = await facebookPagePublishConfirmation(job, await moderatorUserId(), message);
      if (current.confirmation_fingerprint !== armed.confirmation_fingerprint) return armPublish(job);
      setBusyJobId(jobId);
      setConfirmations((existing) => ({ ...existing, [jobId]: undefined }));
      setJobMessage(jobId, { kind: "status", message: "Sending one approved image to the official Facebook Page." });
      const result = await publishFacebookPageGallerySubmission(current);
      if (!result.ok) {
        setError(result.message || "Facebook Page publication could not be confirmed.");
        setJobMessage(jobId, { kind: "error", message: result.message || "Facebook Page publication could not be confirmed. Refresh before any further action." });
      } else {
        setStatusMessage(result.message || "Image published to the Facebook Page.");
        await loadQueue(activeStatus, { successMessage: result.message || "Image published to the Facebook Page." });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Facebook Page publication failed.");
    } finally {
      setBusyJobId("");
      focusOutcome();
    }
  }

  function updateReconciliation(jobId: string, draft: FacebookReconciliationDraft) {
    setReconciliationDrafts((current) => ({ ...current, [jobId]: draft }));
    setReconciliationConfirmations((current) => ({ ...current, [jobId]: undefined }));
    setJobMessage(jobId, undefined);
  }

  async function armReconciliation(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    const draft = reconciliationDrafts[jobId] || initialReconciliation(job);
    const draftValidation = reconciliationError(draft);
    if (!jobId || draftValidation) {
      setError(draftValidation || "Choose a Facebook Page reconciliation job.");
      focusOutcome();
      return;
    }
    const fingerprint = await facebookPageReconciliationFingerprint(job, draft);
    setReconciliationConfirmations((current) => ({
      ...current,
      [jobId]: fingerprint,
    }));
    setJobMessage(jobId, { kind: "status", message: "Reconciliation prepared for this exact inspected result." });
    setError("");
    focusOutcome();
  }

  async function reconcile(job: FacebookPagePublishJob) {
    const jobId = text(job.id);
    const draft = reconciliationDrafts[jobId] || initialReconciliation(job);
    const fingerprint = await facebookPageReconciliationFingerprint(job, draft);
    if (reconciliationConfirmations[jobId] !== fingerprint) return armReconciliation(job);
    if (!draft.resolution) return;
    setBusyJobId(jobId);
    setReconciliationConfirmations((current) => ({ ...current, [jobId]: undefined }));
    const result = await resolveFacebookPagePublishReconciliation({
      jobId,
      resolution: draft.resolution,
      note: draft.note,
      facebookPhotoId: draft.facebookPhotoId,
      facebookPostId: draft.facebookPostId,
      facebookPermalink: draft.facebookPermalink,
      confirmReconciliation: true,
    });
    if (!result.ok) setError(result.message || "Facebook Page reconciliation could not be recorded.");
    else await loadQueue(activeStatus, { successMessage: result.message || "Facebook Page reconciliation recorded." });
    setBusyJobId("");
    focusOutcome();
  }

  const jobs = Array.isArray(queue?.jobs) ? queue.jobs : [];
  const config = statusConfig(activeStatus);
  const publishAvailable = Boolean(apiStatus?.ready && apiStatus.configured && apiStatus.publishEnabled);
  return (
    <section className="glass-card glass-card--primary glass-pad auth-panel" id="facebookPageQueuePanel" aria-busy={queueBusy || Boolean(busyJobId)}>
      <div className="auth-panel__head">
        <div><p className="kicker">Facebook Page Queue</p><h2 className="section-title">Approved Page Publishing</h2></div>
        <button className="hero-cta" type="button" disabled={queueBusy || Boolean(busyJobId)} onClick={() => loadQueue(activeStatus)}>Refresh</button>
      </div>
      <p className="lede">Gallery approval never publishes externally. Each Page post requires this separate destination-specific confirmation.</p>
      <div className="queue-tabs" role="group" aria-label="Facebook Page publishing queues">
        {statuses.map((status) => (
          <button className="queue-tab" type="button" aria-pressed={activeStatus === status.id} disabled={queueBusy || Boolean(busyJobId)} key={status.id} onClick={() => loadQueue(status.id)}>
            {status.label} - {Number(queue?.summary?.[status.id === "all" ? "total" : status.id] || 0)}
          </button>
        ))}
      </div>
      <div ref={outcomeRef} tabIndex={-1} aria-label="Facebook Page queue outcome">
        <WorkflowNotice hidden={!statusMessage}>{statusMessage}</WorkflowNotice>
        <WorkflowNotice tone="danger" role="alert" hidden={!error}>{error}</WorkflowNotice>
      </div>
      <FacebookPageApiStatusCard status={apiStatus} busy={apiBusy || Boolean(busyJobId)} onRefresh={() => void loadApiStatus()} />
      <div className="review-list" aria-live="polite" aria-atomic="false" tabIndex={-1}>
        {jobs.length ? jobs.map((job) => {
          const id = text(job.id, "unknown");
          const message = messages[id] ?? text(job.message || job.submission?.caption, DEFAULT_FACEBOOK_PAGE_MESSAGE);
          const reconciliation = reconciliationDrafts[id] || initialReconciliation(job);
          return (
            <FacebookPageJobCard
              key={id}
              job={job}
              busy={queueBusy || Boolean(busyJobId)}
              message={message}
              confirmationArmed={Boolean(confirmations[id])}
              reconciliation={reconciliation}
              reconciliationArmed={Boolean(reconciliationConfirmations[id])}
              jobMessage={jobMessages[id]}
              publishAvailable={publishAvailable}
              onMessageChange={(value) => {
                setMessages((current) => ({ ...current, [id]: value }));
                setConfirmations((current) => ({ ...current, [id]: undefined }));
                setJobMessage(id, undefined);
              }}
              onArmPublish={(item) => void armPublish(item)}
              onConfirmPublish={(item) => void publish(item)}
              onCancelPublish={() => {
                setConfirmations((current) => ({ ...current, [id]: undefined }));
                setJobMessage(id, undefined);
              }}
              onReconciliationChange={(draft) => updateReconciliation(id, draft)}
              onArmReconciliation={(item) => void armReconciliation(item)}
              onConfirmReconciliation={(item) => void reconcile(item)}
              onCancelReconciliation={() => {
                setReconciliationConfirmations((current) => ({ ...current, [id]: undefined }));
                setJobMessage(id, undefined);
              }}
            />
          );
        }) : (
          <WorkflowEmptyState title={queueBusy ? "Loading Facebook Page jobs" : "No Facebook Page jobs shown"}>
            {queueBusy ? "Checking the Facebook Page publishing queue." : config.empty}
          </WorkflowEmptyState>
        )}
      </div>
      {(cursorHistory.length || queue?.nextCursor) ? (
        <nav className="auth-actions" aria-label="Facebook Page publishing pages">
          <button className="hero-cta" type="button" disabled={queueBusy || !cursorHistory.length} onClick={() => {
            const history = cursorHistory.slice(0, -1);
            void loadQueue(activeStatus, { cursor: cursorHistory.at(-1) || "", history });
          }}>Previous page</button>
          <span className="review-action-note">Page {cursorHistory.length + 1}</span>
          <button className="hero-cta" type="button" disabled={queueBusy || !queue?.hasMore || !queue.nextCursor} onClick={() => {
            if (queue?.nextCursor) void loadQueue(activeStatus, { cursor: queue.nextCursor, history: [...cursorHistory, cursor] });
          }}>Next page</button>
        </nav>
      ) : null}
    </section>
  );
}
