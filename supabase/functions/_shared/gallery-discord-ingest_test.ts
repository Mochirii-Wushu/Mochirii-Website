import {
  downloadAllowlistedAttachment,
  GalleryDiscordIngestError,
  type GalleryDiscordIngestErrorCode,
  galleryDiscordIngestErrorCode,
  validDiscordGalleryAttachmentUrl,
} from "./gallery-discord-ingest.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ATTACHMENT_PATH =
  "/attachments/9000000000000001/9000000000000002/image.png";

const allow = validDiscordGalleryAttachmentUrl;

async function expectCode(
  expected: GalleryDiscordIngestErrorCode,
  operation: () => Promise<unknown>,
): Promise<GalleryDiscordIngestError> {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof GalleryDiscordIngestError,
      "error must be normalized",
    );
    assert(
      error.code === expected,
      `expected ${expected}, received ${error.code}`,
    );
    return error;
  }
  throw new Error(`expected ${expected}`);
}

Deno.test("manually follows at most three allowlisted attachment redirects", async () => {
  const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> =
    [];
  const result = await downloadAllowlistedAttachment({
    initialUrl: `https://cdn.discordapp.com${ATTACHMENT_PATH}?signed=initial`,
    isAllowedUrl: allow,
    maximumBytes: 8,
    timeoutMs: 500,
    fetcher: (async (input, init) => {
      calls.push({ url: String(input), redirect: init?.redirect });
      return calls.length === 1
        ? new Response(null, {
          status: 302,
          headers: {
            Location:
              `https://cdn.discordapp.com${ATTACHMENT_PATH}?signed=final`,
          },
        })
        : new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Content-Length": "3",
          },
        });
    }) as typeof fetch,
  });
  assert(result.bytes.length === 3, "attachment bytes were not returned");
  assert(result.contentType === "image/png", "content type was not returned");
  assert(calls.length === 2, "expected one manually followed redirect");
  assert(
    calls.every((call) => call.redirect === "manual"),
    "fetch must never follow redirects implicitly",
  );

  for (
    const location of [
      "https://example.test/attachments/9000000000000001/9000000000000002/x.png",
      "",
    ]
  ) {
    await expectCode(
      "attachment_redirect_invalid",
      () =>
        downloadAllowlistedAttachment({
          initialUrl: `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
          isAllowedUrl: allow,
          maximumBytes: 8,
          timeoutMs: 500,
          fetcher: (async () =>
            new Response(null, {
              status: 302,
              headers: location ? { Location: location } : {},
            })) as typeof fetch,
        }),
    );
  }

  let redirectCalls = 0;
  await expectCode(
    "attachment_redirect_limit",
    () =>
      downloadAllowlistedAttachment({
        initialUrl: `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
        isAllowedUrl: allow,
        maximumBytes: 8,
        timeoutMs: 500,
        fetcher: (async () => {
          redirectCalls += 1;
          return new Response(null, {
            status: 302,
            headers: {
              Location: `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
            },
          });
        }) as typeof fetch,
      }),
  );
  assert(
    redirectCalls === 4,
    "a fourth redirect must fail before a fifth request",
  );
});

Deno.test("allows only exact HTTPS Discord attachment origins and paths", () => {
  for (
    const hostname of [
      "cdn.discordapp.com",
      "media.discordapp.net",
      "media.discordapp.com",
    ]
  ) {
    assert(
      validDiscordGalleryAttachmentUrl(
        `https://${hostname}${ATTACHMENT_PATH}?ex=1&is=2&hm=synthetic`,
      ) !== null,
      `${hostname} attachment URL was rejected`,
    );
  }
  assert(
    validDiscordGalleryAttachmentUrl(
      "https://cdn.discordapp.com/ephemeral-attachments/9000000000000001/9000000000000002/image.webp",
    ) !== null,
    "ephemeral attachment URL was rejected",
  );
  assert(
    validDiscordGalleryAttachmentUrl(
      `https://cdn.discordapp.com${ATTACHMENT_PATH}?synthetic=1`,
      "9000000000000001",
      "9000000000000002",
    ) !== null,
    "exact body channel and attachment identity was rejected",
  );

  for (
    const invalid of [
      `http://cdn.discordapp.com${ATTACHMENT_PATH}`,
      `https://cdn.discordapp.com.evil.test${ATTACHMENT_PATH}`,
      `https://user:password@cdn.discordapp.com${ATTACHMENT_PATH}`,
      `https://cdn.discordapp.com:444${ATTACHMENT_PATH}`,
      `https://cdn.discordapp.com${ATTACHMENT_PATH}#fragment`,
      "https://cdn.discordapp.com/not-attachments/image.png",
      "https://cdn.discordapp.com/attachments/1/2/image.png",
      `https://cdn.discordapp.com${ATTACHMENT_PATH}/nested`,
      ` https://cdn.discordapp.com${ATTACHMENT_PATH}`,
      `HTTPS://cdn.discordapp.com${ATTACHMENT_PATH}`,
      `https://cdn.discordapp.com/ignored/../${ATTACHMENT_PATH.slice(1)}`,
      "not a URL",
    ]
  ) {
    assert(
      validDiscordGalleryAttachmentUrl(invalid) === null,
      `unsafe attachment URL was accepted: ${invalid}`,
    );
  }
  assert(
    validDiscordGalleryAttachmentUrl(
      `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
      "9000000000000099",
      "9000000000000002",
    ) === null,
    "URL channel identity must match the HMAC-bound body",
  );
  assert(
    validDiscordGalleryAttachmentUrl(
      `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
      "9000000000000001",
      "9000000000000099",
    ) === null,
    "URL attachment identity must match the HMAC-bound body",
  );
});

Deno.test("bounds declared and streamed attachment lengths and cancels oversize bodies", async () => {
  for (const contentLength of ["9", "not-a-number", "9007199254740992"]) {
    await expectCode(
      "attachment_too_large",
      () =>
        downloadAllowlistedAttachment({
          initialUrl: `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
          isAllowedUrl: allow,
          maximumBytes: 8,
          timeoutMs: 500,
          fetcher: (async () =>
            new Response(new Uint8Array([1]), {
              headers: { "Content-Length": contentLength },
            })) as typeof fetch,
        }),
    );
  }

  let cancelled = false;
  const oversizedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expectCode("attachment_too_large", () =>
    downloadAllowlistedAttachment({
      initialUrl: `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
      isAllowedUrl: allow,
      maximumBytes: 2,
      timeoutMs: 500,
      fetcher: (async () => new Response(oversizedStream)) as typeof fetch,
    }));
  assert(cancelled, "the 8 MiB+1 streaming boundary must cancel the body");

  await expectCode(
    "attachment_content_length_mismatch",
    () =>
      downloadAllowlistedAttachment({
        initialUrl: `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
        isAllowedUrl: allow,
        maximumBytes: 8,
        timeoutMs: 500,
        fetcher: (async () =>
          new Response(new Uint8Array([1, 2]), {
            headers: { "Content-Length": "1" },
          })) as typeof fetch,
      }),
  );
});

Deno.test("applies one deadline to fetch and response streaming", async () => {
  await expectCode("attachment_timeout", () =>
    downloadAllowlistedAttachment({
      initialUrl: `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
      isAllowedUrl: allow,
      maximumBytes: 8,
      timeoutMs: 10,
      fetcher: ((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
          );
        })) as typeof fetch,
    }));

  await expectCode("attachment_timeout", () =>
    downloadAllowlistedAttachment({
      initialUrl: `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
      isAllowedUrl: allow,
      maximumBytes: 8,
      timeoutMs: 10,
      fetcher: ((_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("aborted", "AbortError")));
          },
        });
        return Promise.resolve(new Response(body));
      }) as typeof fetch,
    }));
});

Deno.test("normalizes HTTP, URL, and attacker-controlled fetch failures", async () => {
  await expectCode(
    "attachment_url_invalid",
    () =>
      downloadAllowlistedAttachment({
        initialUrl: "http://cdn.discordapp.com/not-allowed",
        isAllowedUrl: allow,
        maximumBytes: 8,
        timeoutMs: 500,
      }),
  );
  await expectCode(
    "attachment_http_error",
    () =>
      downloadAllowlistedAttachment({
        initialUrl: `https://cdn.discordapp.com${ATTACHMENT_PATH}`,
        isAllowedUrl: allow,
        maximumBytes: 8,
        timeoutMs: 500,
        fetcher: (async () =>
          new Response("remote signed detail", {
            status: 503,
          })) as typeof fetch,
      }),
  );

  const sentinel = "SIGNED_QUERY_MUST_NOT_SURVIVE";
  const signedUrl =
    `https://cdn.discordapp.com${ATTACHMENT_PATH}?hm=${sentinel}`;
  const failure = await expectCode(
    "attachment_fetch_failed",
    () =>
      downloadAllowlistedAttachment({
        initialUrl: signedUrl,
        isAllowedUrl: allow,
        maximumBytes: 8,
        timeoutMs: 500,
        fetcher: (async () => {
          throw new Error(`network failure for ${signedUrl}`);
        }) as typeof fetch,
      }),
  );
  assert(
    !String(failure).includes(sentinel),
    "signed query leaked through error text",
  );
  assert(
    !JSON.stringify(failure).includes(sentinel),
    "signed query leaked through serialized error state",
  );
  assert(
    galleryDiscordIngestErrorCode(new Error(`remote ${sentinel}`)) ===
      "attachment_fetch_failed",
    "unknown errors must map to the fixed fallback code",
  );
});
