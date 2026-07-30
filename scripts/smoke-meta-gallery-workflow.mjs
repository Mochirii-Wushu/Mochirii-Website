import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, firefox, webkit } from "playwright";

const root = process.cwd();
const webRoot = resolve(root, "apps/web");
const nextBin = resolve(webRoot, "node_modules/next/dist/bin/next");
const axePath = resolve(root, "node_modules/axe-core/axe.min.js");
const forbiddenSharedPorts = new Set([54321, 54322, 54323, 54324, 54325, 54326, 54327]);

const memberId = "11111111-1111-4111-8111-111111111111";
const moderatorId = "22222222-2222-4222-8222-222222222222";
const instagramJobId = "33333333-3333-4333-8333-333333333333";
const facebookJobId = "44444444-4444-4444-8444-444444444444";
const queuedWithdrawalId = "55555555-5555-4555-8555-555555555555";
const quarantinedWithdrawalId = "66666666-6666-4666-8666-666666666666";
const removalWithdrawalId = "77777777-7777-4777-8777-777777777777";
const publishedFacebookJobId = "88888888-8888-4888-8888-888888888888";
const fixtureTimestamp = "2026-07-29T20:00:00.000Z";
const expiry = 1_893_456_000;
const syntheticUser = {
  id: moderatorId,
  aud: "authenticated",
  role: "authenticated",
  email: "browser-smoke@example.invalid",
  email_confirmed_at: fixtureTimestamp,
  phone: "",
  confirmed_at: fixtureTimestamp,
  last_sign_in_at: fixtureTimestamp,
  app_metadata: { provider: "discord", providers: ["discord"] },
  user_metadata: { full_name: "Gallery Browser Smoke" },
  identities: [],
  created_at: fixtureTimestamp,
  updated_at: fixtureTimestamp,
  is_anonymous: false,
};
const accessToken = unsignedJwt({
  aud: "authenticated",
  exp: expiry,
  iat: 1_774_800_000,
  role: "authenticated",
  sub: moderatorId,
});
const publishableKey = unsignedJwt({
  aud: "authenticated",
  exp: expiry,
  iat: 1_774_800_000,
  role: "anon",
});
const syntheticSession = {
  access_token: accessToken,
  refresh_token: "synthetic-refresh-token-for-loopback-smoke-only",
  token_type: "bearer",
  expires_in: 3_600,
  expires_at: expiry,
  user: syntheticUser,
};

if (!existsSync(nextBin)) {
  throw new Error("Install the locked Website dependencies before running the Meta Gallery browser smoke.");
}

const port = await reserveSafeLoopbackPort();
const baseUrl = `http://127.0.0.1:${port}`;
const environment = {
  ...safeChildEnvironment(),
  NODE_ENV: "production",
  NO_COLOR: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SITE_URL: baseUrl,
  NEXT_PUBLIC_SUPABASE_URL: baseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
};
let server = null;
let serverOutput = "";

try {
  await runChild(process.execPath, [nextBin, "build"], {
    cwd: webRoot,
    env: environment,
    stdio: "inherit",
  }, "Meta Gallery production build", 8 * 60_000);

  server = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: webRoot, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (chunk) => { serverOutput = boundedOutput(serverOutput, chunk); });
  server.stderr.on("data", (chunk) => { serverOutput = boundedOutput(serverOutput, chunk); });
  await waitUntilReady(server, `${baseUrl}/gallery-submit`);

  await runChromiumWorkflow();
  await runRepresentativeBrowser(firefox, "Firefox");
  await runRepresentativeBrowser(webkit, "WebKit");

  console.log("Meta Gallery workflow browser smoke passed.");
  console.log("- Production-mode loopback Next server: passed");
  console.log("- Member upload and destination-specific withdrawal flow: passed");
  console.log("- Instagram and Facebook Page second-confirmation contracts: passed");
  console.log("- Stale confirmation and provider-network fail-closed checks: passed");
  console.log("- Published-only manual Facebook group handoff: passed");
  console.log("- Chromium full flow plus Firefox/WebKit representative flow: passed");
} finally {
  await stopChild(server);
}

async function runChromiumWorkflow() {
  const browser = await chromium.launch({ headless: true });
  try {
    await runMemberWorkflow(browser);
    await runModeratorWorkflow(browser);
  } finally {
    await browser.close();
  }
}

