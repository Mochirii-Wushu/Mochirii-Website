"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginAuthLoadGeneration,
  invalidateAuthLoadGeneration,
  isCurrentAuthLoadGeneration,
} from "@/lib/auth-load-generation";
import { measureAuthenticatedRouteTask } from "@/lib/observability/authenticated-route-timing";
import {
  clearPrivateSpinnerSession,
  openPrivateSpinnerSession,
  requireAuth,
  onAuthStateChange,
} from "@/lib/supabase/auth";
import {
  checkInstagramApiStatus,
  checkLeaderGalleryModerationAccess,
  deleteRejectedGallerySubmission,
  listGalleryReviewQueue,
  listInstagramPublishQueue,
  markInstagramGallerySubmissionShared,
  moderateGallerySubmission,
  publishInstagramGallerySubmission,
  prepareGalleryReviewPreview,
  reviewMemberVerification,
} from "@/lib/supabase/moderation";
import {
  createGalleryPublicationMedia,
  createGalleryThumbnail,
  type GalleryModerationMedia,
} from "@/lib/gallery-thumbnail";
import {
  text,
  type GalleryReviewQueue,
  type GalleryReviewSubmission,
  type InstagramApiStatus,
  type InstagramPublishJob,
  type InstagramPublishQueue,
  type MemberAccessVerification,
  type ModerationStatus,
} from "@/lib/supabase/types";
import {
  InstagramApiStatusCard,
  InstagramJobCard,
  MemberVerificationResult,
  QueueSummary,
  SubmissionCard,
  instagramStatusConfig,
  instagramStatuses,
  memberVerificationMethods,
  normalizeStatus,
  statusConfig,
  statuses,
  type InstagramAction,
  type InstagramJobMessage,
} from "./LeaderDashboardParts";
import { WorkflowEmptyState, WorkflowNotice } from "./WorkflowState";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type GalleryThumbnailState = "all" | "missing" | "ready";
type GalleryPreviewSelection = {
  submissionId: string;
  previewKey: string;
  preparedBlob: Blob;
  sourceWidth: number;
  sourceHeight: number;
  previewWidth: number;
  previewHeight: number;
  blob: Blob | null;
};

