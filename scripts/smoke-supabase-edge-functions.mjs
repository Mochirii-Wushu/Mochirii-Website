import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const TIMEOUT_MS = 15000;

const protectedFunctions = [
  {
    name: "verify-discord-member",
    body: {},
  },
  {
    name: "verify-member-access",
    body: {},
  },
  {
    name: "review-member-verification",
    body: {},
  },
  {
    name: "list-gallery-review-queue",
    body: { checkOnly: true },
  },
  {
    name: "spinner-live-session",
    body: {
      action: "spin",
      commandId: "00000000-0000-4000-8000-000000000000",
      expectedRevision: 0,
    },
    deniedStatuses: [401, 403, 404],
  },
  {
    name: "moderate-gallery-submission",
    body: {
      submission_id: "00000000-0000-4000-8000-000000000000",
      action: "approved",
    },
  },
  {
    name: "delete-rejected-gallery-submission",
    body: {},
  },
  {
    name: "withdraw-gallery-publication-consent",
    body: {
      submission_id: "00000000-0000-4000-8000-000000000000",
      destination: "instagram",
      reason: "Smoke test only.",
    },
  },
  {
    name: "list-instagram-publish-queue",
    body: { status: "queued" },
  },
  {
    name: "publish-instagram-gallery-submission",
    body: {
      job_id: "00000000-0000-4000-8000-000000000000",
      caption: "Smoke test only.",
      alt_text: "Smoke test placeholder.",
      expected_updated_at: "2026-07-29T00:00:00.000Z",
      confirmation_fingerprint: "0".repeat(64),
      confirm_instagram_publish: true,
    },
  },
  {
    name: "resolve-instagram-publish-reconciliation",
    body: {
      job_id: "00000000-0000-4000-8000-000000000000",
      resolution: "confirmed_not_published",
      note: "Smoke test only.",
      confirm_reconciliation: true,
    },
  },
  {
    name: "mark-instagram-gallery-submission-shared",
    body: {
      job_id: "00000000-0000-4000-8000-000000000000",
      instagram_permalink: "",
      moderator_note: "Smoke test only.",
      confirmManualShare: true,
    },
  },
  {
    name: "check-instagram-api-status",
    body: {},
  },
  {
    name: "list-facebook-page-publish-queue",
    body: { status: "queued", page_size: 20 },
  },
  {
    name: "publish-facebook-page-gallery-submission",
    body: {
      job_id: "00000000-0000-4000-8000-000000000000",
      message: "Smoke test only.",
      expected_updated_at: "2026-07-29T00:00:00.000Z",
      confirmation_fingerprint: "0".repeat(64),
      confirm_facebook_publish: true,
    },
  },
  {
    name: "resolve-facebook-page-publish-reconciliation",
    body: {
      job_id: "00000000-0000-4000-8000-000000000000",
      resolution: "confirmed_not_published",
      note: "Smoke test only.",
      confirm_reconciliation: true,
    },
  },
  {
    name: "check-facebook-page-api-status",
    body: {},
  },
  {
    name: "list-member-profiles",
    body: {},
  },
  {
    name: "get-member-profile",
    body: {},
  },
  {
    name: "submit-member-profile-media",
    body: {},
  },
  {
    name: "list-member-profile-media-queue",
    body: {},
  },
  {
    name: "moderate-member-profile-media",
    body: {},
  },
];

const secretProtectedFunctions = [
  {
    name: "reaper-discord-interactions",
    invalidHeaders: {
      "x-signature-ed25519": "00",
      "x-signature-timestamp": "0",
    },
    cors: false,
    body: { type: 1 },
  },
  {
    name: "submit-discord-gallery-image",
    secretHeader: "x-mochirii-reaper-secret",
    body: {
      guildId: "1078630751077142608",
      channelId: "1078630751077142608",
      messageId: "1078630751077142608",
      attachmentId: "1078630751077142608",
      discordUserId: "1078630751077142608",
      attachmentUrl: "https://cdn.discordapp.com/attachments/1078630751077142608/1078630751077142608/example.png",
      mimeType: "image/png",
      sizeBytes: 1,
      instagramOptIn: false,
      facebookPageOptIn: false,
      uploadRightsConfirmed: true,
    },
  },
  {
    name: "reaper-discord-member-sync",
    secretHeader: "x-mochirii-reaper-member-sync-secret",
    cors: false,
    body: {
      event_type: "guildMemberUpdate",
      guild_id: "1078630751077142608",
      discord_user_id: "1078630751077142608",
      roles: [],
      gateway_sequence: 0,
      occurred_at: "2026-07-26T00:00:00.000Z",
    },
  },
  {
    name: "reaper-spinner-dispatch",
    secretHeader: "x-mochirii-reaper-spinner-secret",
    cors: false,
    body: { limit: 1 },
  },
  {
    name: "send-vote-reminder",
    secretHeader: "x-mochirii-vote-reminder-secret",
    body: { preview: true },
  },
  {
    name: "send-member-spotlight-poll",
    secretHeader: "x-mochirii-spotlight-poll-secret",
    body: { preview: true },
  },
  {
    name: "publish-member-spotlight-winner",
    secretHeader: "x-mochirii-spotlight-poll-secret",
    body: { preview: true },
  },
  {
    name: "sync-pixelfed-social-account",
    secretHeader: "x-mochirii-social-sync-secret",
    cors: false,
    body: {},
  },
];

