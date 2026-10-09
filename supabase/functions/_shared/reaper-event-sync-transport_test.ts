import {
  createEventSyncDiscordApi,
  EventSyncPause,
} from "./reaper-event-sync-transport.ts";

const base = "https://discord.com/api/v10";
const path = "/guilds/123456789012345678/scheduled-events";
const wall = Date.parse("2026-10-09T08:00:00.000Z");
const fence = async () => {};
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function failure(task: () => unknown | Promise<unknown>): Promise<Error> {
  try {
    await task();
  } catch (error) {
    assert(error instanceof Error);
    return error;
  }
  throw new Error("Expected rejection");
}
function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

Deno.test("event sync 429 pauses without retry and honors the longest complete delay", async () => {
  for (
    const [body, headers, delay] of [
      [{ retry_after: 65.25 }, {}, 65_250],
      [{}, { "Retry-After": "66.001" }, 66_001],
      [{}, { "X-RateLimit-Reset-After": "67.1" }, 67_100],
      [{ retry_after: 65.25 }, {
        "Retry-After": "70",
        "X-RateLimit-Reset-After": "80.001",
      }, 80_001],
      [{ retry_after: 0.0001 }, {}, 1],
    ] as const
  ) {
    let calls = 0;
    let fences = 0;
    const api = createEventSyncDiscordApi(base, {
      fetch: (() => {
        calls += 1;
        return Promise.resolve(json(body, 429, headers));
      }) as typeof fetch,
      monotonicNow: () => 0,
      wallNow: () => wall,
    });
    const error = await failure(() =>
      api(path, { method: "POST" }, async () => {
        fences += 1;
      })
    );
    assert(error instanceof EventSyncPause && error.reason === "rate_limit");
    assert(error.notBeforeIso === new Date(wall + delay).toISOString());
    assert(
      calls === 1 && fences === 1,
      "429 must never be retried within the invocation",
    );
  }
});

Deno.test("event sync missing, malformed, conflicting-invalid and unsafe 429 delays fail closed", async () => {
  const cases: Array<() => Response> = [
    () => json({}, 429),
    () => json({ retry_after: 0 }, 429),
    () => json({ retry_after: -1 }, 429),
    () => json({ retry_after: "65" }, 429),
    () => json({ retry_after: 1e300 }, 429),
    () => json({ retry_after: 604800.001 }, 429),
    () => json({ retry_after: 65 }, 429, { "Retry-After": "invalid" }),
    () => json({ retry_after: 65 }, 429, { "Retry-After": "0" }),
    () => json({ retry_after: 65 }, 429, { "X-RateLimit-Reset-After": "-1" }),
    () => json({ retry_after: 0 }, 429, { "Retry-After": "65" }),
    () => json([], 429, { "Retry-After": "65" }),
    () =>
      new Response("<html>rate limited</html>", {
        status: 429,
        headers: { "Retry-After": "65", "Content-Type": "text/html" },
      }),
    () =>
      new Response("{", {
        status: 429,
        headers: { "Retry-After": "65", "Content-Type": "application/json" },
      }),
  ];
  for (const response of cases) {
    let calls = 0;
    const api = createEventSyncDiscordApi(base, {
      fetch: (() => {
        calls += 1;
        return Promise.resolve(response());
      }) as typeof fetch,
      monotonicNow: () => 0,
      wallNow: () => wall,
    });
    assert(
      !(await failure(() => api(path, { method: "POST" }, fence)) instanceof
        EventSyncPause),
    );
    assert(calls === 1);
  }
  const api = createEventSyncDiscordApi(base, {
    fetch: (() =>
      Promise.resolve(json({ retry_after: 1 }, 429))) as typeof fetch,
    monotonicNow: () => 0,
    wallNow: () => 8_640_000_000_000_000,
  });
  assert(!(await failure(() => api(path)) instanceof EventSyncPause));
});

