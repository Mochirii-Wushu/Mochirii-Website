import {
  eventCoverImageData,
  fetchGuildSchedule,
  validateGuildSchedule,
} from "./reaper-discord-events.ts";
import schedule from "../../../apps/web/public/data/guild-schedule.json" with {
  type: "json",
};

const scheduleUrl = "https://mochirii.com/data/guild-schedule.json";
const coverUrl = (key: string) =>
  `https://mochirii.com/assets/img/discord-events/${key}.png`;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(task: () => unknown | Promise<unknown>) {
  try {
    await task();
  } catch {
    return;
  }
  throw new Error("Expected rejection");
}
async function withFetch(fetcher: typeof fetch, test: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    await test();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("canonical schedule schema rejects malformed clocks, timezone, recurrence, identities and days", async () => {
  assert(validateGuildSchedule(schedule) === schedule);
  const changes: Array<(value: typeof schedule) => void> = [
    (value) => {
      value.timezone.offsetMinutes = 0;
    },
    (value) => {
      value.timezone.ianaZone = "UTC";
    },
    (value) => {
      value.timezone.displayLabel = "UTC";
    },
    (value) => {
      value.weekly[0].startTime = "24:00";
    },
    (value) => {
      value.weekly[0].days = [7];
    },
    (value) => {
      value.weekly[0].days = [1, 1];
    },
    (value) => {
      Object.assign(value.weekly[0], { discordEventId: "723456789012345678" });
    },
    (value) => {
      Object.assign(value.weekly[0], {
        discordDuplicateEventIds: ["723456789012345678"],
      });
    },
    (value) => {
      value.weekly[1].id = value.weekly[0].id;
    },
    (value) => {
      value.monthly.gathering.startDayOffset = 2;
    },
    (value) => {
      value.monthly.gathering.discordRecurrenceRule.by_n_weekday[0].day = 7;
    },
    (value) => {
      value.monthly.gathering.discordRecurrenceRule.by_n_weekday[0].day = 0;
    },
    (value) => {
      value.monthly.gathering.startTime = "08:00";
    },
    (value) => {
      value.monthly.raffle.discordEventId = "invalid";
    },
    (value) => {
      value.monthly.raffle.discordDuplicateEventIds = [
        value.monthly.raffle.discordEventId,
      ];
    },
    (value) => {
      value.weekly[0].discordCoverImage = "https://evil.example/cover.png";
    },
  ];
  for (const change of changes) {
    const invalid = structuredClone(schedule);
    change(invalid);
    await rejects(() => validateGuildSchedule(invalid));
  }
  for (
    const invalid of [null, [], {}, { ...schedule, weekly: "bad" }, {
      ...schedule,
      monthly: {},
    }, {
      ...schedule,
      monthly: { ...schedule.monthly, unvalidated: schedule.monthly.gathering },
    }, {
      ...schedule,
      weekly: [{
        ...schedule.weekly[0],
        discordRecurrenceRule: { frequency: 1 },
      }],
    }]
  ) {
    await rejects(() => validateGuildSchedule(invalid));
  }
});

Deno.test("schedule and cover origin validation rejects SSRF targets before fetch", async () => {
  let calls = 0;
  await withFetch(
    (() => {
      calls++;
      throw new Error("Should not fetch");
    }) as typeof fetch,
    async () => {
      for (
        const url of [
          "http://mochirii.com/data/guild-schedule.json",
          "https://mochirii.com.evil.example/data/guild-schedule.json",
          "https://127.0.0.1/data/guild-schedule.json",
          "https://user:pass@mochirii.com/data/guild-schedule.json",
          "https://mochirii.com/api/internal",
          `${scheduleUrl}#fragment`,
          `${scheduleUrl}?token=invalid`,
          `${scheduleUrl}?v=one&v=two`,
        ]
      ) {
        await rejects(() => fetchGuildSchedule(url, "test"));
      }
      for (
        const url of [
          "https://evil.example/image.png",
          "https://mochirii.com/assets/img/discord-events/../../secret.png",
          "https://mochirii.com/assets/unrelated.png",
          "https://mochirii.com/assets/img/discord-events/%2fsecret.png",
        ]
      ) {
        await rejects(() => eventCoverImageData(url));
      }
      assert(calls === 0);
    },
  );
});

Deno.test("schedule fetch enforces manual redirect rejection, JSON content type and schema", async () => {
  await withFetch(
    ((_url: unknown, init?: RequestInit) => {
      assert(init?.redirect === "error");
      assert(init.signal instanceof AbortSignal);
      assert(new Headers(init.headers).get("Accept") === "application/json");
      return Promise.resolve(Response.json(schedule));
    }) as typeof fetch,
    async () => {
      assert(
        (await fetchGuildSchedule(scheduleUrl, "test")).timezone !== undefined,
      );
    },
  );
  for (
    const response of [
      new Response("{}", { headers: { "Content-Type": "text/html" } }),
      new Response("{}", { status: 302 }),
      Response.json({}),
      new Response("{", { headers: { "Content-Type": "application/json" } }),
    ]
  ) {
    await withFetch(
      (() => Promise.resolve(response)) as typeof fetch,
      () => rejects(() => fetchGuildSchedule(scheduleUrl, "test")),
    );
  }
});

Deno.test("declared and streamed byte bounds reject oversized schedules and covers and cancel streams", async () => {
  for (
    const [url, size, contentType, run] of [
      [
        scheduleUrl,
        128 * 1024,
        "application/json",
        () => fetchGuildSchedule(scheduleUrl, "test"),
      ],
      [
        coverUrl("oversize"),
        4 * 1024 * 1024,
        "image/png",
        () => eventCoverImageData(coverUrl("oversize")),
      ],
    ] as const
  ) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(size + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await withFetch(
      (() =>
        Promise.resolve(
          new Response(stream, { headers: { "Content-Type": contentType } }),
        )) as typeof fetch,
      () => rejects(run),
    );
    assert(cancelled, `${url} stream must be cancelled`);
    await withFetch(
      (() =>
        Promise.resolve(
          new Response("x", {
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(size + 1),
            },
          }),
        )) as typeof fetch,
      () => rejects(run),
    );
  }
});