async function runMemberWorkflow(browser) {
  const state = createMockState();
  const context = await createIsolatedContext(browser, state, { width: 390, height: 844 });
  try {
    const page = await newObservedPage(context, state, "Chromium member workflow");
    await page.goto(`${baseUrl}/gallery-submit`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMemberPanel(page, state, "Chromium member workflow");
    await assertHealthyDocument(page, "Chromium member workflow");

    const instagram = page.locator("#instagramOptIn");
    const facebook = page.locator("#facebookPageOptIn");
    const rights = page.locator("#uploadRightsConfirmed");
    const file = page.locator("#imageFile");
    const submit = page.getByRole("button", { name: "Submit for Review" });

    assert(!(await instagram.isChecked()), "Instagram opt-in must be unchecked by default.");
    assert(!(await facebook.isChecked()), "Facebook Page opt-in must be unchecked by default.");
    assert(!(await rights.isChecked()), "Upload-rights attestation must be unchecked by default.");
    assert(await rights.getAttribute("required") !== null, "Upload-rights attestation must be required.");

    await instagram.press("Space");
    await waitForCheckedState(page, "#instagramOptIn", true, "Instagram opt-in was not independently keyboard operable");
    assert(!(await facebook.isChecked()), "Instagram selection changed the Facebook Page opt-in.");
    await instagram.press("Space");
    await waitForCheckedState(page, "#instagramOptIn", false, "Instagram opt-in did not clear from the keyboard");
    await facebook.press("Space");
    await waitForCheckedState(page, "#facebookPageOptIn", true, "Facebook Page opt-in was not independently keyboard operable");
    assert(!(await instagram.isChecked()), "Facebook Page selection changed the Instagram opt-in.");
    await facebook.press("Space");
    await waitForCheckedState(page, "#facebookPageOptIn", false, "Facebook Page opt-in did not clear from the keyboard");

    await file.setInputFiles(imageFixture("rights-gate.jpg", "image/jpeg"));
    await instagram.check();
    const mutationBaseline = mutationCount(state);
    await submit.click();
    await page.waitForTimeout(100);
    assert(mutationCount(state) === mutationBaseline, "Missing upload-rights attestation reached a mutation endpoint.");
    assert(await rights.evaluate((node) => node === document.activeElement), "The missing required rights field did not receive focus.");

    await rights.check();
    await file.setInputFiles(imageFixture("public-destination.png", "image/png"));
    await submit.click();
    await page.locator("#uploadError").filter({ hasText: "requires a JPEG" }).waitFor();
    assert(mutationCount(state) === mutationBaseline, "A social PNG reached a mutation endpoint.");

    await file.setInputFiles(imageFixture("instagram-ready.jpg", "image/jpeg"));
    await submit.click();
    await page.locator("#uploadStatus").filter({ hasText: "Image submitted for moderation" }).waitFor();
    assert(state.submissionInserts.length === 1, "Instagram-only JPEG did not create exactly one submission insert.");
    assertSubmissionInsert(state.submissionInserts[0], { instagram: true, facebook: false });
    assert(!(await instagram.isChecked()) && !(await facebook.isChecked()) && !(await rights.isChecked()), "Successful upload did not reset all consent fields.");

    await file.setInputFiles(imageFixture("facebook-ready.jpg", "image/jpeg"));
    await facebook.check();
    await rights.check();
    await submit.click();
    await page.locator("#uploadStatus").filter({ hasText: "Image submitted for moderation" }).waitFor();
    assert(state.submissionInserts.length === 2, "Facebook-only JPEG did not create exactly one additional submission insert.");
    assertSubmissionInsert(state.submissionInserts[1], { instagram: false, facebook: true });

    const withdrawalScenarios = [
      [queuedWithdrawalId, "Queued consent fixture", "Consent withdrawn"],
      [quarantinedWithdrawalId, "Inspection consent fixture", "moderator inspection required"],
      [removalWithdrawalId, "Published consent fixture", "external copies may remain"],
    ];
    for (const [submissionId, title, expected] of withdrawalScenarios) {
      const card = page.locator(".submission-item").filter({ hasText: title });
      await card.getByRole("button", { name: "Withdraw Instagram consent" }).click();
      await card.getByRole("button", { name: "Confirm Instagram withdrawal" }).waitFor();
      await waitForFocus(page, '[aria-label="Gallery submission outcome"]', "Withdrawal confirmation notice");
      await card.getByRole("button", { name: "Confirm Instagram withdrawal" }).click();
      await card.getByText(expected, { exact: false }).waitFor();
      const call = state.functionCalls.filter((entry) => entry.name === "withdraw-gallery-publication-consent").at(-1);
      assertExactObject(call?.body, { submission_id: submissionId, destination: "instagram" }, `${title} withdrawal request`);
    }

    assert(
      state.functionCalls.every((entry) => !entry.name.startsWith("publish-") && !entry.name.includes("meta")),
      "Member upload or withdrawal contacted a Meta publishing endpoint.",
    );
    await assertAxe(page, "#uploadPanel", "Chromium member workflow");
    await assertCompactReflow(page, "#uploadPanel", "Chromium member workflow");
    assertNoNetworkEscapes(state, "Chromium member workflow");
    assertNoPageErrors(state, "Chromium member workflow");
  } finally {
    await context.unrouteAll({ behavior: "wait" });
    await context.close();
  }
}

async function runModeratorWorkflow(browser) {
  const state = createMockState();
  const context = await createIsolatedContext(browser, state, { width: 1280, height: 900 });
  try {
    const page = await newObservedPage(context, state, "Chromium moderator workflow");
    await page.goto(`${baseUrl}/leader-dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator("#reviewPanel").waitFor({ state: "visible" });
    await page.locator(`[data-instagram-job-id="${instagramJobId}"]`).waitFor();
    await page.locator(`[data-facebook-page-job-id="${facebookJobId}"]`).waitFor();
    await assertHealthyDocument(page, "Chromium moderator workflow");
    assert(await page.locator(`[data-submission-id="${queuedWithdrawalId}"]`).count() === 1, "Moderation cards need stable submission identifiers.");

    const instagramCard = page.locator(`[data-instagram-job-id="${instagramJobId}"]`);
    const instagramCaption = instagramCard.getByLabel("Final Instagram caption");
    const instagramAlt = instagramCard.getByLabel("Required moderator-reviewed Instagram alt text");
    const instagramPrepare = instagramCard.getByRole("button", { name: "Prepare Instagram publication" });
    assert(await instagramPrepare.isDisabled(), "Instagram publication was enabled without moderator-reviewed alt text.");
    await instagramCaption.fill("A pretty Wushu land guild moment.");
    await instagramAlt.fill("Guild members standing beside flowering trees.");
    await instagramPrepare.click();
    const instagramConfirm = instagramCard.getByRole("button", { name: "Confirm public Instagram post" });
    await instagramConfirm.waitFor();
    await waitForFocus(page, `[data-instagram-job-id="${instagramJobId}"] button`, "Instagram second-confirmation control", "Confirm public Instagram post");

    await instagramCaption.fill("A pretty Wushu land guild moment, revised.");
    await instagramCard.getByRole("button", { name: "Prepare Instagram publication" }).waitFor();
    assert(publishCalls(state, "publish-instagram-gallery-submission").length === 0, "Editing Instagram copy reused a stale confirmation.");
    await instagramCard.getByRole("button", { name: "Prepare Instagram publication" }).click();
    await instagramCard.getByRole("button", { name: "Confirm public Instagram post" }).click();
    await page.locator("#instagramQueuePanel").getByRole("alert").filter({ hasText: "revision changed" }).waitFor();

    const instagramRequest = singlePublishBody(state, "publish-instagram-gallery-submission");
    const expectedInstagramFingerprint = publicationFingerprint({
      destination: "instagram",
      jobId: instagramJobId,
      status: "queued",
      attemptCount: 0,
      updatedAt: fixtureTimestamp,
      moderatorUserId: moderatorId,
      primaryCopy: "A pretty Wushu land guild moment, revised.",
      altText: "Guild members standing beside flowering trees.",
    });
    assertExactObject(instagramRequest, {
      job_id: instagramJobId,
      caption: "A pretty Wushu land guild moment, revised.",
      alt_text: "Guild members standing beside flowering trees.",
      expected_updated_at: fixtureTimestamp,
      confirmation_fingerprint: expectedInstagramFingerprint,
      confirm_instagram_publish: true,
    }, "Instagram publication request");

    const facebookCard = page.locator(`[data-facebook-page-job-id="${facebookJobId}"]`);
    assert(await facebookCard.locator("[data-facebook-group-handoff]").count() === 0, "A queued Facebook job exposed the manual group handoff.");
    const facebookCaption = facebookCard.getByLabel("Final Facebook Page caption");
    await facebookCaption.fill("A cupcake guild showcase from Wushu land.");
    await facebookCard.getByRole("button", { name: "Prepare Page publication" }).click();
    const facebookConfirm = facebookCard.getByRole("button", { name: "Confirm public Page post" });
    await facebookConfirm.waitFor();
    await waitForFocus(page, '[aria-label="Facebook Page queue outcome"]', "Facebook Page second-confirmation notice");

    await facebookCaption.fill("A cupcake guild showcase from Wushu land, revised.");
    await facebookCard.getByRole("button", { name: "Prepare Page publication" }).waitFor();
    assert(publishCalls(state, "publish-facebook-page-gallery-submission").length === 0, "Editing Facebook copy reused a stale confirmation.");
    await facebookCard.getByRole("button", { name: "Prepare Page publication" }).click();
    await facebookCard.getByRole("button", { name: "Confirm public Page post" }).click();
    await page.locator('[aria-label="Facebook Page queue outcome"]').getByRole("alert").filter({ hasText: "revision changed" }).waitFor();

    const facebookRequest = singlePublishBody(state, "publish-facebook-page-gallery-submission");
    const expectedFacebookFingerprint = publicationFingerprint({
      destination: "facebook_page",
      jobId: facebookJobId,
      status: "queued",
      attemptCount: 0,
      updatedAt: fixtureTimestamp,
      moderatorUserId: moderatorId,
      primaryCopy: "A cupcake guild showcase from Wushu land, revised.",
      altText: "",
    });
    assertExactObject(facebookRequest, {
      job_id: facebookJobId,
      message: "A cupcake guild showcase from Wushu land, revised.",
      expected_updated_at: fixtureTimestamp,
      confirmation_fingerprint: expectedFacebookFingerprint,
      confirm_facebook_publish: true,
    }, "Facebook Page publication request");

    await page.locator("#facebookPageQueuePanel").getByRole("button", { name: /^Published -/ }).click();
    const publishedCard = page.locator(`[data-facebook-page-job-id="${publishedFacebookJobId}"]`);
    const handoff = publishedCard.locator("[data-facebook-group-handoff]");
    await handoff.waitFor();
    await handoff.getByText("No Groups API is used.", { exact: false }).waitFor();
    const groupLink = handoff.getByRole("link", { name: "Open Mōchirīī Guild Facebook group" });
    assert(await groupLink.getAttribute("href") === "https://www.facebook.com/groups/mochiriiguild", "Manual group handoff did not use the approved Guild group URL.");
    assert(
      state.functionCalls.every((entry) => !entry.name.toLowerCase().includes("group")),
      "The browser invoked a removed Facebook Groups API path.",
    );

    await assertAxe(page, "#instagramQueuePanel", "Chromium Instagram moderation");
    await assertAxe(page, "#facebookPageQueuePanel", "Chromium Facebook moderation");
    await assertCompactReflow(page, "main", "Chromium moderator workflow");
    assertNoNetworkEscapes(state, "Chromium moderator workflow");
    assertNoPageErrors(state, "Chromium moderator workflow", [
      "/functions/v1/publish-instagram-gallery-submission",
      "/functions/v1/publish-facebook-page-gallery-submission",
    ]);
  } finally {
    await context.unrouteAll({ behavior: "wait" });
    await context.close();
  }
}

async function runRepresentativeBrowser(browserType, browserName) {
  const browser = await browserType.launch({ headless: true });
  const state = createMockState();
  const navigationBaseUrl = browserName === "WebKit" ? secureLoopbackUrl(baseUrl) : baseUrl;
  const context = await createIsolatedContext(browser, state, { width: 390, height: 844 }, navigationBaseUrl);
  try {
    const page = await newObservedPage(context, state, `${browserName} representative workflow`);
    await page.goto(`${navigationBaseUrl}/gallery-submit`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMemberPanel(page, state, `${browserName} Gallery submission`);
    await assertHealthyDocument(page, `${browserName} Gallery submission`);
    assert(!(await page.locator("#instagramOptIn").isChecked()), `${browserName}: Instagram opt-in was not initially unchecked.`);
    assert(!(await page.locator("#facebookPageOptIn").isChecked()), `${browserName}: Facebook Page opt-in was not initially unchecked.`);
    await page.locator("#instagramOptIn").press("Space");
    await waitForCheckedState(page, "#instagramOptIn", true, `${browserName}: Instagram opt-in was not keyboard operable`);
    assert(!(await page.locator("#facebookPageOptIn").isChecked()), `${browserName}: destination checkboxes were not independent.`);
    await assertNoHorizontalOverflow(page, `${browserName} Gallery submission`);

    await page.goto(`${navigationBaseUrl}/leader-dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator("#reviewPanel").waitFor({ state: "visible" });
    await page.locator(`[data-instagram-job-id="${instagramJobId}"]`).waitFor();
    await page.locator(`[data-facebook-page-job-id="${facebookJobId}"]`).waitFor();
    await assertHealthyDocument(page, `${browserName} moderator dashboard`);
    await assertNoHorizontalOverflow(page, `${browserName} moderator dashboard`);
    assertNoNetworkEscapes(state, `${browserName} representative workflow`);
    assertNoPageErrors(state, `${browserName} representative workflow`);
  } finally {
    await context.unrouteAll({ behavior: "wait" });
    await context.close();
    await browser.close();
  }
}

async function createIsolatedContext(browser, state, viewport, navigationBaseUrl = baseUrl) {
  state.navigationBaseUrl = navigationBaseUrl;
  const context = await browser.newContext({
    viewport,
    colorScheme: "dark",
    reducedMotion: "reduce",
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(navigationBaseUrl).origin,
        localStorage: [{ name: "sb-127-auth-token", value: JSON.stringify(syntheticSession) }],
      }],
    },
  });

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      await route.continue();
      return;
    }
    const logicalUrl = new URL(url);
    const secureLoopbackBridge = navigationBaseUrl !== baseUrl && url.origin === new URL(navigationBaseUrl).origin;
    if (secureLoopbackBridge) logicalUrl.protocol = "http:";
    if (logicalUrl.origin !== baseUrl) {
      state.externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }

    if (logicalUrl.pathname.startsWith("/auth/v1/")) return mockAuth(route, state, logicalUrl);
    if (logicalUrl.pathname.startsWith("/rest/v1/")) return mockRest(route, state, logicalUrl);
    if (logicalUrl.pathname.startsWith("/storage/v1/")) return mockStorage(route, state, logicalUrl);
    if (logicalUrl.pathname.startsWith("/functions/v1/")) return mockFunction(route, state, logicalUrl);
    if (logicalUrl.pathname.startsWith("/_vercel/")) {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      return;
    }
    if (secureLoopbackBridge) {
      const response = await route.fetch({ url: logicalUrl.href });
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  return context;
}