Deno.test("event sync returns successful acknowledgements before pausing the next exhausted-bucket request", async () => {
  let now = 0;
  let calls = 0;
  let fences = 0;
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(
        json({ id: "123456789012345678" }, 200, {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset-After": "65.25",
        }),
      );
    }) as typeof fetch,
    monotonicNow: () => now,
    wallNow: () => wall + now,
  });
  const acknowledged = await api(path, { method: "POST" }, async () => {
    fences += 1;
  });
  assert(
    acknowledged.ok &&
      (acknowledged.data as { id: string }).id === "123456789012345678",
  );
  const paused = await failure(() =>
    api(path, { method: "PATCH" }, async () => {
      fences += 1;
    })
  );
  assert(paused instanceof EventSyncPause && paused.reason === "rate_limit");
  assert(
    paused.notBeforeIso === "2026-10-09T08:01:05.250Z" && calls === 1 &&
      fences === 1,
  );
  now = 65_250;
  assert(
    (await api(path)).ok && Number(calls) === 2,
    "Never send again before the full reset interval",
  );
});

Deno.test("event sync does not infer cooldowns from invalid optional success headers", async () => {
  const successHeaders: HeadersInit[] = [
    { "X-RateLimit-Remaining": "0" },
    { "X-RateLimit-Remaining": "1", "X-RateLimit-Reset-After": "65" },
    { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "-1" },
    { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "604800.001" },
  ];
  for (const headers of successHeaders) {
    let calls = 0;
    const api = createEventSyncDiscordApi(base, {
      fetch: (() => {
        calls += 1;
        return Promise.resolve(json({}, 200, headers));
      }) as typeof fetch,
      monotonicNow: () => 0,
    });
    assert((await api(path)).ok && (await api(path)).ok && calls === 2);
  }
});

Deno.test("event sync retains a known full cooldown even after its invocation deadline", async () => {
  let now = 0;
  let calls = 0;
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(
        json({}, 200, {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset-After": "65",
        }),
      );
    }) as typeof fetch,
    monotonicNow: () => now,
    wallNow: () => wall + now,
  });
  now = 70_000;
  assert((await api(path, { method: "POST" }, fence)).ok);
  now = 76_000; // Durable registry recording also consumed time.
  const paused = await failure(() => api(path));
  assert(paused instanceof EventSyncPause && paused.reason === "rate_limit");
  assert(paused.notBeforeIso === "2026-10-09T08:02:15.000Z" && calls === 1);
});

Deno.test("event sync invocation deadline includes preflight and earlier requests", async () => {
  let now = 0;
  let calls = 0;
  let fences = 0;
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(json([]));
    }) as typeof fetch,
    monotonicNow: () => now,
    wallNow: () => wall,
  });
  now = 50_000; // Workflow schedule/image/registry preflight already consumed time.
  assert((await api(path)).ok && calls === 1);
  now = 75_000;
  const error = await failure(() =>
    api(path, { method: "POST" }, async () => {
      fences += 1;
    })
  );
  assert(
    error instanceof EventSyncPause && error.reason === "deadline" &&
      error.notBeforeIso === new Date(wall).toISOString(),
  );
  assert(
    calls === 1 && fences === 0,
    "No fence or wire request after admission deadline",
  );

  now = 0;
  const afterFence = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(json({}));
    }) as typeof fetch,
    monotonicNow: () => now,
    wallNow: () => wall,
  });
  const paused = await failure(() =>
    afterFence(path, { method: "PATCH" }, async () => {
      now = 75_000;
    })
  );
  assert(paused instanceof EventSyncPause && paused.reason === "deadline");
  assert(calls === 1, "Fence time is charged before any wire attempt");
});

Deno.test("event sync fences each mutation and cannot accept callback or fetch pause impersonation", async () => {
  const order: string[] = [];
  const api = createEventSyncDiscordApi(base, {
    fetch: ((_url, init) => {
      order.push(init?.method ?? "");
      return Promise.resolve(
        init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : json({ id: "123456789012345678" }),
      );
    }) as typeof fetch,
    monotonicNow: () => 0,
    wallNow: () => wall,
  });
  await api(path);
  for (const method of ["POST", "PATCH", "DELETE"]) {
    await api(path, { method }, async () => {
      order.push("fence");
    });
  }
  assert(order.join(",") === "GET,fence,POST,fence,PATCH,fence,DELETE");
  assert(
    !(await failure(() => api(path, { method: "POST" })) instanceof
      EventSyncPause),
  );
  assert(
    !(await failure(() =>
      api(path, { method: "POST" }, async () => {
        throw new EventSyncPause("deadline", new Date(wall).toISOString());
      })
    ) instanceof EventSyncPause),
  );
  assert(order.length === 7, "Rejected fences must not send requests");
  const throwing = createEventSyncDiscordApi(base, {
    fetch: (() =>
      Promise.reject(
        new EventSyncPause("deadline", new Date(wall).toISOString()),
      )) as typeof fetch,
    monotonicNow: () => 0,
  });
  assert(!(await failure(() => throwing(path)) instanceof EventSyncPause));
});