Deno.test("cover validation rejects mislabeled data and redirect responses", async () => {
  let counter = 0;
  for (
    const response of [
      new Response("<html>", { headers: { "Content-Type": "image/png" } }),
      new Response(png, {
        status: 307,
        headers: { "Content-Type": "image/png" },
      }),
      new Response(png, { headers: { "Content-Type": "text/html" } }),
      new Response(null, { headers: { "Content-Type": "image/png" } }),
    ]
  ) {
    await withFetch(
      (() => Promise.resolve(response)) as typeof fetch,
      () =>
        rejects(() => eventCoverImageData(coverUrl(`invalid-${counter++}`))),
    );
  }
});

Deno.test("cover cache expires and evicts beyond eight URLs instead of growing indefinitely", async () => {
  const originalNow = Date.now;
  let now = originalNow();
  let calls = 0;
  Date.now = () => now;
  try {
    await withFetch(
      (() => {
        calls++;
        return Promise.resolve(
          new Response(png, { headers: { "Content-Type": "image/png" } }),
        );
      }) as typeof fetch,
      async () => {
        const first = coverUrl("cache-0");
        await eventCoverImageData(first);
        await eventCoverImageData(first);
        assert(calls === 1);
        now += 5 * 60 * 1000;
        await eventCoverImageData(first);
        assert(Number(calls) === 2);
        for (let index = 1; index <= 8; index++) {
          await eventCoverImageData(coverUrl(`cache-${index}`));
        }
        await eventCoverImageData(first);
        assert(Number(calls) === 11);
      },
    );
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("cover cache byte budget evicts large images even below the entry limit", async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024);
  bytes.set(png);
  let calls = 0;
  await withFetch(
    (() => {
      calls++;
      return Promise.resolve(
        new Response(bytes, { headers: { "Content-Type": "image/png" } }),
      );
    }) as typeof fetch,
    async () => {
      for (let index = 0; index < 5; index++) {
        await eventCoverImageData(
          coverUrl(`large-cache-${index}`),
        );
      }
      const before = calls;
      await eventCoverImageData(coverUrl("large-cache-0"));
      assert(
        calls === before + 1,
        "Oldest large image must be evicted by the byte budget",
      );
    },
  );
});

Deno.test("schedule rejects unbounded event fanout and cover diversity", async () => {
  const covers = structuredClone(schedule);
  covers.weekly.push({
    ...covers.weekly[0],
    id: "extra-cover",
    discordCoverImage: "./assets/img/discord-events/ninth-cover.png",
  });
  await rejects(() => validateGuildSchedule(covers));
  const fanout = structuredClone(schedule);
  for (let index = 0; index < 8; index++) {
    fanout.weekly.push({ ...fanout.weekly[0], id: `extra-${index}` });
  }
  await rejects(() => validateGuildSchedule(fanout));
});

Deno.test("website fetch deadline aborts a stalled response", async () => {
  await withFetch(
    ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Timed out", "AbortError")), { once: true });
      })) as typeof fetch,
    () => rejects(() => fetchGuildSchedule(scheduleUrl, "test")),
  );
});
