import { processSubmission } from "./index.ts";

const APPLICATION = "1560403878556475584";
const INTERACTION_TOKEN = "MOCHIRII_PRIVATE_INTERACTION_SENTINEL";
const INGEST_SECRET = "MOCHIRII_PRIVATE_INGEST_SENTINEL";
const STAGING_ORIGIN = "https://suldtxatlidsqghxmcsd.supabase.co";
const INGEST_URL = `${STAGING_ORIGIN}/functions/v1/submit-discord-gallery-image`;
const REPLY_URL = `https://discord.com/api/v10/webhooks/${APPLICATION}/${INTERACTION_TOKEN}/messages/@original`;
const FALLBACK = "Gallery submission could not be queued.";
const CONFIGURATION_FAILURE = "reaper-discord-interactions missing submit-discord-gallery-image configuration";
const INGEST_FAILURE = "reaper-discord-interactions background submission failed";
const REPLY_FAILURE = "reaper-discord-interactions gallery response edit failed";

type Fixture = {
  missing?: "url" | "secret";
  configFailure?: unknown;
  ingestFailure?: unknown;
  replyFailure?: unknown;
  ingestStatus?: number;
  ingestBody?: unknown;
  replyStatus?: number;
  replyStatusText?: string;
  replyCancelFailure?: unknown;
  diagnosticFailure?: boolean;
  invalidJson?: boolean;
  optIn?: unknown;
};

async function runFixture(fixture: Fixture = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const diagnostics: unknown[][] = [];
  const payload = { title: "Synthetic JPEG validation", instagramOptIn: fixture.optIn ?? false };
  const readConfig = () => {
    if (Object.hasOwn(fixture, "configFailure")) throw fixture.configFailure;
    return { supabaseUrl: fixture.missing === "url" ? "" : `${STAGING_ORIGIN}/`,
      ingestSecret: fixture.missing === "secret" ? "" : INGEST_SECRET };
  };
  const fetchImpl: typeof fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url === INGEST_URL) {
      if (Object.hasOwn(fixture, "ingestFailure")) return Promise.reject(fixture.ingestFailure);
      return Promise.resolve(new Response(fixture.invalidJson ? "{invalid" : JSON.stringify(fixture.ingestBody ?? { ok: true }), {
        status: fixture.ingestStatus ?? 200,
        headers: { "Content-Type": "application/json" },
      }));
    }
    if (url === REPLY_URL) {
      if (Object.hasOwn(fixture, "replyFailure")) return Promise.reject(fixture.replyFailure);
      const body = Object.hasOwn(fixture, "replyCancelFailure") ? new ReadableStream({
        cancel() { throw fixture.replyCancelFailure; },
      }) : null;
      return Promise.resolve(new Response(body, { status: fixture.replyStatus ?? (body ? 200 : 204),
        statusText: fixture.replyStatusText ?? "" }));
    }
    return Promise.reject(new Error("Unexpected request."));
  };
  // Exercise the imported consumer, response parsing and Gallery PATCH body.
  // Only bounded config, network and diagnostic seams are injected. No global
  // console interception, credential, provider, copied function or source scan.
  await processSubmission(payload, INTERACTION_TOKEN, APPLICATION, { readConfig, fetchImpl,
    reportFailure: (...values: unknown[]) => {
      diagnostics.push(values);
      if (fixture.diagnosticFailure) throw privateError();
    } });
  const ingests = calls.filter(({ url }) => url === INGEST_URL);
  const replies = calls.filter(({ url }) => url === REPLY_URL);
  assert(calls.length === ingests.length + replies.length, "Only the expected targets may be requested.");
  assert(ingests.length <= 1 && replies.length === 1, "One ingest at most and exactly one reply must be attempted.");
  if (ingests.length) {
    assert(ingests[0].init?.method === "POST", "The existing ingest method must be preserved.");
    assert(new Headers(ingests[0].init?.headers).get("x-mochirii-reaper-secret") === INGEST_SECRET,
      "The existing private ingest header must be preserved.");
    assert(ingests[0].init?.body === JSON.stringify(payload), "The submitted consent payload must be preserved.");
  }
  assert(replies[0].init?.method === "PATCH", "The Gallery response must edit the original message.");
  assert(new Headers(replies[0].init?.headers).get("Content-Type") === "application/json", "The reply must retain JSON encoding.");
  const reply = JSON.parse(String(replies[0].init?.body));
  assert(typeof reply.content === "string" && reply.content.length <= 220, "The single reply must be bounded.");
  assert(Array.isArray(reply.allowed_mentions?.parse) && reply.allowed_mentions.parse.length === 0,
    "The Gallery response must suppress mentions.");
  for (const diagnostic of diagnostics) assert(diagnostic.length === 1 &&
    [CONFIGURATION_FAILURE, INGEST_FAILURE, REPLY_FAILURE].includes(String(diagnostic[0])),
  "Diagnostics must be single fixed categories without transport detail.");
  const output = JSON.stringify({ diagnostics, reply });
  for (const sentinel of [INTERACTION_TOKEN, INGEST_SECRET, "PRIVATE_TRANSPORT_SENTINEL", "PRIVATE_ERROR_STACK",
    "PRIVATE_ERROR_CAUSE", REPLY_URL, "https://outside.example/", "Traceback"]) {
    assert(!output.includes(sentinel), "Private transport data must not reach diagnostics or replies.");
  }
  return { ingests, replies, diagnostics: diagnostics.map(([value]) => value), reply };
}