async function newObservedPage(context, state, label) {
  const page = await context.newPage();
  page.on("pageerror", (error) => state.pageErrors.push(`${label}: ${safeMessage(error.message)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/Failed to load resource: the server responded with a status of 409 \(Conflict\)/i.test(message.text())) {
      state.staleResponseConsoleErrors.push(`${label}: ${safeMessage(message.text())}`);
      return;
    }
    state.consoleErrors.push(`${label}: ${safeMessage(message.text())}`);
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const allowedOrigins = new Set([baseUrl, state.navigationBaseUrl].map((value) => new URL(value).origin));
    const failure = request.failure()?.errorText || "failed";
    const supersededResponsiveImage = allowedOrigins.has(url.origin) && url.pathname === "/_next/image" &&
      ["net::ERR_ABORTED", "NS_BINDING_ABORTED"].includes(failure);
    const headers = request.headers();
    const canceledNextPrefetch = allowedOrigins.has(url.origin) && request.method() === "GET" &&
      ["net::ERR_ABORTED", "NS_BINDING_ABORTED"].includes(failure) &&
      (headers["next-router-prefetch"] === "1" || headers.purpose === "prefetch" || headers["sec-purpose"] === "prefetch" || headers.rsc === "1");
    if (!supersededResponsiveImage && !canceledNextPrefetch && allowedOrigins.has(url.origin)) {
      state.failedRequests.push(`${label}: ${request.method()} ${url.pathname}: ${safeMessage(failure)}`);
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    const expectedStaleResponse = response.status() === 409 && [
      "/functions/v1/publish-instagram-gallery-submission",
      "/functions/v1/publish-facebook-page-gallery-submission",
    ].includes(url.pathname);
    if (response.status() >= 400 && !expectedStaleResponse) {
      state.httpErrors.push(`${label}: ${response.status()} ${url.pathname}`);
    }
    if (expectedStaleResponse) state.expectedStaleResponses.push(url.pathname);
  });
  return page;
}

async function mockAuth(route, state, url) {
  const request = route.request();
  state.authCalls.push(`${request.method()} ${url.pathname}`);
  if (request.method() === "OPTIONS") return fulfillJson(route, 204, null);
  if (url.pathname === "/auth/v1/user" && request.method() === "GET") {
    return fulfillJson(route, 200, syntheticUser);
  }
  if (url.pathname === "/auth/v1/token" && request.method() === "POST") {
    return fulfillJson(route, 200, syntheticSession);
  }
  state.unexpectedApiRequests.push(`${request.method()} ${url.pathname}`);
  return fulfillJson(route, 404, { message: "Synthetic auth route not configured." });
}

async function mockRest(route, state, url) {
  const request = route.request();
  const table = decodeURIComponent(url.pathname.slice("/rest/v1/".length));
  if (request.method() === "OPTIONS") return fulfillJson(route, 204, null);
  if (table === "member_profiles" && request.method() === "GET") {
    return fulfillJson(route, 200, state.profile, { "content-range": "0-0/1" });
  }
  if (table === "gallery_submissions" && request.method() === "GET") {
    return fulfillJson(route, 200, state.memberSubmissions, { "content-range": `0-${Math.max(0, state.memberSubmissions.length - 1)}/${state.memberSubmissions.length}` });
  }
  if (table === "gallery_submissions" && request.method() === "POST") {
    const body = request.postDataJSON();
    state.submissionInserts.push(body);
    const submission = {
      ...body,
      id: generatedSubmissionId(state.submissionInserts.length),
      status: "pending",
      created_at: fixtureTimestamp,
      updated_at: fixtureTimestamp,
      reviewed_at: null,
      rejection_reason: null,
      submission_source: "website",
    };
    state.memberSubmissions.unshift(submission);
    return fulfillJson(route, 201, submission, { "content-range": "0-0/1" });
  }
  if (table === "gallery_social_withdrawal_status" && request.method() === "GET") {
    return fulfillJson(route, 200, state.withdrawals, { "content-range": `0-${Math.max(0, state.withdrawals.length - 1)}/${state.withdrawals.length}` });
  }
  state.unexpectedApiRequests.push(`${request.method()} ${url.pathname}${url.search}`);
  return fulfillJson(route, 404, { message: "Synthetic REST route not configured." });
}

async function mockStorage(route, state, url) {
  const request = route.request();
  if (request.method() === "OPTIONS") return fulfillJson(route, 204, null);
  if (request.method() === "POST" && url.pathname.startsWith("/storage/v1/object/member-gallery/")) {
    state.storageUploads.push(url.pathname);
    return fulfillJson(route, 200, { Key: url.pathname.slice("/storage/v1/object/".length) });
  }
  if (request.method() === "DELETE" && url.pathname === "/storage/v1/object/member-gallery") {
    state.storageDeletes.push(request.postData() || "");
    return fulfillJson(route, 200, []);
  }
  state.unexpectedApiRequests.push(`${request.method()} ${url.pathname}`);
  return fulfillJson(route, 404, { message: "Synthetic Storage route not configured." });
}

async function mockFunction(route, state, url) {
  const request = route.request();
  if (request.method() === "OPTIONS") return fulfillJson(route, 204, null);
  const name = decodeURIComponent(url.pathname.slice("/functions/v1/".length));
  const body = request.postData() ? request.postDataJSON() : {};
  state.functionCalls.push({ name, body, method: request.method() });

  if (name === "verify-member-access") {
    return edgeSuccess(route, {
      galleryEligible: true,
      method: "discord",
      memberStatus: "active",
      discordVerified: true,
      manualApproved: false,
      profile: state.profile,
      identities: [],
    }, "Upload access verified.");
  }
  if (name === "list-gallery-review-queue") {
    if (body.checkOnly === true) return edgeSuccess(route, { hasAccess: true, moderatorId });
    return edgeSuccess(route, {
      submissions: body.status === "pending" ? [state.moderationSubmission] : [],
      count: body.status === "pending" ? 1 : 0,
      status: body.status || "pending",
      thumbnailState: body.thumbnail_state || "all",
      summary: { pending: 1, approved: 0, rejected: 0, archived: 0, missingThumbnails: 0 },
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1, hasPrevious: false, hasNext: false },
    });
  }
  if (name === "list-instagram-publish-queue") {
    const items = body.status === "queued" || body.status === "all" ? [state.instagramJob] : [];
    return edgeSuccess(route, {
      items,
      count: items.length,
      status: body.status || "queued",
      pageSize: 25,
      nextCursor: null,
      summary: { queued: 1, published: 0, failed: 0, reconcile_required: 0, ineligible: 0, canceled: 0, total: 1 },
    });
  }
  if (name === "check-instagram-api-status") {
    return edgeSuccess(route, readyInstagramDiagnostic(), "Instagram diagnostic fixture ready.");
  }
  if (name === "list-facebook-page-publish-queue") {
    const jobs = body.status === "published"
      ? [state.publishedFacebookJob]
      : body.status === "queued" || body.status === "all"
        ? [state.facebookJob]
        : [];
    return edgeSuccess(route, {
      jobs,
      count: jobs.length,
      status: body.status || "queued",
      pageSize: 25,
      nextCursor: null,
      hasMore: false,
      summary: { queued: 1, published: 1, failed: 0, reconcile_required: 0, ineligible: 0, canceled: 0, total: 2 },
    });
  }
  if (name === "check-facebook-page-api-status") {
    return edgeSuccess(route, readyFacebookDiagnostic(), "Facebook Page diagnostic fixture ready.");
  }
  if (name === "withdraw-gallery-publication-consent") {
    const outcome = state.withdrawalOutcomes.get(body.submission_id);
    if (!outcome) return edgeFailure(route, 400, "Unknown synthetic withdrawal fixture.");
    state.withdrawals = state.withdrawals.filter((entry) => !(entry.submission_id === body.submission_id && entry.destination === body.destination));
    state.withdrawals.push({
      submission_id: body.submission_id,
      destination: body.destination,
      state: outcome.state,
      external_removal_required: outcome.externalRemovalRequired,
      requested_at: fixtureTimestamp,
      updated_at: fixtureTimestamp,
    });
    return edgeSuccess(route, {
      destination: body.destination,
      action: outcome.state,
      status: outcome.state,
      requiresModeratorInspection: outcome.state === "quarantined",
      removalRequestCreated: outcome.state === "removal_requested",
    }, outcome.message);
  }
  if (name === "publish-instagram-gallery-submission" || name === "publish-facebook-page-gallery-submission") {
    return edgeFailure(route, 409, "The queued revision changed. Refresh before publishing.");
  }

  state.unexpectedApiRequests.push(`${request.method()} ${url.pathname}`);
  return edgeFailure(route, 404, "Synthetic Edge Function route not configured.");
}

function createMockState() {
  const profile = {
    id: moderatorId,
    display_name: "Gallery Browser Smoke",
    member_status: "active",
    has_required_discord_roles: true,
    discord_verified_at: fixtureTimestamp,
    discord_checked_at: fixtureTimestamp,
  };
  const withdrawalFixtures = [
    submissionRow(queuedWithdrawalId, "Queued consent fixture"),
    submissionRow(quarantinedWithdrawalId, "Inspection consent fixture"),
    submissionRow(removalWithdrawalId, "Published consent fixture"),
  ];
  const submission = {
    id: queuedWithdrawalId,
    status: "pending",
    source: "website",
    uploader: { displayName: "Mōchirīī Member", discordUsername: "fixture-member", discordGlobalName: "Fixture Member" },
    title: "Moderator queue fixture",
    caption: "A gallery review fixture.",
    category: "gatherings",
    originalFilename: "moderation-fixture.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    createdAt: fixtureTimestamp,
    reviewedAt: null,
    updatedAt: fixtureTimestamp,
    publicationReady: false,
    sourceValidationState: "validated",
    instagramOptIn: true,
    facebookPageOptIn: true,
    moderationEvents: [],
  };
  return {
    profile,
    memberSubmissions: withdrawalFixtures,
    moderationSubmission: submission,
    withdrawals: [],
    instagramJob: {
      id: instagramJobId,
      status: "queued",
      caption: "A pretty guild showcase from Mōchirīī.",
      altText: "",
      attemptCount: 0,
      createdAt: fixtureTimestamp,
      updatedAt: fixtureTimestamp,
      publishedAt: null,
      galleryPublicationId: "99999999-9999-4999-8999-999999999999",
      thumbnailUrl: null,
      submission,
      events: [],
    },
    facebookJob: {
      id: facebookJobId,
      status: "queued",
      message: "A pretty guild showcase from Mōchirīī.",
      attemptCount: 0,
      createdAt: fixtureTimestamp,
      updatedAt: fixtureTimestamp,
      publishedAt: null,
      galleryPublicationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      thumbnailUrl: null,
      submission: { ...submission, facebookPageOptIn: true },
      events: [],
    },
    publishedFacebookJob: {
      id: publishedFacebookJobId,
      status: "published",
      message: "A verified guild showcase.",
      facebookPhotoId: "123456789012345",
      facebookPostId: "123456789012345_987654321098765",
      facebookPermalink: "https://www.facebook.com/mochirii.guild/posts/987654321098765",
      attemptCount: 1,
      createdAt: fixtureTimestamp,
      updatedAt: fixtureTimestamp,
      publishedAt: fixtureTimestamp,
      galleryPublicationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      thumbnailUrl: null,
      submission: { ...submission, facebookPageOptIn: true },
      events: [],
    },
    withdrawalOutcomes: new Map([
      [queuedWithdrawalId, { state: "canceled", externalRemovalRequired: false, message: "Queued destination job canceled and consent withdrawn." }],
      [quarantinedWithdrawalId, { state: "quarantined", externalRemovalRequired: false, message: "Consent withdrawn and publication quarantined for moderator inspection." }],
      [removalWithdrawalId, { state: "removal_requested", externalRemovalRequired: true, message: "Removal request recorded; external copies may remain." }],
    ]),
    authCalls: [],
    functionCalls: [],
    submissionInserts: [],
    storageUploads: [],
    storageDeletes: [],
    externalRequests: [],
    unexpectedApiRequests: [],
    pageErrors: [],
    consoleErrors: [],
    staleResponseConsoleErrors: [],
    expectedStaleResponses: [],
    failedRequests: [],
    httpErrors: [],
    navigationBaseUrl: baseUrl,
  };
}

function submissionRow(id, title) {
  return {
    id,
    user_id: moderatorId,
    original_filename: `${title.toLowerCase().replaceAll(" ", "-")}.jpg`,
    mime_type: "image/jpeg",
    size_bytes: 2048,
    title,
    caption: "Destination consent fixture.",
    category: "gatherings",
    status: "approved",
    rejection_reason: null,
    reviewed_at: fixtureTimestamp,
    created_at: fixtureTimestamp,
    updated_at: fixtureTimestamp,
    submission_source: "website",
    instagram_opt_in: true,
    facebook_page_opt_in: false,
    upload_rights_confirmed: true,
  };
}

function readyInstagramDiagnostic() {
  return {
    configured: true,
    publishEnabled: true,
    provider: "instagram",
    apiVersion: "v26.0",
    tokenBindingVerified: true,
    tokenTypeVerified: true,
    scopesVerified: true,
    expiryVerified: true,
    dataAccessExpiryVerified: true,
    identityReachable: true,
    identityMatches: true,
    facebookPageReachable: true,
    facebookPageIdentityMatches: true,
    instagramBusinessAccountPresent: true,
    instagramBusinessAccountMatches: true,
    pageToInstagramLinkageVerified: true,
    quotaReadable: true,
    quotaExhausted: false,
    businessAccountSubtypeVerification: "manual_owner_verified",
    ready: true,
    checkedAt: fixtureTimestamp,
    message: "Synthetic read-only diagnostic passed.",
  };
}

function readyFacebookDiagnostic() {
  return {
    configured: true,
    publishEnabled: true,
    provider: "facebook_page",
    apiVersion: "v26.0",
    tokenBindingVerified: true,
    tokenTypeVerified: true,
    scopesVerified: true,
    expiryVerified: true,
    dataAccessExpiryVerified: true,
    identityReachable: true,
    identityMatches: true,
    createContentTaskVerified: true,
    ready: true,
    checkedAt: fixtureTimestamp,
    message: "Synthetic read-only diagnostic passed.",
  };
}

function imageFixture(name, mimeType) {
  const body = mimeType === "image/png"
    ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  return { name, mimeType, buffer: body };
}

function assertSubmissionInsert(body, expected) {
  assert(body && typeof body === "object" && !Array.isArray(body), "Gallery submission insert body was not an object.");
  assert(body.instagram_opt_in === expected.instagram, "Gallery insert carried the wrong Instagram opt-in.");
  assert(body.facebook_page_opt_in === expected.facebook, "Gallery insert carried the wrong Facebook Page opt-in.");
  assert(body.upload_rights_confirmed === true, "Gallery insert omitted the upload-rights attestation.");
  const browserAttestedFields = Object.keys(body).filter((key) =>
    /(?:opt_in_at|consent_(?:version|timestamp)|copy_version|contract_version|derivative_hash|source_object_version)/i.test(key),
  );
  assert(browserAttestedFields.length === 0, `Browser supplied server-attested fields: ${browserAttestedFields.join(", ")}.`);
}

function mutationCount(state) {
  return state.submissionInserts.length + state.storageUploads.length +
    state.functionCalls.filter((entry) => entry.name.startsWith("publish-") || entry.name.startsWith("withdraw-") || entry.name === "moderate-gallery-submission").length;
}

function publishCalls(state, name) {
  return state.functionCalls.filter((entry) => entry.name === name);
}

function singlePublishBody(state, name) {
  const calls = publishCalls(state, name);
  assert(calls.length === 1, `${name} was called ${calls.length} times instead of once.`);
  return calls[0].body;
}

function publicationFingerprint(values) {
  const primaryCopy = normalizeConfirmationText(values.primaryCopy);
  const altText = normalizeConfirmationText(values.altText);
  const copyHash = sha256Hex(JSON.stringify([
    "gallery-social-copy-v1",
    values.destination,
    primaryCopy,
    altText,
  ]));
  return sha256Hex(JSON.stringify([
    "gallery-social-confirmation-v1",
    values.destination,
    values.jobId,
    values.status,
    values.attemptCount,
    new Date(values.updatedAt).toISOString(),
    values.moderatorUserId,
    copyHash,
  ]));
}

function normalizeConfirmationText(value) {
  return String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertExactObject(actual, expected, label) {
  const actualKeys = actual && typeof actual === "object" && !Array.isArray(actual) ? Object.keys(actual).sort() : [];
  const expectedKeys = Object.keys(expected).sort();
  assert(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), `${label} keys were ${JSON.stringify(actualKeys)} instead of ${JSON.stringify(expectedKeys)}.`);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} body did not match its exact contract.`);
}

async function assertHealthyDocument(page, label) {
  const state = await page.evaluate(() => ({
    hasContent: Boolean(document.body.innerText.trim()),
    overlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")),
    hasMain: Boolean(document.querySelector("#main")),
  }));
  assert(state.hasContent, `${label}: page was blank.`);
  assert(!state.overlay, `${label}: framework error overlay was present.`);
  assert(state.hasMain, `${label}: main content was missing.`);
}

async function waitForFocus(page, selector, label, expectedText = "") {
  await page.waitForFunction(({ targetSelector, text }) => {
    const candidates = [...document.querySelectorAll(targetSelector)];
    return candidates.some((node) => node === document.activeElement && (!text || node.textContent?.trim() === text));
  }, { targetSelector: selector, text: expectedText }, { timeout: 2_000 }).catch(() => {
    throw new Error(`${label} did not receive focus.`);
  });
}

async function waitForCheckedState(page, selector, expected, label) {
  await page.waitForFunction(({ targetSelector, checked }) => {
    const node = document.querySelector(targetSelector);
    return node instanceof HTMLInputElement && node.checked === checked;
  }, { targetSelector: selector, checked: expected }, { timeout: 2_000 }).catch(() => {
    throw new Error(`${label}.`);
  });
}

async function assertAxe(page, selector, label) {
  if (!existsSync(axePath)) return;
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async (rootSelector) => {
    const root = document.querySelector(rootSelector);
    if (!root) return ["missing-root"];
    const result = await window.axe.run(root, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => ["critical", "serious"].includes(violation.impact || ""))
      .map((violation) => `${violation.id}:${violation.nodes.length}`);
  }, selector);
  assert(violations.length === 0, `${label}: serious accessibility findings: ${violations.join(", ")}.`);
}

