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

Deno.test("event sync returns successful acknowledgements before pausing the next exhausted-route request", async () => {
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
    api(path, { method: "POST" }, async () => {
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
    (await api(path, { method: "POST" }, fence)).ok && Number(calls) === 2,
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

Deno.test("exhausted preflight GET never blocks seventeen unknown write routes or fresh invocations", async () => {
  for (let invocation = 0; invocation < 3; invocation += 1) {
    let writes = 0;
    let fences = 0;
    let calls = 0;
    const api = createEventSyncDiscordApi(base, {
      fetch: ((_url, init) => {
        calls += 1;
        if (init?.method === "GET") {
          return Promise.resolve(json([], 200, {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset-After": "8",
            "X-RateLimit-Bucket": "read-list",
          }));
        }
        writes += 1;
        return Promise.resolve(json({}, 200, {
          "X-RateLimit-Remaining": "1",
          "X-RateLimit-Bucket": "write-event",
        }));
      }) as typeof fetch,
      monotonicNow: () => 0,
      wallNow: () => wall + invocation * 8001,
      wait: () => {
        throw new Error("Unrelated GET must never cause waiting");
      },
    });
    assert((await api(path)).ok);
    for (let index = 0; index < 17; index += 1) {
      assert(
        (await api(`${path}/${123456789012345680n + BigInt(index)}`, {
          method: "PATCH",
        }, async () => {
          fences += 1;
        })).ok,
      );
    }
    assert(writes === 17 && fences === 17 && calls === 18);
  }
});

Deno.test("unknown or malformed bucket cooldowns are scoped to method normalized route and guild", async () => {
  for (
    const bucket of [null, "", "invalid bucket", "x".repeat(129), "caf\u00e9"]
  ) {
    let calls = 0;
    const api = createEventSyncDiscordApi(base, {
      fetch: (() => {
        calls += 1;
        return Promise.resolve(json({}, 200, {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset-After": "100",
          ...(bucket === null ? {} : { "X-RateLimit-Bucket": bucket }),
        }));
      }) as typeof fetch,
      monotonicNow: () => 0,
      wallNow: () => wall,
      wait: () => {
        throw new Error("Long resets must pause");
      },
    });
    const first = `${path}/123456789012345680`;
    const second = `${path}/123456789012345681`;
    assert((await api(first, { method: "PATCH" }, fence)).ok);
    const paused = await failure(() => api(second, { method: "PATCH" }, fence));
    assert(paused instanceof EventSyncPause && paused.reason === "rate_limit");
    assert(calls === 1, "Event IDs must normalize to the same route");
    assert((await api(first, { method: "DELETE" }, fence)).ok);
    assert((await api(path, { method: "POST" }, fence)).ok);
    assert(
      (await api(first.replace("123456789012345678", "223456789012345678"), {
        method: "PATCH",
      }, fence)).ok,
    );
    assert(
      Number(calls) === 4,
      "Other methods, route shapes and guilds remain independent",
    );
  }
});

Deno.test("learned shared buckets wait the full reset then fence immediately before the wire", async () => {
  for (
    const laterBucket of ["shared", null, "invalid bucket", "x".repeat(129)]
  ) {
    let now = 0;
    let reads = 0;
    const order: string[] = [];
    const api = createEventSyncDiscordApi(base, {
      fetch: ((_url, init) => {
        const method = init?.method ?? "GET";
        order.push(method);
        if (method === "GET") reads += 1;
        return Promise.resolve(json({}, 200, {
          "X-RateLimit-Remaining": reads === 2 && method === "GET" ? "0" : "1",
          "X-RateLimit-Reset-After": "8.001",
          ...(reads === 2 && method === "GET"
            ? laterBucket === null ? {} : { "X-RateLimit-Bucket": laterBucket }
            : { "X-RateLimit-Bucket": "shared" }),
        }));
      }) as typeof fetch,
      monotonicNow: () => now,
      wallNow: () => wall + now,
      wait: (milliseconds) => {
        assert(milliseconds === 8001);
        order.push(`wait:${milliseconds}`);
        now += milliseconds;
        return Promise.resolve();
      },
    });
    const before = async () => {
      order.push("fence");
    };
    await api(path);
    await api(`${path}/123456789012345680`, { method: "PATCH" }, before);
    await api(path);
    assert(
      (await api(`${path}/123456789012345681`, { method: "PATCH" }, before)).ok,
    );
    assert(order.join(",") === "GET,fence,PATCH,GET,wait:8001,fence,PATCH");
  }
});

Deno.test("different known buckets and guild majors do not inherit exhausted capacity", async () => {
  let calls = 0;
  const api = createEventSyncDiscordApi(base, {
    fetch: ((_url, init) => {
      calls += 1;
      return Promise.resolve(json({}, 200, {
        "X-RateLimit-Bucket": init?.method === "GET" ? "read" : "write",
        "X-RateLimit-Remaining": calls === 3 ? "0" : "1",
        "X-RateLimit-Reset-After": "100",
      }));
    }) as typeof fetch,
    monotonicNow: () => 0,
    wallNow: () => wall,
    wait: () => {
      throw new Error("Distinct buckets must never wait");
    },
  });
  await api(path);
  await api(`${path}/123456789012345680`, { method: "PATCH" }, fence);
  await api(path); // Exhaust only the learned read bucket.
  assert(
    (await api(`${path}/123456789012345681`, { method: "PATCH" }, fence)).ok,
  );
  assert(
    (await api(path.replace("123456789012345678", "223456789012345678"))).ok,
  );
  assert(calls === 5);
  assert(await failure(() => api(path)) instanceof EventSyncPause);
  assert(
    calls === 5,
    "Changing another route's alias must not erase the old cooldown",
  );
});

Deno.test("full reset waits require a complete request slot and never shorten a known cooldown", async () => {
  for (const [delay, waitFits] of [[65, true], [65.001, false]] as const) {
    let now = 0;
    let calls = 0;
    let waits = 0;
    const api = createEventSyncDiscordApi(base, {
      fetch: (() => {
        calls += 1;
        return Promise.resolve(json(
          {},
          200,
          calls === 1
            ? {
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset-After": String(delay),
              "X-RateLimit-Bucket": "write",
            }
            : {},
        ));
      }) as typeof fetch,
      monotonicNow: () => now,
      wallNow: () => wall + now,
      wait: (milliseconds) => {
        waits += 1;
        assert(milliseconds === 65_000);
        now += milliseconds;
        return Promise.resolve();
      },
    });
    assert((await api(path, { method: "POST" }, fence)).ok);
    if (waitFits) {
      assert((await api(path, { method: "POST" }, fence)).ok);
      assert(calls === 2 && waits === 1 && now === 65_000);
    } else {
      const paused = await failure(() => api(path, { method: "POST" }, fence));
      assert(
        paused instanceof EventSyncPause && paused.reason === "rate_limit",
      );
      assert(
        paused.notBeforeIso ===
          new Date(wall + Math.ceil(delay * 1000)).toISOString(),
      );
      assert(calls === 1 && waits === 0);
    }
  }
});

Deno.test("early failed aborted or over-deadline waits never reach a mutation fence or wire", async () => {
  for (
    const behavior of [
      "early",
      "throw",
      "abort",
      "deadline",
      "headroom",
    ] as const
  ) {
    let now = 0;
    let calls = 0;
    let fences = 0;
    const controller = new AbortController();
    const api = createEventSyncDiscordApi(base, {
      fetch: (() => {
        calls += 1;
        return Promise.resolve(json({}, 200, {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset-After": "8",
        }));
      }) as typeof fetch,
      monotonicNow: () => now,
      wallNow: () => wall + now,
      wait: (milliseconds, signal) => {
        assert(signal === controller.signal);
        if (behavior === "throw") {
          throw new EventSyncPause("deadline", new Date(wall).toISOString());
        }
        now += behavior === "early"
          ? milliseconds - 1
          : behavior === "deadline"
          ? 75_000
          : behavior === "headroom"
          ? 65_001
          : milliseconds;
        if (behavior === "abort") controller.abort();
        return Promise.resolve();
      },
    });
    await api(path, { method: "POST" }, fence);
    const error = await failure(() =>
      api(path, { method: "POST", signal: controller.signal }, async () => {
        fences += 1;
      })
    );
    assert(calls === 1 && fences === 0);
    assert(
      behavior === "deadline" || behavior === "headroom"
        ? error instanceof EventSyncPause && error.reason === "deadline"
        : !(error instanceof EventSyncPause),
    );
  }
});

Deno.test("admission concurrency guard covers both reset waits and mutation fences", async () => {
  for (const stage of ["wait", "fence"] as const) {
    let now = 0;
    let release!: () => void;
    let entered!: () => void;
    const atStage = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const api = createEventSyncDiscordApi(base, {
      fetch: (() => {
        calls += 1;
        return Promise.resolve(json(
          {},
          200,
          stage === "wait" && calls === 1
            ? {
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset-After": "8",
            }
            : {},
        ));
      }) as typeof fetch,
      monotonicNow: () => now,
      wait: async (milliseconds) => {
        entered();
        await gate;
        now += milliseconds;
      },
    });
    if (stage === "wait") await api(path, { method: "POST" }, fence);
    const pending = api(path, { method: "POST" }, async () => {
      if (stage === "fence") {
        entered();
        await gate;
      }
    });
    await atStage;
    assert(!(await failure(() => api(path)) instanceof EventSyncPause));
    assert(calls === (stage === "wait" ? 1 : 0));
    release();
    assert((await pending).ok);
    assert(Number(calls) === (stage === "wait" ? 2 : 1));
  }
});

Deno.test("a waited request rechecks its complete request slot after the mutation fence", async () => {
  let now = 0;
  let calls = 0;
  let fences = 0;
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(json({}, 200, {
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset-After": "8",
      }));
    }) as typeof fetch,
    monotonicNow: () => now,
    wallNow: () => wall + now,
    wait: (milliseconds) => {
      now += milliseconds;
      return Promise.resolve();
    },
  });
  await api(path, { method: "POST" }, fence);
  const paused = await failure(() =>
    api(path, { method: "POST" }, async () => {
      fences += 1;
      assert(now === 8000, "Fence must occur after the complete reset");
      now = 65_001;
    })
  );
  assert(paused instanceof EventSyncPause && paused.reason === "deadline");
  assert(paused.notBeforeIso === new Date(wall + 65_001).toISOString());
  assert(
    calls === 1 && fences === 1,
    "Insufficient post-fence slot must never reach wire",
  );
});

