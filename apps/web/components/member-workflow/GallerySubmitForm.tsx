"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { requireAuth, onAuthStateChange } from "@/lib/supabase/auth";
import { getCurrentProfile, profileIsActive, verifyMemberAccess } from "@/lib/supabase/profile";
import {
  listMyGallerySubmissions,
  uploadMemberGalleryImage,
  withdrawGalleryPublicationConsent,
} from "@/lib/supabase/gallery-submissions";
import { gallerySocialWithdrawalLabel } from "@/lib/gallery/social-consent-withdrawal";
import {
  type GallerySocialDestination,
  type GallerySubmission,
  type MemberAccessResponse,
  type MemberProfile,
  text,
} from "@/lib/supabase/types";
import { formatDateShort, uploadAccess } from "./format";
import { WorkflowEmptyState, WorkflowNotice } from "./WorkflowState";

function SubmissionStatus({ status }: { status?: string | null }) {
  const value = text(status, "pending").toLowerCase();
  return <span className={`submission-status submission-status--${value}`}>{value}</span>;
}

function SubmissionItem({
  item,
  busyDestination,
  armedDestination,
  onWithdraw,
  onCancelWithdrawal,
}: {
  item: GallerySubmission;
  busyDestination?: GallerySocialDestination;
  armedDestination?: GallerySocialDestination;
  onWithdraw: (item: GallerySubmission, destination: GallerySocialDestination) => void;
  onCancelWithdrawal: () => void;
}) {
  const instagramOptIn = item.instagram_opt_in === true;
  const facebookPageOptIn = item.facebook_page_opt_in === true;
  const withdrawals = Array.isArray(item.social_withdrawals) ? item.social_withdrawals : [];
  const sharingLabel = instagramOptIn && facebookPageOptIn
    ? "Instagram and Facebook Page consent"
    : instagramOptIn
      ? "Instagram consent"
      : facebookPageOptIn
        ? "Facebook Page consent"
        : "Site Gallery only";

  return (
    <article className="submission-item">
      <div className="submission-item__head">
        <h3>{text(item.title || item.original_filename, "Untitled image")}</h3>
        <SubmissionStatus status={item.status} />
      </div>
      {item.caption ? <p>{item.caption}</p> : null}
      <div className="submission-meta">
        <span>{formatDateShort(item.created_at, "Unknown date")}</span>
        {item.category ? <span>{item.category}</span> : null}
        <span>{sharingLabel}</span>
      </div>
      {(instagramOptIn || facebookPageOptIn) ? (
        <div className="auth-actions" aria-label={`Publication consent for ${text(item.title || item.original_filename, "this image")}`}>
          {(["instagram", "facebook_page"] as const).map((destination) => {
            const selected = destination === "instagram" ? instagramOptIn : facebookPageOptIn;
            if (!selected) return null;
            const withdrawn = withdrawals.find((status) => status.destination === destination);
            const label = destination === "instagram" ? "Instagram" : "Facebook Page";
            if (withdrawn) {
              return <span className="review-action-note" key={destination}>{label}: {gallerySocialWithdrawalLabel(withdrawn)}</span>;
            }
            const armed = armedDestination === destination;
            return (
              <span key={destination}>
                <button
                  className="hero-cta"
                  type="button"
                  disabled={Boolean(busyDestination)}
                  onClick={() => onWithdraw(item, destination)}
                >
                  {busyDestination === destination
                    ? "Withdrawing…"
                    : armed
                      ? `Confirm ${label} withdrawal`
                      : `Withdraw ${label} consent`}
                </button>
                {armed ? (
                  <button className="hero-cta" type="button" disabled={Boolean(busyDestination)} onClick={onCancelWithdrawal}>
                    Cancel
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

export function GallerySubmitForm() {
  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState<"signed-out" | "needs-verification" | "allowed">("signed-out");
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [memberAccess, setMemberAccess] = useState<MemberAccessResponse | null>(null);
  const [submissions, setSubmissions] = useState<GallerySubmission[]>([]);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [instagramOptIn, setInstagramOptIn] = useState(false);
  const [facebookPageOptIn, setFacebookPageOptIn] = useState(false);
  const [uploadRightsConfirmed, setUploadRightsConfirmed] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [withdrawalArmed, setWithdrawalArmed] = useState<{ submissionId: string; destination: GallerySocialDestination } | null>(null);
  const [withdrawalBusy, setWithdrawalBusy] = useState<{ submissionId: string; destination: GallerySocialDestination } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submissionsError, setSubmissionsError] = useState("");
  const outcomeRef = useRef<HTMLDivElement>(null);

  const loadSubmissions = useCallback(async () => {
    setSubmissionsError("");
    const result = await listMyGallerySubmissions();
    if (!result.ok) {
      setSubmissions([]);
      setSubmissionsError(result.message || "Submissions could not be loaded.");
      return;
    }
    setSubmissions(Array.isArray(result.data) ? result.data : []);
  }, []);

  const checkAccess = useCallback(async ({ refresh = false }: { refresh?: boolean } = {}) => {
    setBusy(true);
    setError("");
    setStatus("");

    const auth = await requireAuth();
    if (!auth.ok) {
      setProfile(null);
      setMemberAccess(null);
      setMode("signed-out");
      setBusy(false);
      return;
    }

    const accessResult = await verifyMemberAccess({ refreshDiscord: refresh });
    if (!accessResult.ok) setError(accessResult.message || "Member verification could not be checked.");
    setMemberAccess(accessResult.data || null);

    const profileResult = await getCurrentProfile();
    const nextProfile = accessResult.data?.profile || profileResult.data || null;
    setProfile(nextProfile);

    if (!profileResult.ok || !profileIsActive(nextProfile, accessResult.data)) {
      setMode("needs-verification");
      setBusy(false);
      return;
    }

    setMode("allowed");
    await loadSubmissions();
    setBusy(false);
  }, [loadSubmissions]);

  useEffect(() => {
    void Promise.resolve().then(() => checkAccess());
    const subscription = onAuthStateChange(() => {
      void checkAccess();
    });
    return () => {
      subscription.data?.subscription?.unsubscribe();
    };
  }, [checkAccess]);

  async function submitImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("Submitting image for moderation.");

    if (!uploadRightsConfirmed) {
      setError("Confirm the upload-rights statement before submitting this image.");
      setStatus("");
      setBusy(false);
      return;
    }
    if ((instagramOptIn || facebookPageOptIn) && file?.type.toLowerCase() !== "image/jpeg") {
      setError("Instagram or Facebook Page publishing requires a JPEG. Uncheck both destinations to submit a PNG or WebP image to the Gallery only.");
      setStatus("");
      setBusy(false);
      return;
    }

    const result = await uploadMemberGalleryImage(file, {
      title,
      caption,
      category,
      instagramOptIn,
      facebookPageOptIn,
      uploadRightsConfirmed,
    });
    if (!result.ok) {
      setError(result.message || "Upload failed.");
      setStatus("");
      setBusy(false);
      return;
    }

    setTitle("");
    setCaption("");
    setCategory("");
    setFile(null);
    setInstagramOptIn(false);
    setFacebookPageOptIn(false);
    setUploadRightsConfirmed(false);
    setFileInputKey((current) => current + 1);
    await checkAccess();
    await loadSubmissions();
    setStatus("Image submitted for moderation. It will not appear in the public Gallery until Moderator approval.");
    setBusy(false);
    requestAnimationFrame(() => outcomeRef.current?.focus());
  }

  async function withdrawConsent(item: GallerySubmission, destination: GallerySocialDestination) {
    const submissionId = text(item.id);
    if (!submissionId) return;
    if (withdrawalArmed?.submissionId !== submissionId || withdrawalArmed.destination !== destination) {
      setWithdrawalArmed({ submissionId, destination });
      setStatus(`Review the ${destination === "instagram" ? "Instagram" : "Facebook Page"} withdrawal, then confirm.`);
      setError("");
      requestAnimationFrame(() => outcomeRef.current?.focus());
      return;
    }
    setWithdrawalBusy({ submissionId, destination });
    setError("");
    setStatus("Withdrawing destination-specific publication consent.");
    const result = await withdrawGalleryPublicationConsent(submissionId, destination);
    if (!result.ok) {
      setError(result.message || "Publication consent could not be withdrawn.");
      setStatus("");
    } else {
      setStatus(result.message || "Publication consent was withdrawn.");
      await loadSubmissions();
    }
    setWithdrawalArmed(null);
    setWithdrawalBusy(null);
    requestAnimationFrame(() => outcomeRef.current?.focus());
  }

  const allowed = mode === "allowed";
  const access = uploadAccess(profile, memberAccess);
  const gateTitle = mode === "signed-out" ? "Login Required" : allowed ? "Upload Ready" : "Member Verification Required";
  const gateState = mode === "signed-out" ? "Signed out" : allowed ? "Ready" : "Needs review";
  const gateMessage =
    mode === "signed-out"
      ? "Choose a sign-in method before submitting images."
      : allowed
        ? "Upload access verified."
        : access.guidance;

  return (
    <>
      {!allowed ? (
        <section className="glass-card glass-card--primary glass-pad auth-panel" id="uploadGate" aria-busy={busy}>
          <div className="auth-panel__head">
            <div>
              <p className="kicker">Access Check</p>
              <h2 className="section-title" id="uploadGateTitle">{gateTitle}</h2>
            </div>
            <p className="status-pill" id="uploadGateState">{busy ? "Loading" : gateState}</p>
          </div>
          <WorkflowNotice id="uploadGateMessage">
            {busy ? "Checking sign-in and member verification." : gateMessage}
          </WorkflowNotice>
          <div className="auth-actions" id="uploadGateActions">
            {mode === "signed-out" ? <Link className="hero-cta hero-cta--primary" href="/auth">Login</Link> : null}
            {mode === "needs-verification" ? (
              <>
                <button className="hero-cta hero-cta--primary" type="button" onClick={() => checkAccess({ refresh: true })} disabled={busy}>
                  Check member verification
                </button>
                <Link className="hero-cta" href="/account">Open Account</Link>
              </>
            ) : null}
          </div>
          <div className="requirement-list">
            <h3 className="section-title section-title--sm">Required before upload</h3>
            <ul className="list-stack">
              <li>Discord server membership.</li>
              <li>Completed Discord verification.</li>
              <li>Mōchirīī - WWM.</li>
              <li>✅Verified.</li>
              <li>Or moderator-approved member verification.</li>
              <li>Active website member status.</li>
            </ul>
          </div>
          <WorkflowNotice tone="danger" role="alert" hidden={!error}>{error}</WorkflowNotice>
        </section>
      ) : null}

      {allowed ? (
        <div className="grid-12 grid-gap" id="uploadPanel" aria-busy={busy}>
          <section className="col-8">
            <form className="glass-card glass-card--primary glass-pad auth-form upload-form" id="uploadForm" onSubmit={submitImage}>
              <p className="kicker">Pending Moderation</p>
              <h2 className="section-title">Upload Image</h2>
              <p className="muted">Accepted file types are JPEG, PNG & WebP, up to 8 MiB. Public Meta destinations require JPEG.</p>
              <WorkflowNotice tone={access.ok ? "success" : "warning"}>{access.guidance}</WorkflowNotice>

              <label className="form-field">
                <span>Image file</span>
                <input
                  key={fileInputKey}
                  id="imageFile"
                  name="imageFile"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  disabled={busy}
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
              </label>

              <label className="form-field">
                <span>Title</span>
                <input id="title" name="title" maxLength={80} autoComplete="off" value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
              </label>

              <label className="form-field">
                <span>Caption</span>
                <textarea id="caption" name="caption" maxLength={300} rows={4} value={caption} disabled={busy} onChange={(event) => setCaption(event.target.value)} />
              </label>

              <label className="form-field">
                <span>Category</span>
                <select id="category" name="category" value={category} disabled={busy} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">Choose if useful</option>
                  <option value="portraits">Portraits</option>
                  <option value="gatherings">Gatherings</option>
                  <option value="action">Action</option>
                  <option value="scenery">Scenery</option>
                  <option value="companions">Companions</option>
                </select>
              </label>

              <label className="form-check">
                <input
                  id="uploadRightsConfirmed"
                  name="uploadRightsConfirmed"
                  type="checkbox"
                  checked={uploadRightsConfirmed}
                  required
                  disabled={busy}
                  onChange={(event) => setUploadRightsConfirmed(event.target.checked)}
                />
                <span>I confirm that I own this image or may submit it, and that I have permission involving any identifiable people shown.</span>
              </label>

              <label className="form-check">
                <input
                  id="instagramOptIn"
                  name="instagramOptIn"
                  type="checkbox"
                  checked={instagramOptIn}
                  disabled={busy}
                  onChange={(event) => setInstagramOptIn(event.target.checked)}
                />
                <span>
                  I authorize Mōchirīī moderators to publish this image to the official public Instagram account after separate Gallery approval and publication confirmation. Moderators may edit the caption and required alt text. Public or third-party copies may persist after Mōchirīī removes its own copy. Withdrawal and deletion instructions are at mochirii.com.
                </span>
              </label>

              <label className="form-check">
                <input
                  id="facebookPageOptIn"
                  name="facebookPageOptIn"
                  type="checkbox"
                  checked={facebookPageOptIn}
                  disabled={busy}
                  onChange={(event) => setFacebookPageOptIn(event.target.checked)}
                />
                <span>
                  I authorize Mōchirīī moderators to publish this image and a moderator-edited caption to the official public Facebook Page after separate Gallery approval and publication confirmation. A moderator may then share the Page post manually to the Mōchirīī Guild Facebook group. Public or third-party copies may persist after Mōchirīī removes its own copy. Withdrawal and deletion instructions are at mochirii.com.
                </span>
              </label>

              {(instagramOptIn || facebookPageOptIn) ? (
                <WorkflowNotice tone="warning">
                  Public publishing is optional and destination-specific. Upload and initial Gallery approval do not contact Meta. Each selected destination requires a later moderator confirmation.
                </WorkflowNotice>
              ) : null}

              <div className="auth-actions">
                <button className="hero-cta hero-cta--primary" type="submit" disabled={busy}>Submit for Review</button>
              </div>

              <div ref={outcomeRef} tabIndex={-1} aria-label="Gallery submission outcome">
                <WorkflowNotice id="uploadStatus" hidden={!status}>{status}</WorkflowNotice>
                <WorkflowNotice id="uploadError" tone="danger" role="alert" hidden={!error}>{error}</WorkflowNotice>
              </div>
            </form>
          </section>

          <aside className="col-4">
            <section className="glass-card glass-card--soft glass-pad auth-panel" aria-labelledby="mySubmissionsTitle">
              <div className="auth-panel__head">
                <div>
                  <p className="kicker">My Gallery</p>
                  <h2 className="section-title section-title--sm" id="mySubmissionsTitle">My Submissions</h2>
                </div>
              </div>
              <div className="submission-list" id="submissionsList" aria-live="polite">
                {submissions.length ? submissions.map((item) => (
                  <SubmissionItem
                    item={item}
                    key={item.id}
                    busyDestination={withdrawalBusy?.submissionId === item.id ? withdrawalBusy.destination : undefined}
                    armedDestination={withdrawalArmed?.submissionId === item.id ? withdrawalArmed.destination : undefined}
                    onWithdraw={withdrawConsent}
                    onCancelWithdrawal={() => {
                      setWithdrawalArmed(null);
                      setStatus("Publication-consent withdrawal canceled.");
                    }}
                  />
                )) : (
                  <WorkflowEmptyState title={busy ? "Loading submissions" : "No submissions yet"}>
                    {busy ? "Checking your member gallery submissions." : "Submitted images will appear here after you send them for review."}
                  </WorkflowEmptyState>
                )}
              </div>
              <WorkflowNotice id="submissionsError" tone="danger" role="alert" hidden={!submissionsError}>{submissionsError}</WorkflowNotice>
            </section>
          </aside>
          <div className="col-divider" aria-hidden="true" />
        </div>
      ) : null}
    </>
  );
}
