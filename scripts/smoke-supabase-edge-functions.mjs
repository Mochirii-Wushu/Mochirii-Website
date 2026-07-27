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
  {
    name: "manage-raffle-entry",
    body: { action: "status" },
  },
  {
    name: "moderate-raffle",
    body: { action: "readiness" },
  },
  {
    name: "manage-raffle-claim",
    body: { action: "status" },
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
  "get-current-raffle",
];

const disabledOperationalFunctions = [
  {
    name: "run-raffle-schedule",
    invalidHeaders: { "x-raffle-cron-secret": "invalid-smoke-secret" },
  },
  {
    name: "run-raffle-fulfillment",
    invalidHeaders: {
      "x-raffle-fulfillment-secret": "invalid-smoke-secret",
    },
  },
  {
    name: "reward-provider-webhook",
    invalidHeaders: {
      "Tremendous-Webhook-Signature": "invalid-smoke-signature",
    },
  },
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
      signed_url: item?.signed_url ? "[redacted signed URL]" : item?.signed_url,
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

async function checkDisabledOperationalFunction(config, target) {
  for (const [label, method, extraHeaders] of [
    ["without authentication", "POST", {}],
    ["with invalid authentication", "POST", target.invalidHeaders],
    ["with unsupported method", "GET", {}],
  ]) {
    const result = await fetchContract(functionUrl(config, target.name), {
      method,
      headers: headers(config, extraHeaders),
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    assert(
      result.status === 404 && result.ok === false,
      `${target.name} ${label} must remain closed as an opaque 404, got ${result.status}: ${summarizeBody(result.json || result.text)}`,
    );
  }
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
    if (submission.signed_url != null) {
      assert(typeof submission.signed_url === "string", `approved feed submission ${index} signed_url must be a string or null.`);
      assert(/^https?:\/\//.test(submission.signed_url), `approved feed submission ${index} signed_url did not look like an HTTP URL.`);
    }
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

async function checkCurrentRaffle(config) {
  const name = "get-current-raffle";
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
  if (result.json.data == null) {
    assert(result.json.status === "not_open", `${name} empty state must be not_open.`);
  } else {
    assert(
      result.json.data && typeof result.json.data === "object" && !Array.isArray(result.json.data),
      `${name} active data must be an object.`,
    );
    const expectedKeys = [
      "baseEntries",
      "bonusEntryStatus",
      "claimEndsAt",
      "closesAt",
      "cycleStatus",
      "drawAt",
      "drawEvidence",
      "entrantCount",
      "maximumBonusEntries",
      "maximumEntries",
      "opensAt",
      "publicResult",
      "publicReward",
      "rulesUrl",
      "standardEntryStatus",
      "timezone",
      "totalEntryCount",
    ];
    const actualKeys = Object.keys(result.json.data).sort();
    assert(
      JSON.stringify(actualKeys) === JSON.stringify(expectedKeys),
      `${name} returned an unexpected public field set.`,
    );
    assert(result.json.data.baseEntries === 5, `${name} base entry count must be five.`);
    assert(result.json.data.maximumBonusEntries === 5, `${name} bonus entry limit must be five.`);
    assert(result.json.data.maximumEntries === 10, `${name} total entry limit must be ten.`);
    assert(result.json.data.timezone === "Asia/Singapore", `${name} timezone must be Asia/Singapore.`);
    if (result.json.data.drawEvidence !== null) {
      const evidence = result.json.data.drawEvidence;
      assert(
        evidence && typeof evidence === "object" && !Array.isArray(evidence),
        `${name} draw evidence must be an object or null.`,
      );
      const expectedEvidenceKeys = [
        "drawingAt",
        "ledgerCommitment",
        "methodVersion",
        "resultCommitment",
      ];
      assert(
        JSON.stringify(Object.keys(evidence || {}).sort()) ===
          JSON.stringify(expectedEvidenceKeys),
        `${name} draw evidence returned reversible or unexpected fields.`,
      );
      assert(
        /^[0-9a-f]{64}$/.test(evidence?.ledgerCommitment || "") &&
          /^[0-9a-f]{64}$/.test(evidence?.resultCommitment || ""),
        `${name} draw evidence commitments are invalid.`,
      );
    }
  }

  const serialized = JSON.stringify(result.json);
  for (const privateField of [
    "member_id",
    "user_id",
    "display_name",
    "reward_link",
    "ledger_salt",
    "ledgerSalt",
    "seed_hex",
    "seedHex",
    "pseudonymous_member_id",
    "committedPseudonym",
    "entryOrdinal",
  ]) {
    assert(!serialized.includes(privateField), `${name} exposed private field ${privateField}.`);
  }
  await checkMethodNotAllowed(config, name);
}

assert(
  publicReadOnlyFunctions.length === 3,
  "Public read-only Supabase smoke inventory changed without a reviewed contract update.",
);

assert(
  disabledOperationalFunctions.length === 3,
  "Disabled operational Supabase smoke inventory changed without a reviewed contract update.",
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

  for (const target of disabledOperationalFunctions) {
    await checkDisabledOperationalFunction(config, target);
  }

  await checkApprovedFeed(config);
  await checkVisibleProfileCards(config);
  await checkCurrentSpotlightWinner(config);
  await checkCurrentRaffle(config);
  console.log("Supabase Edge Function contract smoke OK.");
} catch (error) {
  const message = error?.message || String(error);
  console.error(`Supabase Edge Function contract smoke failed: ${message}`);
  process.exit(1);
}
