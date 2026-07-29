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
    name: "list-instagram-publish-queue",
    body: { status: "queued" },
  },
  {
    name: "publish-instagram-gallery-submission",
    body: {
      job_id: "00000000-0000-4000-8000-000000000000",
      caption: "Smoke test only.",
      alt_text: "Smoke test placeholder.",
      confirmPublish: true,
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
    cacheControl: response.headers.get("cache-control") || "",
    contentLength: response.headers.get("content-length") || "",
    contentTypeOptions: response.headers.get("x-content-type-options") || "",
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
  const items = copy?.data?.items;
  if (Array.isArray(items)) {
    copy.data.items = items.map((item) => ({
      ...item,
      thumbnail_url: item?.thumbnail_url ? "[bounded Edge media URL]" : item?.thumbnail_url,
    }));
  }
  if (copy?.data?.full_url) copy.data.full_url = "[bounded Edge media URL]";
  if (copy?.data?.thumbnail_url) copy.data.thumbnail_url = "[bounded Edge media URL]";
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

function assertApprovedMediaUrl(value, config, asset, id, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} was not an absolute URL.`);
  }
  const expectedOrigin = new URL(config.url).origin;
  assert(url.origin === expectedOrigin, `${label} used an unexpected origin.`);
  assert(url.pathname === "/functions/v1/list-approved-gallery-submissions", `${label} used an unexpected path.`);
  assert([...url.searchParams.keys()].sort().join(",") === "asset,id", `${label} exposed unexpected query fields.`);
  assert(url.searchParams.get("asset") === asset, `${label} used an unexpected asset kind.`);
  assert(url.searchParams.get("id") === id, `${label} used a different opaque publication ID.`);
  assert(!url.username && !url.password && !url.hash, `${label} exposed a URL capability or fragment.`);
  return url;
}

function validateApprovedFeedBody(body, config) {
  assert(body && typeof body === "object", "approved feed response was not JSON.");
  assert(body.ok === true, `approved feed response ok flag was not true: ${summarizeBody(body)}`);
  assert(body.data && typeof body.data === "object", "approved feed response missing data object.");
  assert(Number(body.data.schemaVersion) === 2, "approved feed schemaVersion must be 2.");
  assert(Array.isArray(body.data.items), "approved feed response data.items must be an array.");
  const listDataKeys = new Set([
    "schemaVersion",
    "items",
    "count",
    "totalEligible",
    "facets",
    "hasMore",
    "nextCursor",
    "partial",
    "complete",
    "deliveryFailures",
    "delivery",
    "cacheSeconds",
  ]);
  Object.keys(body.data).forEach((key) => assert(listDataKeys.has(key), `approved feed data exposed unexpected key ${key}.`));
  assert(typeof body.data.count === "number" && Number.isSafeInteger(body.data.count), "approved feed response data.count must be an integer.");
  assert(Number(body.data.count) === body.data.items.length, "approved feed count did not match items length.");
  assert(typeof body.data.totalEligible === "number" && Number.isSafeInteger(body.data.totalEligible), "approved feed totalEligible must be an integer.");
  assert(body.data.facets && typeof body.data.facets === "object", "approved feed facets must be an object.");
  assert(typeof body.data.hasMore === "boolean", "approved feed hasMore must be boolean.");
  assert(body.data.nextCursor === null || typeof body.data.nextCursor === "string", "approved feed nextCursor must be null or an opaque string.");
  assert(!body.data.hasMore || /^[A-Za-z0-9_-]{1,512}$/.test(body.data.nextCursor || ""), "approved feed hasMore requires a bounded opaque cursor.");
  assert(body.data.hasMore || body.data.nextCursor === null, "approved feed terminal page must not return a cursor.");
  assert(typeof body.data.partial === "boolean", "approved feed partial must be boolean.");
  assert(typeof body.data.complete === "boolean", "approved feed complete must be boolean.");
  assert(typeof body.data.deliveryFailures === "number" && Number.isSafeInteger(body.data.deliveryFailures), "approved feed deliveryFailures must be an integer.");
  assert(body.data.partial === (body.data.deliveryFailures > 0), "approved feed partial state drifted from delivery failures.");
  assert(body.data.complete === (!body.data.hasMore && !body.data.partial), "approved feed complete state drifted from traversal state.");
  assert(body.data.delivery === "bounded-edge-media", "approved feed delivery mode must be bounded-edge-media.");
  assert(Number.isSafeInteger(body.data.cacheSeconds) && body.data.cacheSeconds >= 1 && body.data.cacheSeconds <= 60, "approved feed cacheSeconds must be bounded.");

  const allowedCategories = new Set(["member-submissions", "portraits", "gatherings", "action", "scenery", "companions"]);
  assert(
    Object.keys(body.data.facets).length === allowedCategories.size &&
      Object.keys(body.data.facets).every((key) => allowedCategories.has(key)),
    "approved feed facets did not match the reviewed category set.",
  );
  Object.entries(body.data.facets).forEach(([key, value]) => {
    assert(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, `approved feed facet ${key} must be a nonnegative integer.`);
  });

  const forbiddenKeys = new Set([
    "user_id",
    "storage_path",
    "storage_bucket",
    "thumbnail_storage_path",
    "reviewed_by",
    "rejection_reason",
    "full_url",
    "uploader_display_name",
    "thumbnail_signed_url",
    "full_signed_url",
    "signedUrlSeconds",
  ]);
  const allowedItemKeys = new Set([
    "id",
    "title",
    "caption",
    "category",
    "categories",
    "mime_type",
    "size_bytes",
    "created_at",
    "reviewed_at",
    "thumbnail_url",
    "thumbnail_size_bytes",
    "thumbnail_width",
    "thumbnail_height",
  ]);

  body.data.items.forEach((submission, index) => {
    assert(submission && typeof submission === "object", `approved feed submission ${index} was not an object.`);
    Object.keys(submission).forEach((key) => {
      assert(!forbiddenKeys.has(key), `approved feed submission ${index} exposed private key ${key}.`);
      assert(allowedItemKeys.has(key), `approved feed submission ${index} exposed unexpected key ${key}.`);
    });
    assert(typeof submission.id === "string" && submission.id, `approved feed submission ${index} missing id.`);
    assert(typeof submission.thumbnail_url === "string", `approved feed submission ${index} thumbnail_url must be a string.`);
    assertApprovedMediaUrl(submission.thumbnail_url, config, "thumbnail", submission.id, `approved feed submission ${index} thumbnail_url`);
    assert(
      Number.isFinite(Number(submission.thumbnail_size_bytes)) &&
        Number(submission.thumbnail_size_bytes) >= 1 &&
        Number(submission.thumbnail_size_bytes) <= 80 * 1024,
      `approved feed submission ${index} thumbnail_size_bytes was outside the bounded contract.`,
    );
    assert(
      Number.isInteger(Number(submission.thumbnail_width)) &&
        Number(submission.thumbnail_width) >= 1 &&
        Number(submission.thumbnail_width) <= 720,
      `approved feed submission ${index} thumbnail_width was outside the bounded contract.`,
    );
    assert(
      Number.isInteger(Number(submission.thumbnail_height)) &&
        Number(submission.thumbnail_height) >= 1 &&
        Number(submission.thumbnail_height) <= 720,
      `approved feed submission ${index} thumbnail_height was outside the bounded contract.`,
    );
    assert(
      Array.isArray(submission.categories) && submission.categories.includes("member-submissions"),
      `approved feed submission ${index} did not include member-submissions category membership.`,
    );
    assert(
      submission.categories.every((category) => allowedCategories.has(category)),
      `approved feed submission ${index} exposed a noncanonical category.`,
    );
    assert(
      submission.category === null || allowedCategories.has(submission.category),
      `approved feed submission ${index} exposed a noncanonical visual category.`,
    );
  });
}

async function checkApprovedFeed(config) {
  const name = "list-approved-gallery-submissions";
  await checkOptions(config, name);

  const listResult = await fetchContract(functionUrl(config, name), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ action: "list", pageSize: 24, sort: "newest" }),
  });

  assert(
    listResult.status === 200,
    `${name} list expected 200 public response, got ${listResult.status}: ${summarizeBody(listResult.json || listResult.text)}`,
  );
  validateApprovedFeedBody(listResult.json, config);

  const firstItem = listResult.json?.data?.items?.[0];
  if (firstItem?.id) {
    const thumbnailUrl = firstItem.thumbnail_url || "";
    assertApprovedMediaUrl(thumbnailUrl, config, "thumbnail", firstItem.id, `${name} thumbnail URL`);

    const thumbnailMedia = await fetchContract(thumbnailUrl, {
      method: "GET",
      headers: headers(config, { Accept: "image/webp" }),
    });
    assert(thumbnailMedia.status === 200, `${name} thumbnail media expected 200, got ${thumbnailMedia.status}.`);
    assert(thumbnailMedia.contentType.toLowerCase().startsWith("image/webp"), `${name} thumbnail media type drifted.`);
    assert(
      thumbnailMedia.cacheControl === "private, max-age=300, stale-while-revalidate=60",
      `${name} thumbnail media cache contract drifted.`,
    );
    assert(thumbnailMedia.contentTypeOptions.toLowerCase() === "nosniff", `${name} thumbnail media must set nosniff.`);
    assert(Number(thumbnailMedia.contentLength) >= 1 && Number(thumbnailMedia.contentLength) <= 80 * 1024, `${name} thumbnail media length was outside the bounded contract.`);

    const fullUrl = new URL(functionUrl(config, name));
    fullUrl.searchParams.set("asset", "full");
    fullUrl.searchParams.set("id", firstItem.id);
    assertApprovedMediaUrl(fullUrl.toString(), config, "full", firstItem.id, `${name} on-demand display URL`);
    const fullMedia = await fetchContract(fullUrl.toString(), {
      method: "GET",
      headers: headers(config, { Accept: "image/webp" }),
    });
    assert(fullMedia.status === 200, `${name} display media expected 200, got ${fullMedia.status}.`);
    assert(fullMedia.contentType.toLowerCase().startsWith("image/webp"), `${name} display media type drifted.`);
    assert(Number(fullMedia.contentLength) >= 1 && Number(fullMedia.contentLength) <= 2 * 1024 * 1024, `${name} display media length was outside the bounded contract.`);

    const forbiddenResolver = await fetchContract(functionUrl(config, name), {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ action: "full", id: firstItem.id }),
    });
    assert(forbiddenResolver.status === 400, `${name} POST media resolver expected 400, got ${forbiddenResolver.status}.`);
  }

  const invalidFullResult = await fetchContract(functionUrl(config, name), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ action: "full", id: "not-a-submission-id" }),
  });
  assert(invalidFullResult.status === 400, `${name} invalid display id expected 400, got ${invalidFullResult.status}.`);

  const getResult = await fetchContract(functionUrl(config, name), {
    method: "GET",
    headers: headers(config),
  });
  assert(getResult.status === 400, `${name} GET without exact asset/id query expected 400, got ${getResult.status}.`);

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