async function assertCompactReflow(page, selector, label) {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addStyleTag({ content: "html{font-size:200%!important}" });
  await assertNoHorizontalOverflow(page, `${label} at 320x568 and 200% text`);
  const escaped = await page.locator(selector).evaluate((rootNode) => {
    const viewportWidth = document.documentElement.clientWidth;
    return [...rootNode.querySelectorAll("button,input,select,textarea,a")]
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      })
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < -1 || rect.right > viewportWidth + 1;
      })
      .map((node) => node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 80) || node.tagName)
      .slice(0, 10);
  });
  assert(escaped.length === 0, `${label}: controls escaped the 320px viewport: ${escaped.join(", ")}.`);
}

async function assertNoHorizontalOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    documentWidth: Math.ceil(document.documentElement.scrollWidth),
    viewportWidth: Math.ceil(document.documentElement.clientWidth),
  }));
  assert(geometry.documentWidth <= geometry.viewportWidth + 1, `${label}: horizontal overflow (${geometry.documentWidth}px versus ${geometry.viewportWidth}px).`);
}

function assertNoNetworkEscapes(state, label) {
  assert(state.externalRequests.length === 0, `${label}: external requests were attempted: ${state.externalRequests.join(" | ")}.`);
  assert(state.unexpectedApiRequests.length === 0, `${label}: unexpected synthetic API requests: ${state.unexpectedApiRequests.join(" | ")}.`);
  assert(
    state.functionCalls.every((entry) => !/(?:group|groups-api)/i.test(entry.name)),
    `${label}: removed Groups API function path was requested.`,
  );
}