Deno.test("default cooldown wait honors caller abort without leaving a timer or sending another request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(json({}, 200, {
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset-After": "8",
      }));
    }) as typeof fetch,
    monotonicNow: () => 0,
  });
  await api(path, { method: "POST" }, fence);
  const pending = api(
    path,
    { method: "POST", signal: controller.signal },
    fence,
  );
  queueMicrotask(() => controller.abort());
  assert(!(await failure(() => pending) instanceof EventSyncPause));
  assert(calls === 1);
});

Deno.test("explicit 429 terminates the factory without waiting or issuing another request", async () => {
  for (const global of [false, true]) {
    let now = 0;
    let calls = 0;
    const api = createEventSyncDiscordApi(base, {
      fetch: (() => {
        calls += 1;
        return Promise.resolve(json(
          { retry_after: 8, global },
          429,
          global
            ? {
              "X-RateLimit-Global": "true",
              "X-RateLimit-Scope": "global",
            }
            : { "X-RateLimit-Bucket": "write", "X-RateLimit-Scope": "shared" },
        ));
      }) as typeof fetch,
      monotonicNow: () => now,
      wallNow: () => wall + now,
      wait: () => {
        throw new Error("429 must never wait or retry");
      },
    });
    const first = await failure(() => api(path, { method: "POST" }, fence));
    now = 8001;
    const second = await failure(() => api(path));
    assert(first instanceof EventSyncPause && second === first && calls === 1);
    assert(first.notBeforeIso === new Date(wall + 8000).toISOString());
  }
});

