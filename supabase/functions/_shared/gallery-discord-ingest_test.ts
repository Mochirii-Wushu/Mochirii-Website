import {
  constantTimeSecretEquals,
  downloadAllowlistedAttachment,
  GalleryDiscordIngestError,
  galleryDiscordIngestErrorCode,
  readBoundedJsonRecord,
} from "./gallery-discord-ingest.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const allow = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.discordapp.com" &&
        url.pathname.includes("/attachments/")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

Deno.test("ingest secrets use a fixed-length digest comparison", async () => {
  assert(await constantTimeSecretEquals("same-secret", "same-secret"), "equal secret rejected");
  assert(!await constantTimeSecretEquals("same-secret", "other-secret"), "different secret accepted");
  assert(!await constantTimeSecretEquals("short", "longer"), "different-length secret accepted");
});

Deno.test("request JSON is content-type checked and bounded while streaming", async () => {
  const valid = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  });
  assert((await readBoundedJsonRecord(valid, 64))?.ok === true, "valid JSON rejected");
  const oversized = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(100) }),
  });
  assert(await readBoundedJsonRecord(oversized, 32) === null, "oversized JSON accepted");
});

Deno.test("attachment redirects remain manual and inside the allowlist", async () => {
  const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
  const result = await downloadAllowlistedAttachment({
    initialUrl: "https://cdn.discordapp.com/attachments/1/2/original.png",
    isAllowedUrl: allow,
    maximumBytes: 32,
    timeoutMs: 500,
    fetcher: (async (input, init) => {
      calls.push({ url: String(input), redirect: init?.redirect });
      return calls.length === 1
        ? new Response(null, {
          status: 302,
          headers: { Location: "https://cdn.discordapp.com/attachments/1/2/final.png" },
        })
        : new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png", "Content-Length": "3" },
        });
    }) as typeof fetch,
  });
  assert(result.bytes.length === 3, "attachment bytes missing");
  assert(calls.length === 2 && calls.every((call) => call.redirect === "manual"), "redirects were followed implicitly");

  let rejected = false;
  try {
    await downloadAllowlistedAttachment({
      initialUrl: "https://cdn.discordapp.com/attachments/1/2/original.png",
      isAllowedUrl: allow,
      maximumBytes: 32,
      timeoutMs: 500,
      fetcher: (async () => new Response(null, {
        status: 302,
        headers: { Location: "https://example.test/attachments/escape.png" },
      })) as typeof fetch,
    });
  } catch (error) {
    rejected = error instanceof GalleryDiscordIngestError &&
      error.code === "attachment_redirect_invalid";
  }
  assert(rejected, "cross-host redirect was accepted");
});

Deno.test("attachment bodies and deadlines fail closed", async () => {
  let oversized = false;
  try {
    await downloadAllowlistedAttachment({
      initialUrl: "https://cdn.discordapp.com/attachments/1/2/image.png",
      isAllowedUrl: allow,
      maximumBytes: 2,
      timeoutMs: 500,
      fetcher: (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch,
    });
  } catch (error) {
    oversized = error instanceof GalleryDiscordIngestError && error.code === "attachment_too_large";
  }
  assert(oversized, "oversized attachment was accepted");

  let timedOut = false;
  try {
    await downloadAllowlistedAttachment({
      initialUrl: "https://cdn.discordapp.com/attachments/1/2/image.png",
      isAllowedUrl: allow,
      maximumBytes: 32,
      timeoutMs: 10,
      fetcher: ((_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch,
    });
  } catch (error) {
    timedOut = error instanceof GalleryDiscordIngestError && error.code === "attachment_timeout";
  }
  assert(timedOut, "attachment timeout was not enforced");
});

Deno.test("attachment fetch failures never retain signed URL details", async () => {
  const sentinel = "SIGNED_URL_SECRET_MUST_NOT_REACH_LOGS";
  const signedUrl =
    `https://cdn.discordapp.com/attachments/1/2/image.png?ex=1&is=2&hm=${sentinel}`;
  let failure: unknown;

  try {
    await downloadAllowlistedAttachment({
      initialUrl: signedUrl,
      isAllowedUrl: allow,
      maximumBytes: 32,
      timeoutMs: 500,
      fetcher: (async () => {
        throw new Error(`network failure while requesting ${signedUrl}`);
      }) as typeof fetch,
    });
  } catch (error) {
    failure = error;
  }

  assert(
    failure instanceof GalleryDiscordIngestError,
    "raw attachment fetch error escaped the ingest boundary",
  );
  assert(
    galleryDiscordIngestErrorCode(failure) === "attachment_fetch_failed",
    "raw attachment fetch error did not map to the fixed fallback code",
  );
  assert(
    !String(failure).includes(sentinel),
    "signed attachment URL detail survived error normalization",
  );
  assert(
    galleryDiscordIngestErrorCode(
      new Error(`unexpected failure containing ${sentinel}`),
    ) === "attachment_fetch_failed",
    "unexpected errors did not map to the fixed fallback code",
  );
});