function assertNoPageErrors(state, label, expectedStalePaths = []) {
  const failures = [
    ...state.pageErrors,
    ...state.consoleErrors,
    ...state.failedRequests,
    ...state.httpErrors,
  ];
  assert(failures.length === 0, `${label}: browser errors: ${failures.join(" | ")}.`);
  assert(
    JSON.stringify([...state.expectedStaleResponses].sort()) === JSON.stringify([...expectedStalePaths].sort()),
    `${label}: stale-response paths were ${JSON.stringify(state.expectedStaleResponses)} instead of ${JSON.stringify(expectedStalePaths)}.`,
  );
  assert(
    state.staleResponseConsoleErrors.length === expectedStalePaths.length,
    `${label}: expected ${expectedStalePaths.length} browser 409 diagnostics, observed ${state.staleResponseConsoleErrors.length}.`,
  );
}

function edgeSuccess(route, data, message = undefined) {
  return fulfillJson(route, 200, { ok: true, data, ...(message ? { message } : {}) });
}

function edgeFailure(route, status, message) {
  return fulfillJson(route, status, { ok: false, message });
}

async function fulfillJson(route, status, payload, extraHeaders = {}) {
  await route.fulfill({
    status,
    ...(status === 204 ? {} : { contentType: "application/json", body: JSON.stringify(payload) }),
    headers: {
      "access-control-allow-origin": baseUrl,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-upsert",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      ...extraHeaders,
    },
  });
}