Deno.test("bucket telemetry saturation and rotating aliases preserve acknowledged success", async () => {
  let calls = 0;
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(json({ id: String(calls) }, 200, {
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset-After": "100",
        "X-RateLimit-Bucket": "same-opaque-id",
      }));
    }) as typeof fetch,
    monotonicNow: () => 0,
    wallNow: () => wall,
  });
  let lastPath = "";
  for (let index = 0; index < 65; index += 1) {
    lastPath = `/guilds/${
      123456789012345678n + BigInt(index)
    }/scheduled-events`;
    const ack = await api(lastPath, { method: "POST" }, fence);
    assert(ack.ok && (ack.data as { id: string }).id === String(index + 1));
  }
  const paused = await failure(() => api(lastPath, { method: "POST" }, fence));
  assert(paused instanceof EventSyncPause && paused.reason === "rate_limit");
  assert(
    calls === 65,
    "Overflow must retain own-route cooldown without losing the ACK",
  );

  let rotations = 0;
  const rotating = createEventSyncDiscordApi(base, {
    fetch: (() => {
      rotations += 1;
      return Promise.resolve(json({}, 200, {
        "X-RateLimit-Bucket": `opaque-${rotations}`,
        "X-RateLimit-Remaining": "1",
      }));
    }) as typeof fetch,
    monotonicNow: () => 0,
  });
  for (let index = 0; index < 300; index += 1) {
    assert((await rotating(path)).ok);
  }
  assert(
    rotations === 300,
    "Optional alias churn cannot discard any confirmed ACK",
  );
});