for (const optIn of [false, true, "true"]) for (const duplicate of [false, true]) {
  Deno.test(`Gallery producer preserves success, duplicate=${duplicate}, consent=${typeof optIn}:${String(optIn)}`, async () => {
    const result = await runFixture({ optIn, ingestBody: { ok: true, duplicate } });
    const status = duplicate ? "That image is already in the moderation queue." : "Image submitted to the moderation queue.";
    const consent = optIn === true ? " Instagram sharing is enabled for moderator review after gallery approval."
      : " Instagram sharing is not enabled for this submission.";
    assert(result.reply.content === status + consent, "Existing success and strict consent semantics must remain exact.");
    assert(result.ingests.length === 1 && result.diagnostics.length === 0, "Success must have one ingest and no diagnostic.");
  });
}

for (const missing of ["url", "secret"] as const) {
  Deno.test(`Gallery producer contains missing ${missing} configuration and reply failure`, async () => {
    const result = await runFixture({ missing, replyFailure: privateError() });
    assert(result.ingests.length === 0, "Missing configuration must not reach ingest.");
    assert(result.reply.content === "Discord gallery submissions are not configured yet.", "Configuration reply must stay exact.");
    assert(JSON.stringify(result.diagnostics) === JSON.stringify([CONFIGURATION_FAILURE, REPLY_FAILURE]),
      "Both failures must produce only their fixed categories.");
  });
}

for (const failure of [privateError(), "PRIVATE_TRANSPORT_SENTINEL", { message: "PRIVATE_TRANSPORT_SENTINEL",
  stack: "PRIVATE_ERROR_STACK", cause: "PRIVATE_ERROR_CAUSE" }, null]) {
  Deno.test(`Gallery producer contains ingest and reply rejection: ${failure === null ? "null" : typeof failure}`, async () => {
    const result = await runFixture({ ingestFailure: failure, replyFailure: failure });
    assert(result.ingests.length === 1 && result.reply.content === FALLBACK, "Ingest failure must select one safe reply.");
    assert(JSON.stringify(result.diagnostics) === JSON.stringify([INGEST_FAILURE, REPLY_FAILURE]),
      "Error and non-Error rejections must remain categorical and contained.");
  });
}