Deno.test("event sync fetch and body timeouts remain ambiguous errors and abort the request", async () => {
  for (const bodyWait of [false, true]) {
    let now = 0;
    let aborted = false;
    let cancelled = false;
    const api = createEventSyncDiscordApi(base, {
      fetch: ((_url, init) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        }, { once: true });
        if (!bodyWait) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        }
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("{"));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }) as typeof fetch,
      monotonicNow: () => now,
    });
    now = 74_999;
    const error = await failure(() => api(path, { method: "POST" }, fence));
    assert(!(error instanceof EventSyncPause) && aborted);
    if (bodyWait) assert(cancelled, "Body reader must be cancelled on timeout");
  }
});

Deno.test("event sync body processing time and caller aborts cannot become safe pauses", async () => {
  let now = 0;
  const lateBody = createEventSyncDiscordApi(base, {
    fetch: (() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              now = 10_000;
              controller.enqueue(new TextEncoder().encode("{}"));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )) as typeof fetch,
    monotonicNow: () => now,
  });
  assert(!(await failure(() => lateBody(path)) instanceof EventSyncPause));
  now = 0;
  let pulls = 0;
  let cancelled = false;
  const emptyChunks = createEventSyncDiscordApi(base, {
    fetch: (() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              pulls += 1;
              now += 6_000;
              controller.enqueue(new Uint8Array());
              if (pulls === 100) controller.close();
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )) as typeof fetch,
    monotonicNow: () => now,
  });
  assert(!(await failure(() => emptyChunks(path)) instanceof EventSyncPause));
  assert(
    cancelled && pulls < 5,
    "Clock bound must apply during body reads, including empty chunks",
  );
  const controller = new AbortController();
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      controller.abort();
      return new Promise(() => {});
    }) as typeof fetch,
    monotonicNow: () => 0,
  });
  assert(
    !(await failure(() => api(path, { signal: controller.signal })) instanceof
      EventSyncPause),
  );
});

Deno.test("event sync response validation bounds actual bytes and rejects malformed success and redirects", async () => {
  const responses = [
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://example.com" },
      }),
    () =>
      new Response("<html>ok</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    () =>
      new Response("{", { headers: { "Content-Type": "application/json" } }),
    () => json(null),
    () => json("ok"),
    () => new Response(null, { status: 204 }),
    () => json({}, 200, { "Content-Length": "1048577" }),
    () =>
      new Response('{"value":"' + "x".repeat(1024 * 1024) + '"}', {
        headers: { "Content-Type": "application/json", "Content-Length": "10" },
      }),
    () =>
      new Response(new Uint8Array([0xff]), {
        headers: { "Content-Type": "application/json" },
      }),
  ];
  for (const response of responses) {
    const api = createEventSyncDiscordApi(base, {
      fetch: ((_url, init) => {
        assert(init?.redirect === "error");
        return Promise.resolve(response());
      }) as typeof fetch,
      monotonicNow: () => 0,
    });
    assert(
      !(await failure(() => api(path, { redirect: "follow" })) instanceof
        EventSyncPause),
    );
  }
});

Deno.test("event sync ordinary HTTP failures, caller aborts and unsafe endpoints never become safe pauses", async () => {
  let calls = 0;
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(json({ message: "forbidden" }, 403));
    }) as typeof fetch,
    monotonicNow: () => 0,
  });
  const result = await api(path);
  assert(!result.ok && result.status === 403);
  const controller = new AbortController();
  controller.abort();
  assert(
    !(await failure(() => api(path, { signal: controller.signal })) instanceof
      EventSyncPause),
  );
  for (
    const invalid of [
      "https://example.com",
      path + "/../members",
      path + "?redirect=1",
      "/guilds/short/scheduled-events",
    ]
  ) {
    assert(!(await failure(() => api(invalid)) instanceof EventSyncPause));
  }
  assert(calls === 1);
  assert(
    !(await failure(() =>
      createEventSyncDiscordApi("https://example.com/api/v10")
    ) instanceof EventSyncPause),
  );
});