Deno.test("new route capacity fails before wire while known routes remain usable", async () => {
  let calls = 0;
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(json({}));
    }) as typeof fetch,
    monotonicNow: () => 0,
  });
  for (let index = 0; index < 128; index += 1) {
    assert(
      (await api(
        `/guilds/${123456789012345678n + BigInt(index)}/scheduled-events`,
      )).ok,
    );
  }
  assert(
    !(await failure(() =>
      api(`/guilds/223456789012345678/scheduled-events`)
    ) instanceof EventSyncPause),
  );
  assert(calls === 128);
  assert((await api(path)).ok && Number(calls) === 129);
});

Deno.test("overflow cooldowns remain shared by known and later-learned bucket aliases", async () => {
  let now = 0;
  let calls = 0;
  let currentBucket = "capacity-bucket";
  let remaining = "0";
  let reset = "50";
  const api = createEventSyncDiscordApi(base, {
    fetch: (() => {
      calls += 1;
      return Promise.resolve(json({}, 200, {
        "X-RateLimit-Bucket": currentBucket,
        "X-RateLimit-Remaining": remaining,
        "X-RateLimit-Reset-After": reset,
      }));
    }) as typeof fetch,
    monotonicNow: () => now,
    wallNow: () => wall + now,
    wait: () => {
      throw new Error("These complete cooldowns cannot fit the budget");
    },
  });
  for (let index = 0; index < 64; index += 1) {
    assert(
      (await api(
        `/guilds/${223456789012345678n + BigInt(index)}/scheduled-events`,
      )).ok,
    );
  }
  currentBucket = "overflow-C";
  remaining = "1";
  await api(path);
  const eventPath = `${path}/123456789012345680`;
  await api(eventPath, { method: "PATCH" }, fence);
  remaining = "0";
  reset = "100";
  assert((await api(path)).ok, "The overflow acknowledgement must be returned");
  const expectedRetry = new Date(wall + 100_000).toISOString();
  const before = calls;
  const patchPause = await failure(() =>
    api(eventPath, { method: "PATCH" }, fence)
  );
  assert(
    patchPause instanceof EventSyncPause &&
      patchPause.notBeforeIso === expectedRetry,
  );
  assert(
    calls === before,
    "A known shared alias cannot bypass table saturation",
  );

  remaining = "1";
  assert((await api(path, { method: "HEAD" })).ok);
  const headPause = await failure(() => api(path, { method: "HEAD" }));
  assert(
    headPause instanceof EventSyncPause &&
      headPause.notBeforeIso === expectedRetry,
    "A later-learned alias must inherit the full known overflow cooldown",
  );
  currentBucket = "independent-D";
  assert((await api(path, { method: "POST" }, fence)).ok);
  assert(
    (await api(path, { method: "POST" }, fence)).ok,
    "Overflow must not contaminate an independently learned bucket",
  );

  // A newly available table slot can receive a shorter C cooldown from a new
  // alias; it must not hide the existing longer overflow cooldown.
  now = 50_000;
  currentBucket = "overflow-C";
  remaining = "0";
  reset = "1";
  assert((await api(eventPath, { method: "DELETE" }, fence)).ok);
  const beforeRecheck = calls;
  const retained = await failure(() =>
    api(eventPath, { method: "PATCH" }, fence)
  );
  assert(
    retained instanceof EventSyncPause &&
      retained.notBeforeIso === expectedRetry,
  );
  assert(
    calls === beforeRecheck,
    "Mapped and overflow cooldowns must retain the maximum",
  );
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
  const paused = await failure(() => api(path, { method: "POST" }, fence));
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