const publicReadOnlyFunctions = [
  "list-visible-profile-cards",
  "get-current-spotlight-winner",
];

function readSupabasePublicConfig() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const publishableKey = String(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "");

  if (!url || !publishableKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY for the smoke process.");
  }

  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error("Supabase smoke requires the browser-safe sb_publishable_ key.");
  }

  return {
    url: url.replace(/\/+$/, ""),
    publishableKey,
  };
}

function functionUrl(config, name) {
  return `${config.url}/functions/v1/${name}`;
}

function headers(config, extra = {}) {
  return {
    apikey: config.publishableKey,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

async function fetchContract(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type") || "",
    cors: response.headers.get("access-control-allow-origin") || "",
    json,
    text,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function summarizeBody(body) {
  if (!body || typeof body !== "object") return String(body || "").slice(0, 120);
  const copy = JSON.parse(JSON.stringify(body));
  const submissions = copy?.data?.submissions;
  if (Array.isArray(submissions)) {
    copy.data.submissions = submissions.map((item) => ({
      ...item,
      thumbnail_signed_url: item?.thumbnail_signed_url ? "[redacted signed URL]" : item?.thumbnail_signed_url,
      full_signed_url: item?.full_signed_url ? "[redacted signed URL]" : item?.full_signed_url,
    }));
  }
  return JSON.stringify(copy).slice(0, 500);
}

async function checkOptions(config, name) {
  const result = await fetchContract(functionUrl(config, name), {
    method: "OPTIONS",
    headers: headers(config),
  });
  assert(result.status >= 200 && result.status < 300, `${name} OPTIONS expected 2xx, got ${result.status}.`);
  assert(result.cors === "*" || result.cors, `${name} OPTIONS missing CORS allow-origin header.`);
}

async function checkProtectedRejects(config, target, label, authorization) {
  const result = await fetchContract(functionUrl(config, target.name), {
    method: "POST",
    headers: headers(config, authorization ? { Authorization: authorization } : {}),
    body: JSON.stringify(target.body),
  });

  const deniedStatuses = target.deniedStatuses || [401, 403];
  assert(
    deniedStatuses.includes(result.status),
    `${target.name} ${label} expected ${deniedStatuses.join("/")} fail-closed response, got ${result.status}: ${summarizeBody(result.json || result.text)}`,
  );
}

async function checkSecretProtectedRejects(config, target, label, extraHeaders = {}) {
  const result = await fetchContract(functionUrl(config, target.name), {
    method: "POST",
    headers: headers(config, extraHeaders),
    body: JSON.stringify(target.body),
  });

  assert(
    result.status === 401 || result.status === 403,
    `${target.name} ${label} expected 401/403 fail-closed response, got ${result.status}: ${summarizeBody(result.json || result.text)}`,
  );

  assert(result.ok === false, `${target.name} ${label} unexpectedly succeeded.`);
}

async function checkMethodNotAllowed(config, name) {
  const result = await fetchContract(functionUrl(config, name), {
    method: "DELETE",
    headers: headers(config),
  });

  assert(result.status === 405, `${name} DELETE expected 405 Method not allowed, got ${result.status}.`);
}

function validateApprovedFeedBody(body) {
  assert(body && typeof body === "object", "approved feed response was not JSON.");
  assert(body.ok === true, `approved feed response ok flag was not true: ${summarizeBody(body)}`);
  assert(body.data && typeof body.data === "object", "approved feed response missing data object.");
  assert(Array.isArray(body.data.submissions), "approved feed response data.submissions must be an array.");
  assert(Number.isFinite(Number(body.data.count)), "approved feed response data.count must be numeric.");
  assert(Number(body.data.count) === body.data.submissions.length, "approved feed count did not match submissions length.");
  assert(Number(body.data.signedUrlSeconds) === 3600, "approved feed signedUrlSeconds should be 3600.");

  const forbiddenKeys = new Set(["user_id", "storage_path", "storage_bucket", "reviewed_by", "rejection_reason"]);

  body.data.submissions.forEach((submission, index) => {
    assert(submission && typeof submission === "object", `approved feed submission ${index} was not an object.`);
    Object.keys(submission).forEach((key) => {
      assert(!forbiddenKeys.has(key), `approved feed submission ${index} exposed private key ${key}.`);
    });
    assert(typeof submission.id === "string" && submission.id, `approved feed submission ${index} missing id.`);
    assert(typeof submission.thumbnail_signed_url === "string", `approved feed submission ${index} thumbnail_signed_url must be a string.`);
    assert(/^https?:\/\//.test(submission.thumbnail_signed_url), `approved feed submission ${index} thumbnail_signed_url did not look like an HTTP URL.`);
    assert(typeof submission.full_signed_url === "string", `approved feed submission ${index} full_signed_url must be a string.`);
    assert(/^https?:\/\//.test(submission.full_signed_url), `approved feed submission ${index} full_signed_url did not look like an HTTP URL.`);
    assert(submission.thumbnail_signed_url !== submission.full_signed_url, `approved feed submission ${index} reused its original as its thumbnail.`);
    assert(
      Number.isFinite(Number(submission.thumbnail_size_bytes)) &&
        Number(submission.thumbnail_size_bytes) >= 1 &&
        Number(submission.thumbnail_size_bytes) <= 80 * 1024,
      `approved feed submission ${index} thumbnail_size_bytes was outside the bounded contract.`,
    );
  });
}

async function checkApprovedFeed(config) {
  const name = "list-approved-gallery-submissions";
  await checkOptions(config, name);

  const getResult = await fetchContract(functionUrl(config, name), {
    method: "GET",
    headers: headers(config),
  });

  assert(
    getResult.status === 200,
    `${name} GET expected 200 public response, got ${getResult.status}: ${summarizeBody(getResult.json || getResult.text)}`,
  );
  validateApprovedFeedBody(getResult.json);

  const deleteResult = await fetchContract(functionUrl(config, name), {
    method: "DELETE",
    headers: headers(config),
  });

  assert(deleteResult.status === 405, `${name} DELETE expected 405 Method not allowed, got ${deleteResult.status}.`);
}

async function checkVisibleProfileCards(config) {
  const name = "list-visible-profile-cards";
  await checkOptions(config, name);

  const result = await fetchContract(functionUrl(config, name), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ slugs: [] }),
  });

  assert(
    result.status === 200,
    `${name} empty lookup expected 200, got ${result.status}: ${summarizeBody(result.json || result.text)}`,
  );
  assert(result.json?.ok === true, `${name} empty lookup did not return ok=true.`);
  assert(Array.isArray(result.json?.data?.profiles), `${name} profiles must be an array.`);
  assert(result.json.data.profiles.length === 0, `${name} empty lookup unexpectedly returned profiles.`);
  assert(Number(result.json.data.count) === 0, `${name} empty lookup count must be zero.`);
  assert(Number(result.json.data.signedUrlSeconds) === 600, `${name} signedUrlSeconds must be 600.`);
  await checkMethodNotAllowed(config, name);
}

async function checkCurrentSpotlightWinner(config) {
  const name = "get-current-spotlight-winner";
  await checkOptions(config, name);

  const result = await fetchContract(functionUrl(config, name), {
    method: "GET",
    headers: headers(config),
  });

  assert(
    result.status === 200,
    `${name} GET expected 200, got ${result.status}: ${summarizeBody(result.json || result.text)}`,
  );
  assert(result.json?.ok === true, `${name} response did not return ok=true.`);
  assert(result.json?.data && typeof result.json.data === "object", `${name} response missing data.`);
  const expectedKeys = ["monthKey", "publishedAt", "source", "winnerName"];
  const actualKeys = Object.keys(result.json.data).sort();
  assert(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), `${name} returned an unexpected public field set.`);
  for (const key of ["winnerName", "monthKey", "publishedAt", "source"]) {
    assert(typeof result.json.data[key] === "string", `${name} ${key} must be a string.`);
  }
  assert(
    ["fallback", "monthly-discord-poll"].includes(result.json.data.source),
    `${name} returned an unexpected source value.`,
  );
  await checkMethodNotAllowed(config, name);
}

assert(
  publicReadOnlyFunctions.length === 2,
  "Public read-only Supabase smoke inventory changed without a reviewed contract update.",
);

try {
  const config = readSupabasePublicConfig();

  for (const target of protectedFunctions) {
    await checkOptions(config, target.name);
    await checkProtectedRejects(config, target, "without JWT", "");
    await checkProtectedRejects(config, target, "with malformed JWT", "Bearer malformed.jwt.token");
    await checkProtectedRejects(config, target, "with publishable key as bearer", `Bearer ${config.publishableKey}`);
  }

  for (const target of secretProtectedFunctions) {
    if (target.cors !== false) await checkOptions(config, target.name);
    await checkMethodNotAllowed(config, target.name);
    await checkSecretProtectedRejects(config, target, "without required authentication");
    await checkSecretProtectedRejects(config, target, "with publishable key as bearer", {
      Authorization: `Bearer ${config.publishableKey}`,
    });
    await checkSecretProtectedRejects(
      config,
      target,
      "with invalid authentication headers",
      target.invalidHeaders || { [target.secretHeader]: "invalid-smoke-secret" },
    );
  }

  await checkApprovedFeed(config);
  await checkVisibleProfileCards(config);
  await checkCurrentSpotlightWinner(config);
  console.log("Supabase Edge Function contract smoke OK.");
} catch (error) {
  const message = error?.message || String(error);
  console.error(`Supabase Edge Function contract smoke failed: ${message}`);
  process.exit(1);
}