function generatedSubmissionId(index) {
  return index === 1
    ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    : "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
}

function safeChildEnvironment() {
  const value = (...keys) => keys.map((key) => process.env[key]).find((entry) => typeof entry === "string" && entry.length > 0);
  const allowed = {
    PATH: value("PATH", "Path") || "",
    SystemRoot: value("SystemRoot", "SYSTEMROOT") || "C:\\Windows",
    WINDIR: value("WINDIR", "windir") || "C:\\Windows",
    TEMP: value("TEMP") || "",
    TMP: value("TMP") || value("TEMP") || "",
    COMSPEC: value("COMSPEC", "ComSpec") || "C:\\Windows\\System32\\cmd.exe",
    PATHEXT: value("PATHEXT") || ".COM;.EXE;.BAT;.CMD",
  };
  for (const key of ["APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"]) {
    const entry = value(key);
    if (entry) allowed[key] = entry;
  }
  return allowed;
}

function unsignedJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.c3ludGhldGlj`;
}

function secureLoopbackUrl(value) {
  const url = new URL(value);
  assert(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "WebKit bridge requires an HTTP loopback origin.");
  url.protocol = "https:";
  return url.href.replace(/\/$/, "");
}

async function waitForMemberPanel(page, state, label) {
  try {
    await page.locator("#uploadPanel").waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    const diagnostic = await page.evaluate(() => ({
      path: window.location.pathname,
      storageKeys: Object.keys(window.localStorage),
      hasSignedOutPanel: Boolean(document.querySelector("#uploadGate")),
      body: document.body.innerText.replace(/\s+/g, " ").slice(0, 240),
    })).catch(() => ({ path: "unavailable", storageKeys: [], hasSignedOutPanel: false, body: "" }));
    throw new Error(`${label}: member upload panel did not become ready: ${JSON.stringify({
      ...diagnostic,
      authCallCount: state.authCalls.length,
      functionNames: state.functionCalls.map((entry) => entry.name),
      unexpectedApiRequests: state.unexpectedApiRequests,
      pageErrorCount: state.pageErrors.length + state.consoleErrors.length,
    })}.`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeMessage(value) {
  return String(value || "unknown error")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .slice(0, 500);
}

function boundedOutput(current, chunk) {
  return `${current}${String(chunk)}`.slice(-12_000);
}

function reserveSafeLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const socket = createNetServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close(() => reject(new Error("Could not reserve a loopback port.")));
        return;
      }
      socket.close(async (error) => {
        if (error) return reject(error);
        if (forbiddenSharedPorts.has(address.port)) {
          try {
            resolvePort(await reserveSafeLoopbackPort());
          } catch (caught) {
            reject(caught);
          }
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

function runChild(command, args, options, label, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, options);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} timed out.`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolveRun();
      else reject(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
    });
  });
}

async function waitUntilReady(child, url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next production server exited before readiness. ${safeMessage(serverOutput)}`);
    }
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Retry until the bounded readiness deadline.
    }
    await delay(150);
  }
  throw new Error(`Next production server did not become ready. ${safeMessage(serverOutput)}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(5_000),
  ]);
}