export function LeaderDashboard() {
  const [busy, setBusy] = useState(true);
  const [panel, setPanel] = useState<"signed-out" | "denied" | "review">("signed-out");
  const [activeStatus, setActiveStatus] = useState<ModerationStatus>("pending");
  const [queuePage, setQueuePage] = useState(1);
  const [queueThumbnailState, setQueueThumbnailState] = useState<GalleryThumbnailState>("all");
  const [queue, setQueue] = useState<GalleryReviewQueue | null>(null);
  const [reviewStatus, setReviewStatus] = useState("Loading pending submissions.");
  const [reviewError, setReviewError] = useState("");
  const [accessDeniedMessage, setAccessDeniedMessage] = useState("Gallery moderation requires Discord membership, completed onboarding, and the Moderator role.");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [cleanupConfirmations, setCleanupConfirmations] = useState<Record<string, boolean | undefined>>({});
  const [cleanupBusyId, setCleanupBusyId] = useState("");
  const [galleryPreview, setGalleryPreview] = useState<GalleryPreviewSelection | null>(null);
  const [instagramActiveStatus, setInstagramActiveStatus] = useState("queued");
  const [instagramQueue, setInstagramQueue] = useState<InstagramPublishQueue | null>(null);
  const [instagramApiStatus, setInstagramApiStatus] = useState<InstagramApiStatus | null>(null);
  const [instagramBusy, setInstagramBusy] = useState(false);
  const [instagramApiBusy, setInstagramApiBusy] = useState(false);
  const [instagramBusyJobId, setInstagramBusyJobId] = useState("");
  const [instagramStatus, setInstagramStatus] = useState("Instagram queue has not loaded yet.");
  const [instagramError, setInstagramError] = useState("");
  const [instagramCaptions, setInstagramCaptions] = useState<Record<string, string>>({});
  const [instagramAltTexts, setInstagramAltTexts] = useState<Record<string, string>>({});
  const [instagramPermalinks, setInstagramPermalinks] = useState<Record<string, string>>({});
  const [instagramNotes, setInstagramNotes] = useState<Record<string, string>>({});
  const [instagramConfirmations, setInstagramConfirmations] = useState<Record<string, InstagramAction | undefined>>({});
  const [instagramJobMessages, setInstagramJobMessages] = useState<Record<string, InstagramJobMessage | undefined>>({});
  const [memberVerificationUserId, setMemberVerificationUserId] = useState("");
  const [memberVerificationMethod, setMemberVerificationMethod] = useState("manual_review");
  const [memberVerificationReason, setMemberVerificationReason] = useState("");
  const [memberVerificationExpiresAt, setMemberVerificationExpiresAt] = useState("");
  const [memberVerificationBusy, setMemberVerificationBusy] = useState(false);
  const [memberVerificationStatus, setMemberVerificationStatus] = useState("Member verification review is ready.");
  const [memberVerificationError, setMemberVerificationError] = useState("");
  const [memberVerificationLast, setMemberVerificationLast] = useState<{
    userId?: string | null;
    verification?: MemberAccessVerification | null;
  } | null>(null);
  const [spinnerLaunchBusy, setSpinnerLaunchBusy] = useState(false);
  const [spinnerLaunchMessage, setSpinnerLaunchMessage] = useState("");
  const leaderLoadGenerationRef = useRef(0);

  const retainGalleryPreviewBlob = useCallback((
    submissionId: string,
    previewKey: string,
    blob: Blob | null,
  ) => {
    setGalleryPreview((current) => {
      if (
        !current ||
        current.submissionId !== submissionId ||
        current.previewKey !== previewKey ||
        current.blob === blob
      ) {
        return current;
      }
      return { ...current, blob };
    });
  }, []);

  const rejectGalleryPreview = useCallback((submissionId: string, previewKey: string) => {
    setGalleryPreview((current) =>
      current?.submissionId === submissionId && current.previewKey === previewKey
        ? null
        : current
    );
    setReviewError("The prepared Gallery preview could not be loaded. Prepare it again before reviewing this image.");
    setReviewStatus("");
  }, []);

  const clearModeratorState = useCallback(() => {
    setQueue(null);
    setReviewStatus("");
    setReviewError("");
    setAccessDeniedMessage("Gallery moderation requires Discord membership, completed onboarding, and the Moderator role.");
    setReasons({});
    setCleanupConfirmations({});
    setCleanupBusyId("");
    setGalleryPreview(null);
    setInstagramQueue(null);
    setInstagramApiStatus(null);
    setInstagramBusy(false);
    setInstagramApiBusy(false);
    setInstagramBusyJobId("");
    setInstagramStatus("Instagram queue has not loaded yet.");
    setInstagramError("");
    setInstagramCaptions({});
    setInstagramAltTexts({});
    setInstagramPermalinks({});
    setInstagramNotes({});
    setInstagramConfirmations({});
    setInstagramJobMessages({});
    setMemberVerificationUserId("");
    setMemberVerificationReason("");
    setMemberVerificationExpiresAt("");
    setMemberVerificationBusy(false);
    setMemberVerificationStatus("Member verification review is ready.");
    setMemberVerificationError("");
    setMemberVerificationLast(null);
    setSpinnerLaunchBusy(false);
    setSpinnerLaunchMessage("");
  }, []);

  const loadQueue = useCallback(async ({
    status = "pending",
    page = 1,
    thumbnailState = "all",
    successMessage = "",
    loadGeneration,
  }: {
    status?: ModerationStatus;
    page?: number;
    thumbnailState?: GalleryThumbnailState;
    successMessage?: string;
    loadGeneration?: number;
  } = {}) => {
    const requestGeneration = loadGeneration ?? leaderLoadGenerationRef.current;
    if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, requestGeneration)) return;
    const nextStatus = normalizeStatus(status);
    const nextPage = Math.max(1, Math.trunc(page));
    const nextThumbnailState = nextStatus === "approved" ? thumbnailState : "all";
    const config = statusConfig(nextStatus);
    setActiveStatus(nextStatus);
    setQueuePage(nextPage);
    setQueueThumbnailState(nextThumbnailState);
    setGalleryPreview(null);
    setBusy(true);
    setReviewError("");
    setReviewStatus(`Loading ${config.label.toLowerCase()} submissions.`);

    const result = await listGalleryReviewQueue({
      status: nextStatus,
      page: nextPage,
      pageSize: 25,
      thumbnailState: nextThumbnailState,
    });
    if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, requestGeneration)) return;
    if (!result.ok) {
      setQueue(null);
      setReviewError(result.message || "Gallery moderation submissions could not be loaded.");
      setReviewStatus("");
      setBusy(false);
      return;
    }

    const data = result.data || { submissions: [] };
    setQueue(data);
    setReviewStatus(
      successMessage ||
        (data.submissions?.length
          ? `${data.submissions.length} ${config.label.toLowerCase()} submission${data.submissions.length === 1 ? "" : "s"} shown.`
          : config.empty),
    );
    setBusy(false);
  }, []);

  const loadInstagramQueue = useCallback(async ({
    status = instagramActiveStatus,
    successMessage = "",
    loadGeneration,
  }: {
    status?: string;
    successMessage?: string;
    loadGeneration?: number;
  } = {}) => {
    const requestGeneration = loadGeneration ?? leaderLoadGenerationRef.current;
    if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, requestGeneration)) return;
    const nextStatus = instagramStatusConfig(status).id;
    const config = instagramStatusConfig(nextStatus);
    setInstagramActiveStatus(nextStatus);
    setInstagramBusy(true);
    setInstagramError("");
    setInstagramStatus(`Loading ${config.label.toLowerCase()} Instagram jobs.`);

    const requestedStatus = nextStatus === "shared_manually" ? "all" : nextStatus;
    const result = await listInstagramPublishQueue({ status: requestedStatus });
    if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, requestGeneration)) return;
    if (!result.ok) {
      setInstagramQueue(null);
      setInstagramError(result.message || "Instagram publishing queue could not be loaded.");
      setInstagramStatus("");
      setInstagramBusy(false);
      return;
    }

    const responseData = result.data || { jobs: [] };
    const responseJobs = Array.isArray(responseData.jobs) ? responseData.jobs : [];
    const jobs = nextStatus === "shared_manually"
      ? responseJobs.filter((job) => text(job.status) === "shared_manually")
      : responseJobs;
    const data = {
      ...responseData,
      jobs,
      count: jobs.length,
      summary: {
        ...(responseData.summary || {}),
        ...(nextStatus === "shared_manually" ? { shared_manually: jobs.length } : {}),
      },
    };
    setInstagramQueue(data);
    setInstagramStatus(
      successMessage ||
        (data.jobs?.length
          ? `${data.jobs.length} ${config.label.toLowerCase()} Instagram job${data.jobs.length === 1 ? "" : "s"} shown.`
          : config.empty),
    );
    setInstagramBusy(false);
  }, [instagramActiveStatus]);

  const loadInstagramApiStatus = useCallback(async (successMessage = "", loadGeneration?: number) => {
    const requestGeneration = loadGeneration ?? leaderLoadGenerationRef.current;
    if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, requestGeneration)) return;
    setInstagramApiBusy(true);
    const result = await checkInstagramApiStatus();
    if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, requestGeneration)) return;
    if (!result.ok) {
      setInstagramApiStatus(null);
      setInstagramError(result.message || "Meta API status could not be checked.");
      setInstagramApiBusy(false);
      return;
    }

    const data = result.data || null;
    setInstagramApiStatus(data);
    setInstagramError("");
    if (successMessage || result.message || data?.message) {
      setInstagramStatus(successMessage || result.message || data?.message || "Meta API status checked.");
    }
    setInstagramApiBusy(false);
  }, []);

  const checkAccess = useCallback(async () => {
    const loadGeneration = beginAuthLoadGeneration(leaderLoadGenerationRef);
    clearModeratorState();
    setPanel("signed-out");
    setBusy(true);
    setReviewError("");
    setReviewStatus("Checking moderator access.");
    const auth = await requireAuth();
    if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, loadGeneration)) return;
    if (!auth.ok) {
      void clearPrivateSpinnerSession();
      setPanel("signed-out");
      setBusy(false);
      return;
    }

    const access = await checkLeaderGalleryModerationAccess();
    if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, loadGeneration)) return;
    if (!access.ok) {
      void clearPrivateSpinnerSession();
      setAccessDeniedMessage(access.message || "Gallery moderation requires Discord membership, completed onboarding, and the Moderator role.");
      setPanel("denied");
      setBusy(false);
      return;
    }

    setPanel("review");
    setBusy(false);

    // Access to the moderator spinner is established above. Queue and provider
    // reads are independent review tools and must not hold that doorway open.
    void Promise.allSettled([
      loadQueue({ status: "pending", page: 1, thumbnailState: "all", loadGeneration }),
      loadInstagramQueue({ status: instagramActiveStatus, loadGeneration }),
      loadInstagramApiStatus("", loadGeneration),
    ]);
  }, [clearModeratorState, instagramActiveStatus, loadInstagramApiStatus, loadInstagramQueue, loadQueue]);

  useEffect(() => {
    const subscription = onAuthStateChange(() => {
      void measureAuthenticatedRouteTask("leader-dashboard", checkAccess);
    });
    return () => {
      invalidateAuthLoadGeneration(leaderLoadGenerationRef);
      subscription.data?.subscription?.unsubscribe();
    };
  }, [checkAccess]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("spinner") !== "expired") return;
    url.searchParams.delete("spinner");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    void Promise.resolve().then(() => {
      setSpinnerLaunchMessage("The private draw session ended. Open it again when you are ready.");
    });
  }, []);

  async function openSpinner() {
    if (spinnerLaunchBusy) return;
    const loadGeneration = leaderLoadGenerationRef.current;
    setSpinnerLaunchBusy(true);
    setSpinnerLaunchMessage("Opening the private draw stage.");

    try {
      const result = await openPrivateSpinnerSession("controller");
      if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, loadGeneration)) {
        void clearPrivateSpinnerSession();
        return;
      }
      if (!result.ok || result.mode !== "controller") throw new Error("Access unavailable.");
      window.location.assign("/spinner");
    } catch {
      if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, loadGeneration)) {
        void clearPrivateSpinnerSession();
        return;
      }
      setSpinnerLaunchMessage("Private draw access could not be opened. Refresh your session and try again.");
      setSpinnerLaunchBusy(false);
    }
  }

  async function moderate(item: GalleryReviewSubmission, action: "approved" | "rejected" | "thumbnail") {
    const submissionId = text(item.id);
    const reason = text(reasons[submissionId]);
    const expectedUpdatedAt = text(item.updatedAt);

    if (!expectedUpdatedAt) {
      setReviewError("Refresh the moderation queue before reviewing this submission.");
      return;
    }

    if (action === "rejected" && reason.length < 2) {
      setReviewError("Add a decline reason before rejecting this submission.");
      return;
    }

    setBusy(true);
    setReviewError("");
    setReviewStatus(
      action === "rejected"
        ? "Declining submission."
        : action === "thumbnail"
          ? "Preparing the gallery thumbnail."
          : "Preparing the gallery thumbnail before approval.",
    );

    let publicationMedia: GalleryModerationMedia | null = null;
    if (action !== "rejected") {
      const previewBlob = galleryPreview?.submissionId === submissionId
        ? galleryPreview.blob
        : null;
      if (!previewBlob) {
        setReviewError("Prepare the private preview and wait for it to load before reviewing this image.");
        setReviewStatus("");
        setBusy(false);
        return;
      }

      try {
        publicationMedia = action === "thumbnail" && item.publicationReady
          ? {
            display: null,
            thumbnail: await createGalleryThumbnail(previewBlob),
          }
          : await createGalleryPublicationMedia(previewBlob);
      } catch (error) {
        setReviewError(error instanceof Error ? error.message : "The gallery thumbnail could not be prepared.");
        setReviewStatus("");
        setBusy(false);
        return;
      }
    }

    const result = await moderateGallerySubmission(
      submissionId,
      action,
      reason,
      publicationMedia,
      expectedUpdatedAt,
    );
    if (!result.ok) {
      setReviewError(result.message || "The submission could not be moderated.");
      setReviewStatus("");
      setBusy(false);
      return;
    }

    await loadQueue({
      status: activeStatus,
      page: queuePage,
      thumbnailState: queueThumbnailState,
      successMessage: result.message || "Submission moderated.",
    });
    if (action === "approved") {
      await loadInstagramQueue({ status: instagramActiveStatus });
    }
  }

  async function prepareReviewPreview(item: GalleryReviewSubmission) {
    const requestGeneration = leaderLoadGenerationRef.current;
    const submissionId = text(item.id);
    const expectedUpdatedAt = text(item.updatedAt);
    if (!submissionId || !expectedUpdatedAt) {
      setReviewError("Refresh the moderation queue before preparing this preview.");
      return;
    }

    setBusy(true);
    setGalleryPreview(null);
    setReviewError("");
    setReviewStatus("Preparing one private Gallery preview.");
    const result = await prepareGalleryReviewPreview(submissionId, expectedUpdatedAt);
    if (!isCurrentAuthLoadGeneration(leaderLoadGenerationRef, requestGeneration)) return;
    if (!result.ok) {
      setReviewError(result.message || "The private Gallery preview could not be prepared.");
      setReviewStatus("");
      setBusy(false);
      return;
    }

    const preview = result.data;
    const sourceWidth = Number(preview?.sourceWidth || 0);
    const sourceHeight = Number(preview?.sourceHeight || 0);
    const previewWidth = Number(preview?.previewWidth || 0);
    const previewHeight = Number(preview?.previewHeight || 0);
    const sourceValidatedAt = text(preview?.sourceValidatedAt);
    const dimensionsAreValid =
      Number.isSafeInteger(sourceWidth) &&
      Number.isSafeInteger(sourceHeight) &&
      sourceWidth > 0 &&
      sourceHeight > 0 &&
      Number.isSafeInteger(previewWidth) &&
      Number.isSafeInteger(previewHeight) &&
      previewWidth > 0 &&
      previewHeight > 0;
    if (
      text(preview?.submissionId) !== submissionId ||
      !(preview?.blob instanceof Blob) ||
      !dimensionsAreValid ||
      !sourceValidatedAt ||
      !Number.isFinite(Date.parse(sourceValidatedAt))
    ) {
      setReviewError("The private Gallery preview response could not be verified.");
      setReviewStatus("");
      setBusy(false);
      return;
    }

    const previewKey = `${submissionId}:${sourceValidatedAt}:${previewWidth}x${previewHeight}`;

    setGalleryPreview({
      submissionId,
      previewKey,
      preparedBlob: preview.blob,
      sourceWidth,
      sourceHeight,
      previewWidth,
      previewHeight,
      blob: null,
    });
    setReviewStatus(result.message || "Private Gallery preview prepared.");
    setBusy(false);
  }

  function armRejectedCleanup(item: GalleryReviewSubmission) {
    const submissionId = text(item.id);
    if (!submissionId) {
      setReviewError("Choose a rejected gallery submission before cleanup.");
      return;
    }

    setReviewError("");
    setReviewStatus("Ready to permanently clean up this rejected submission. Confirm only for smoke-test artifacts or owner-approved cleanup.");
    setCleanupConfirmations((current) => ({ ...current, [submissionId]: true }));
  }

  function cancelRejectedCleanup(item: GalleryReviewSubmission) {
    const submissionId = text(item.id);
    if (!submissionId) return;
    setCleanupConfirmations((current) => ({ ...current, [submissionId]: undefined }));
    setReviewStatus("Rejected submission cleanup canceled.");
  }

  async function cleanupRejectedSubmission(item: GalleryReviewSubmission) {
    const submissionId = text(item.id);
    if (!submissionId) {
      setReviewError("Choose a rejected gallery submission before cleanup.");
      return;
    }

    if (!cleanupConfirmations[submissionId]) {
      armRejectedCleanup(item);
      return;
    }

    setBusy(true);
    setCleanupBusyId(submissionId);
    setReviewError("");
    setReviewStatus("Deleting rejected submission and its Storage object.");

    const result = await deleteRejectedGallerySubmission(submissionId, true);
    if (!result.ok) {
      setReviewError(result.message || "Rejected submission cleanup failed.");
      setReviewStatus("");
      setCleanupBusyId("");
      setBusy(false);
      return;
    }

    setCleanupConfirmations((current) => ({ ...current, [submissionId]: undefined }));
    setCleanupBusyId("");
    await loadQueue({
      status: activeStatus,
      page: queuePage,
      thumbnailState: queueThumbnailState,
      successMessage: result.message || "Rejected submission cleaned up.",
    });
  }

  async function reviewVerification(action: "approve" | "reject" | "revoke") {
    const userId = memberVerificationUserId.trim();
    const reason = memberVerificationReason.trim();

    if (!UUID_RE.test(userId)) {
      setMemberVerificationError("Enter a valid Member user ID before reviewing member verification.");
      return;
    }

    if ((action === "reject" || action === "revoke") && reason.length < 2) {
      setMemberVerificationError("Add a redacted note before rejecting or revoking member verification.");
      return;
    }

    setMemberVerificationBusy(true);
    setMemberVerificationError("");
    setMemberVerificationStatus(
      action === "approve"
        ? "Approving member verification."
        : action === "reject"
          ? "Rejecting member verification."
          : "Revoking member verification.",
    );

    const result = await reviewMemberVerification({
      userId,
      action,
      method: memberVerificationMethod,
      reason,
      expiresAt: memberVerificationExpiresAt,
    });

    if (!result.ok) {
      setMemberVerificationError(result.message || "Member verification review could not be saved.");
      setMemberVerificationStatus("");
      setMemberVerificationBusy(false);
      return;
    }

    setMemberVerificationLast(result.data || { userId, verification: null });
    setMemberVerificationStatus(result.message || "Member verification review saved.");
    setMemberVerificationBusy(false);
  }

  function setInstagramJobMessage(jobId: string, message: InstagramJobMessage | undefined) {
    setInstagramJobMessages((current) => ({
      ...current,
      [jobId]: message,
    }));
  }

  function armInstagramAction(job: InstagramPublishJob, action: InstagramAction) {
    const jobId = text(job.id);
    if (!jobId) {
      setInstagramError("Choose an Instagram publishing job before continuing.");
      return;
    }

    setInstagramError("");
    setInstagramConfirmations((current) => ({ ...current, [jobId]: action }));
    setInstagramJobMessage(
      jobId,
      action === "manual-share"
        ? {
          kind: "status",
          message: "Ready to confirm manual sharing after the image has been posted from the official account.",
        }
        : {
          kind: "status",
          message: "Ready to confirm Meta API publishing. Use only with action-time approval.",
        },
    );
  }

  function cancelInstagramAction(job: InstagramPublishJob) {
    const jobId = text(job.id);
    if (!jobId) return;
    setInstagramConfirmations((current) => ({ ...current, [jobId]: undefined }));
    setInstagramJobMessage(jobId, undefined);
  }

  async function publishInstagram(job: InstagramPublishJob) {
    const jobId = text(job.id);
    const caption = instagramCaptions[jobId] ?? text(job.caption, "Shared from the Mōchirīī guild gallery.");
    const altText = instagramAltTexts[jobId] ?? text(job.altText);
    const metaApiReady = Boolean(instagramApiStatus?.configured && instagramApiStatus.accountReachable && instagramApiStatus.publishEnabled);

    if (!metaApiReady) {
      setInstagramJobMessage(jobId, {
        kind: "error",
        message: "Meta API publishing is unavailable until the diagnostic passes.",
      });
      return;
    }

    if (instagramConfirmations[jobId] !== "publish") {
      armInstagramAction(job, "publish");
      return;
    }

    setInstagramBusyJobId(jobId);
    setInstagramError("");
    setInstagramStatus("Publishing image to Instagram.");
    setInstagramJobMessage(jobId, { kind: "status", message: "Publishing image to Instagram through the Meta API." });

    const result = await publishInstagramGallerySubmission({
      jobId,
      caption,
      altText,
      confirmPublish: true,
    });

    if (!result.ok) {
      setInstagramJobMessage(jobId, {
        kind: "error",
        message: result.message || "Instagram publishing failed.",
      });
      setInstagramError(result.message || "Instagram publishing failed.");
      setInstagramStatus("");
      setInstagramBusyJobId("");
      await loadInstagramQueue({ status: instagramActiveStatus });
      return;
    }

    setInstagramConfirmations((current) => ({ ...current, [jobId]: undefined }));
    setInstagramJobMessage(jobId, {
      kind: "success",
      message: result.message || "Image published to Instagram.",
    });
    setInstagramBusyJobId("");
    await loadInstagramQueue({
      status: instagramActiveStatus,
      successMessage: result.message || "Image published to Instagram.",
    });
  }

  async function copyInstagramText(value: string, label: string) {
    const clean = value.trim();
    if (!clean) {
      setInstagramError(`${label} is empty.`);
      return;
    }

    try {
      await navigator.clipboard.writeText(clean);
      setInstagramError("");
      setInstagramStatus(`${label} copied.`);
    } catch {
      setInstagramError(`${label} could not be copied by this browser.`);
    }
  }

  async function markSharedManually(job: InstagramPublishJob) {
    const jobId = text(job.id);
    const instagramPermalink = instagramPermalinks[jobId] ?? text(job.instagramPermalink);
    const moderatorNote = instagramNotes[jobId] ?? "";

    if (instagramConfirmations[jobId] !== "manual-share") {
      armInstagramAction(job, "manual-share");
      return;
    }

    setInstagramBusyJobId(jobId);
    setInstagramError("");
    setInstagramStatus("Marking Instagram job as shared manually.");
    setInstagramJobMessage(jobId, { kind: "status", message: "Marking this Instagram job as shared manually." });

    const result = await markInstagramGallerySubmissionShared({
      jobId,
      instagramPermalink,
      moderatorNote,
      confirmManualShare: true,
    });

    if (!result.ok) {
      setInstagramJobMessage(jobId, {
        kind: "error",
        message: result.message || "Instagram job could not be marked shared manually.",
      });
      setInstagramError(result.message || "Instagram job could not be marked shared manually.");
      setInstagramStatus("");
      setInstagramBusyJobId("");
      await loadInstagramQueue({ status: instagramActiveStatus });
      return;
    }

    setInstagramConfirmations((current) => ({ ...current, [jobId]: undefined }));
    setInstagramJobMessage(jobId, {
      kind: "success",
      message: result.message || "Instagram job marked as shared manually.",
    });
    setInstagramBusyJobId("");
    await loadInstagramQueue({
      status: instagramActiveStatus,
      successMessage: `${result.message || "Instagram job marked as shared manually."} It is now listed under Shared manually.`,
    });
  }

  if (panel === "signed-out") {
    return (
      <section className="glass-card glass-card--primary glass-pad auth-panel" id="signedOutPanel" aria-busy={busy}>
        <p className="kicker">Sign In Required</p>
        <h2 className="section-title">Sign In Required</h2>
        <WorkflowNotice>Moderator access is checked against Discord after website sign-in.</WorkflowNotice>
        <div className="auth-actions">
          <Link className="hero-cta hero-cta--primary" href="/auth">Login</Link>
          <Link className="hero-cta" href="/account">Account</Link>
        </div>
      </section>
    );
  }

  if (panel === "denied") {
    return (
      <section className="glass-card glass-card--primary glass-pad auth-panel" id="accessDeniedPanel" aria-busy={busy}>
        <p className="kicker">Access Denied</p>
        <h2 className="section-title">Moderator Role Required</h2>
        <WorkflowNotice id="accessDeniedMessage" tone="warning">{accessDeniedMessage}</WorkflowNotice>
        <div className="auth-actions">
          <Link className="hero-cta hero-cta--primary" href="/account">Open Account</Link>
        </div>
      </section>
    );
  }

  const submissions = Array.isArray(queue?.submissions) ? queue.submissions : [];
  const config = statusConfig(activeStatus);
  const instagramJobs = Array.isArray(instagramQueue?.jobs) ? instagramQueue.jobs : [];
  const instagramConfig = instagramStatusConfig(instagramActiveStatus);

  return (
    <>
    <section className="glass-card glass-card--primary glass-pad auth-panel" id="spinnerLaunchPanel" aria-busy={spinnerLaunchBusy}>
      <div className="auth-panel__head">
        <div>
          <p className="kicker">Leader Tool</p>
          <h2 className="section-title">Raffle Spinner</h2>
        </div>
        <span className="status-pill">Moderator only</span>
      </div>
      <p className="lede">Open the private full-screen draw stage for the current gathering.</p>
      <div className="auth-actions">
        <button className="hero-cta hero-cta--primary" type="button" disabled={spinnerLaunchBusy} onClick={openSpinner}>
          {spinnerLaunchBusy ? "Opening…" : "Open Spinner"}
        </button>
      </div>
      <WorkflowNotice hidden={!spinnerLaunchMessage}>{spinnerLaunchMessage}</WorkflowNotice>
    </section>
    <section className="glass-card glass-card--primary glass-pad auth-panel" id="reviewPanel" aria-busy={busy}>
      <div className="auth-panel__head">
        <div>
          <p className="kicker">Moderation Queue</p>
          <h2 className="section-title">Member Submissions</h2>
        </div>
        <button className="hero-cta" type="button" onClick={() => loadQueue({ status: activeStatus, page: queuePage, thumbnailState: queueThumbnailState })} disabled={busy}>Refresh</button>
      </div>

      <div className="queue-tabs" id="queueTabs" role="group" aria-label="Gallery moderation queues">
        {statuses.map((status) => (
          <button
            className="queue-tab"
            type="button"
            data-status={status.id}
            aria-pressed={status.id === activeStatus}
            disabled={busy}
            key={status.id}
            onClick={() => loadQueue({ status: status.id, page: 1, thumbnailState: "all" })}
          >
            {status.label} · {Number(queue?.summary?.[status.id] || 0)}
          </button>
        ))}
      </div>

      {activeStatus === "approved" ? (
        <div className="queue-tabs" role="group" aria-label="Approved thumbnail filter">
          {([
            ["all", "All approved"],
            ["missing", "Needs thumbnail"],
            ["ready", "Thumbnail ready"],
          ] as Array<[GalleryThumbnailState, string]>).map(([state, label]) => (
            <button
              className="queue-tab"
              type="button"
              aria-pressed={state === queueThumbnailState}
              disabled={busy}
              key={state}
              onClick={() => loadQueue({ status: "approved", page: 1, thumbnailState: state })}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <QueueSummary queue={queue} shown={submissions.length} />

      <WorkflowNotice id="reviewStatus" hidden={!reviewStatus}>{reviewStatus}</WorkflowNotice>
      <WorkflowNotice id="reviewError" tone="danger" role="alert" hidden={!reviewError}>{reviewError}</WorkflowNotice>

      <div className="review-list" id="reviewList" aria-live="polite">
        {submissions.length ? (
          submissions.map((item) => {
            const id = text(item.id, "unknown");
            const selectedPreview = galleryPreview?.submissionId === id
              ? galleryPreview
              : null;
            return (
              <SubmissionCard
                item={item}
                activeStatus={activeStatus}
                busy={busy || cleanupBusyId === id}
                reason={reasons[id] || ""}
                cleanupArmed={Boolean(cleanupConfirmations[id])}
                previewKey={selectedPreview?.previewKey || ""}
                previewBlob={selectedPreview?.preparedBlob || null}
                previewSourceWidth={selectedPreview?.sourceWidth || 0}
                previewSourceHeight={selectedPreview?.sourceHeight || 0}
                previewWidth={selectedPreview?.previewWidth || 0}
                previewHeight={selectedPreview?.previewHeight || 0}
                previewReady={Boolean(selectedPreview?.blob)}
                key={id}
                onReasonChange={(value) => setReasons((current) => ({ ...current, [id]: value.slice(0, 500) }))}
                onModerate={moderate}
                onPreparePreview={prepareReviewPreview}
                onPreviewBlobChange={retainGalleryPreviewBlob}
                onPreviewError={rejectGalleryPreview}
                onArmCleanup={armRejectedCleanup}
                onCancelCleanup={cancelRejectedCleanup}
                onDeleteRejected={cleanupRejectedSubmission}
              />
            );
          })
        ) : (
          <WorkflowEmptyState title={busy ? "Loading submissions" : "No submissions shown"}>
            {busy ? "Checking the moderation queue." : config.empty}
          </WorkflowEmptyState>
        )}
      </div>
      {(queue?.pagination?.hasPrevious || queue?.pagination?.hasNext) ? (
        <nav className="auth-actions" aria-label="Gallery moderation pages">
          <button
            className="hero-cta"
            type="button"
            disabled={busy || !queue?.pagination?.hasPrevious}
            onClick={() => loadQueue({ status: activeStatus, page: queuePage - 1, thumbnailState: queueThumbnailState })}
          >
            Previous page
          </button>
          <span className="review-action-note">
            Page {Number(queue?.pagination?.page || queuePage)} of {Math.max(1, Number(queue?.pagination?.totalPages || 1))}
          </span>
          <button
            className="hero-cta"
            type="button"
            disabled={busy || !queue?.pagination?.hasNext}
            onClick={() => loadQueue({ status: activeStatus, page: queuePage + 1, thumbnailState: queueThumbnailState })}
          >
            Next page
          </button>
        </nav>
      ) : null}
    </section>
    <section className="glass-card glass-card--primary glass-pad auth-panel" id="memberVerificationPanel" aria-busy={memberVerificationBusy}>
      <div className="auth-panel__head">
        <div>
          <p className="kicker">Member Verification</p>
          <h2 className="section-title">Review Gallery Access</h2>
        </div>
        <span className="status-pill">Moderator only</span>
      </div>

      <div className="review-details">
        <label className="form-field">
          <span>Member user ID</span>
          <input
            value={memberVerificationUserId}
            onChange={(event) => setMemberVerificationUserId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={memberVerificationBusy}
          />
        </label>
        <label className="form-field">
          <span>Verification method</span>
          <select
            value={memberVerificationMethod}
            onChange={(event) => setMemberVerificationMethod(event.target.value)}
            disabled={memberVerificationBusy}
          >
            {memberVerificationMethods.map((method) => (
              <option value={method.id} key={method.id}>{method.label}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Expiry</span>
          <input
            type="datetime-local"
            value={memberVerificationExpiresAt}
            onChange={(event) => setMemberVerificationExpiresAt(event.target.value)}
            disabled={memberVerificationBusy}
          />
        </label>
        <label className="form-field">
          <span>Redacted note</span>
          <textarea
            maxLength={500}
            rows={3}
            value={memberVerificationReason}
            onChange={(event) => setMemberVerificationReason(event.target.value.slice(0, 500))}
            placeholder="Short approval, rejection, or revoke note. Do not paste private messages."
            disabled={memberVerificationBusy}
          />
        </label>
        <div className="auth-actions">
          <button className="hero-cta hero-cta--primary" type="button" onClick={() => reviewVerification("approve")} disabled={memberVerificationBusy}>
            Approve access
          </button>
          <button className="hero-cta" type="button" onClick={() => reviewVerification("reject")} disabled={memberVerificationBusy}>
            Reject
          </button>
          <button className="hero-cta" type="button" onClick={() => reviewVerification("revoke")} disabled={memberVerificationBusy}>
            Revoke
          </button>
        </div>
        <WorkflowNotice hidden={!memberVerificationStatus}>{memberVerificationStatus}</WorkflowNotice>
        <WorkflowNotice tone="danger" role="alert" hidden={!memberVerificationError}>{memberVerificationError}</WorkflowNotice>
        <MemberVerificationResult userId={memberVerificationLast?.userId} verification={memberVerificationLast?.verification} />
      </div>
    </section>
    <section className="glass-card glass-card--primary glass-pad auth-panel" id="instagramQueuePanel" aria-busy={instagramBusy}>
      <div className="auth-panel__head">
        <div>
          <p className="kicker">Instagram Queue</p>
          <h2 className="section-title">Approved Social Publishing</h2>
        </div>
        <button className="hero-cta" type="button" onClick={() => loadInstagramQueue({ status: instagramActiveStatus })} disabled={instagramBusy}>Refresh</button>
      </div>

      <div className="queue-tabs" role="group" aria-label="Instagram publishing queues">
        {instagramStatuses.map((status) => (
          <button
            className="queue-tab"
            type="button"
            data-status={status.id}
            aria-pressed={status.id === instagramActiveStatus}
            disabled={instagramBusy}
            key={status.id}
            onClick={() => loadInstagramQueue({ status: status.id })}
          >
            {status.label} - {Number(instagramQueue?.summary?.[status.id === "all" ? "total" : status.id] || 0)}
          </button>
        ))}
      </div>

      <WorkflowNotice hidden={!instagramStatus}>{instagramStatus}</WorkflowNotice>
      <WorkflowNotice tone="danger" role="alert" hidden={!instagramError}>{instagramError}</WorkflowNotice>

      <InstagramApiStatusCard
        status={instagramApiStatus}
        busy={instagramApiBusy}
        onRefresh={() => void loadInstagramApiStatus("Meta API status checked.")}
      />

      <div className="review-list" aria-live="polite">
        {instagramJobs.length ? (
          instagramJobs.map((job) => {
            const id = text(job.id, "unknown");
            const metaPublishAvailable = Boolean(instagramApiStatus?.configured && instagramApiStatus.accountReachable && instagramApiStatus.publishEnabled);
            return (
              <InstagramJobCard
                job={job}
                busy={instagramBusy || instagramBusyJobId === id}
                caption={instagramCaptions[id] ?? text(job.caption, "Shared from the Mōchirīī guild gallery.")}
                altText={instagramAltTexts[id] ?? text(job.altText)}
                permalinkValue={instagramPermalinks[id] ?? text(job.instagramPermalink)}
                moderatorNote={instagramNotes[id] ?? ""}
                confirmation={instagramConfirmations[id]}
                jobMessage={instagramJobMessages[id]}
                metaPublishAvailable={metaPublishAvailable}
                key={id}
                onCaptionChange={(value) => setInstagramCaptions((current) => ({ ...current, [id]: value }))}
                onAltTextChange={(value) => setInstagramAltTexts((current) => ({ ...current, [id]: value }))}
                onPermalinkChange={(value) => setInstagramPermalinks((current) => ({ ...current, [id]: value }))}
                onModeratorNoteChange={(value) => setInstagramNotes((current) => ({ ...current, [id]: value }))}
                onCopyCaption={() => copyInstagramText(instagramCaptions[id] ?? text(job.caption, "Shared from the Mōchirīī guild gallery."), "Instagram caption")}
                onCopyAltText={() => copyInstagramText(instagramAltTexts[id] ?? text(job.altText), "Instagram alt text")}
                onArmManualShare={(item) => armInstagramAction(item, "manual-share")}
                onConfirmManualShare={markSharedManually}
                onArmPublish={(item) => armInstagramAction(item, "publish")}
                onConfirmPublish={publishInstagram}
                onCancelAction={cancelInstagramAction}
              />
            );
          })
        ) : (
          <WorkflowEmptyState title={instagramBusy ? "Loading Instagram jobs" : "No Instagram jobs shown"}>
            {instagramBusy ? "Checking the Instagram publishing queue." : instagramConfig.empty}
          </WorkflowEmptyState>
        )}
      </div>
    </section>
    </>
  );
}