Deno.test("Gallery producer contains configuration lookup rejection", async () => {
  const result = await runFixture({ configFailure: privateError(), replyFailure: "PRIVATE_TRANSPORT_SENTINEL" });
  assert(result.ingests.length === 0 && result.reply.content === FALLBACK, "Configuration exceptions must not escape or ingest.");
  assert(JSON.stringify(result.diagnostics) === JSON.stringify([INGEST_FAILURE, REPLY_FAILURE]), "Lookup exceptions must be categorical.");
});

Deno.test("Gallery producer contains reply rejection after a successful ingest without retry", async () => {
  const result = await runFixture({ replyFailure: privateError() });
  assert(result.ingests.length === 1 && result.reply.content.startsWith("Image submitted"), "A failed reply must not relabel successful ingest.");
  assert(JSON.stringify(result.diagnostics) === JSON.stringify([REPLY_FAILURE]), "Only reply failure must be reported.");
});

Deno.test("Gallery producer contains response-controlled HTTP reply diagnostics", async () => {
  const result = await runFixture({ replyStatus: 502,
    replyStatusText: `PRIVATE_TRANSPORT_SENTINEL ${REPLY_URL} PRIVATE_ERROR_STACK` });
  assert(result.ingests.length === 1 && result.reply.content.startsWith("Image submitted"), "HTTP reply failure cannot repeat or relabel ingest.");
  assert(JSON.stringify(result.diagnostics) === JSON.stringify([REPLY_FAILURE]), "Hostile statusText must never be emitted.");
});

Deno.test("Gallery producer contains reply body cancellation failure", async () => {
  const result = await runFixture({ replyCancelFailure: privateError() });
  assert(result.ingests.length === 1 && result.reply.content.startsWith("Image submitted"), "Failed cancellation cannot repeat or relabel ingest.");
  assert(JSON.stringify(result.diagnostics) === JSON.stringify([REPLY_FAILURE]), "Cancellation failure must remain categorical.");
});

Deno.test("Gallery producer requires a strict duplicate boolean", async () => {
  const result = await runFixture({ ingestBody: { ok: true, duplicate: "true" } });
  assert(result.reply.content.startsWith("Image submitted"), "A non-boolean duplicate claim must not change success wording.");
});

Deno.test("Gallery producer contains a failing diagnostic sink", async () => {
  const result = await runFixture({ ingestFailure: privateError(), replyFailure: privateError(), diagnosticFailure: true });
  assert(result.reply.content === FALLBACK, "Diagnostic failure must not prevent the single contained reply attempt.");
  assert(JSON.stringify(result.diagnostics) === JSON.stringify([INGEST_FAILURE, REPLY_FAILURE]), "Diagnostic failures cannot repeat operations.");
});

for (const fixture of [
  { ingestStatus: 503, ingestBody: { ok: false, message: "Gallery capacity is reached." }, expected: "Gallery capacity is reached." },
  { ingestStatus: 503, ingestBody: { ok: true }, expected: FALLBACK },
  { ingestBody: { ok: false }, expected: FALLBACK },
  { ingestBody: { ok: "true" }, expected: FALLBACK },
  { ingestBody: ["not a record"], expected: FALLBACK },
  { invalidJson: true, expected: FALLBACK },
  { ingestStatus: 400, ingestBody: { ok: false, message: "A".repeat(1000) }, expected: "A".repeat(220) },
]) {
  Deno.test(`Gallery producer preserves bounded failure reply: ${fixture.invalidJson ? "invalid JSON" : fixture.ingestStatus ?? "ingest body"}`, async () => {
    const result = await runFixture(fixture);
    assert(result.reply.content === fixture.expected && result.ingests.length === 1, "Existing safe failure replies must remain exact.");
    assert(result.diagnostics.length === 0, "An ordinary rejected response must not become a transport error.");
  });
}

function privateError(): Error {
  const failure = new Error(`PRIVATE_TRANSPORT_SENTINEL ${REPLY_URL} https://outside.example/?token=PRIVATE_TRANSPORT_SENTINEL`,
    { cause: "PRIVATE_ERROR_CAUSE" });
  failure.stack = "PRIVATE_ERROR_STACK";
  return failure;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
