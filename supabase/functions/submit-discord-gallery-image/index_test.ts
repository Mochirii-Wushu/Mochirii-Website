import { createClient } from "@supabase/supabase-js";
import { handleRequest } from "./index.ts";

const owner = "10000000-0000-4000-8000-000000000001";
const rowId = "10000000-0000-4000-8000-000000000002";
const guild = "1078630751077142608";
const channel = "100000000000000001";
const message = "100000000000000002";
const attachment = "100000000000000003";
const discordUser = "100000000000000004";
const roles = ["1468659807736299520", "1078630751077142615"];
const origin = "https://" + "a".repeat(20) + ".supabase.co";
const attachmentUrl = `https://cdn.discordapp.com/attachments/${channel}/${attachment}/image.webp`;
const storagePath = `${owner}/discord/${message}-${attachment}-image.webp`;
const objectUrl = `${origin}/storage/v1/object/authenticated/member-gallery/${storagePath}`;
const bytes = Uint8Array.from(atob("UklGRl4AAABXRUJQVlA4WAoAAAAQAAAACwAABwAAQUxQSAoAAAABB1DAiAhERP8DVlA4IC4AAADQAQCdASoMAAgAAUAmJaACdLoB+AADsAD+4Ll/9zgewcewcfx1//JTX+NuOwAA"), (value) => value.charCodeAt(0));
const config = { supabaseUrl: origin, serviceRoleKey: "synthetic-service-key", ingestSecret: "synthetic-ingest-key",
  guildId: guild, channelId: channel, requiredRoleIds: roles };
const sentinel = "PRIVATE_DISCORD_RECOVERY_SENTINEL";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
function same(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), "unexpected result"); }
function response(body: BodyInit, url: string, status = 200, headers: HeadersInit = {}) {
  const result = new Response(body, { status, headers });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
function request() {
  return new Request("https://ingest.example", { method: "POST", headers: {
    "content-type": "application/json", "x-mochirii-reaper-secret": config.ingestSecret,
  }, body: JSON.stringify({ guildId: guild, channelId: channel, messageId: message, attachmentId: attachment,
    discordUserId: discordUser, attachmentUrl, mimeType: "image/webp", sizeBytes: bytes.length, originalFilename: "image.webp" }) });
}
function fixture(options: { firstInsert?: "rollback" | "lost" | "throw-rollback" | "throw-lost";
  object?: (result: Response) => Response; recoveryLookupError?: boolean; origin?: string; uploadThrows?: boolean;
  recoveryLookupThrows?: boolean;
  reservationCode?: string; reservationThrows?: boolean; reservationChange?: (value: Record<string, unknown>) => void } = {}) {
  let stored = false;
  let row: Record<string, unknown> | null = null;
  let inserts = 0;
  let uploads = 0;
  let removals = 0;
  let lookups = 0;
  let reservations = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = {
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => {
          if (table === "member_profiles") return { data: { id: owner, member_status: "active",
            has_required_discord_roles: true, discord_roles: roles, discord_verified_at: new Date().toISOString() }, error: null };
          lookups++;
          if (lookups > 1 && options.recoveryLookupThrows) throw new Error(sentinel);
          if (lookups > 1 && options.recoveryLookupError) return { data: null, error: { code: "", message: sentinel } };
          return { data: row, error: null };
        },
      };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "gallery_reserve_discord_upload") {
        reservations++;
        same(args, { p_user_id: owner, p_storage_path: storagePath, p_size_bytes: bytes.length,
          p_mime_type: "image/webp", p_discord_message_id: message, p_discord_attachment_id: attachment });
        if (options.reservationThrows) throw new Error(sentinel);
        if (options.reservationCode) return { data: { ok: false, code: options.reservationCode }, error: null };
        const value: Record<string, unknown> = { ok: true, upload_id: rowId, storage_path: storagePath,
          state: row ? "submitted" : "reserved", ...(row ? { submission_id: rowId } : {}) };
        options.reservationChange?.(value);
        return { data: value, error: null };
      }
      same(name, "gallery_complete_discord_upload"); same(args.p_upload_id, rowId);
      const metadata = args.p_metadata as Record<string, unknown>;
      same(Object.keys(metadata).sort(), ["original_filename", "title", "caption", "category", "discord_guild_id",
        "discord_channel_id", "discord_user_id", "instagram_opt_in", "instagram_opt_in_copy_version"].sort());
      inserts++;
      if (inserts === 1 && options.firstInsert === "rollback") return { data: null, error: { code: "", message: sentinel } };
      if (inserts === 1 && options.firstInsert === "throw-rollback") throw new Error(sentinel);
      row = { ...metadata, id: rowId, status: "pending", created_at: "2026-10-16T00:00:00Z" };
      if (inserts === 1 && options.firstInsert === "lost") return { data: null, error: { code: "", message: sentinel } };
      if (inserts === 1 && options.firstInsert === "throw-lost") throw new Error(sentinel);
      return { data: { ok: true, submission: row }, error: null };
    },
    storage: { from: (bucket: string) => {
      same(bucket, "member-gallery");
      return {
        upload: async (path: string, actual: Uint8Array, uploadOptions: { upsert: boolean; contentType: string }) => {
          same(path, storagePath); same(Array.from(actual), Array.from(bytes)); same(uploadOptions.upsert, false);
          uploads++;
          if (stored) {
            if (options.uploadThrows) throw new Error(sentinel);
            return { error: { message: sentinel } };
          }
          stored = true;
          return { error: null };
        },
        remove: () => { removals++; throw new Error("original deletion is forbidden"); },
      };
    } },
  };
  const dependencies = {
    config: { ...config, supabaseUrl: options.origin ?? origin },
    createClient: (() => client) as unknown as typeof createClient,
    fetchImpl: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input); calls.push({ url, init }); same(init.redirect, "manual");
      if (url === attachmentUrl) {
        assert(!new Headers(init.headers).has("authorization"));
        return response(bytes, url, 200, { "content-type": "image/webp", "content-length": String(bytes.length) });
      }
      same(url, objectUrl);
      same(new Headers(init.headers).get("authorization"), `Bearer ${config.serviceRoleKey}`);
      const result = response(bytes, url, 200, { "content-type": "image/webp", "content-length": String(bytes.length), etag: '"' + "1".repeat(32) + '"' });
      return options.object ? options.object(result) : result;
    }) as typeof fetch,
  };
  return { run: async () => {
    const diagnostics: string[] = [];
    const previous = console.error;
    console.error = (...values: unknown[]) => { diagnostics.push(JSON.stringify(values)); };
    try {
      const result = await handleRequest(request(), dependencies);
      assert(!diagnostics.join("\n").includes(sentinel));
      return result;
    } finally { console.error = previous; }
  }, calls,
    counts: () => ({ inserts, uploads, removals }), reservations: () => reservations, seedOriginal: () => { stored = true; } };
}

Deno.test("actual Discord ingest recovers exact retained original after upload success and insert rollback", async () => {
  for (const firstInsert of ["rollback", "throw-rollback"] as const) {
    const f = fixture({ firstInsert });
    const first = await f.run(); same(first.status, 500);
    const second = await f.run(); same(second.status, 200);
    const result = await second.json(); same(result.ok, true); same(result.data.submissionId, rowId);
    same(f.counts(), { inserts: 2, uploads: 2, removals: 0 });
    same(f.calls.filter((call) => call.url === objectUrl).length, 1);
  }
});

Deno.test("ambiguous committed insert reconciles the same attachment without upload or publication", async () => {
  for (const firstInsert of ["lost", "throw-lost"] as const) {
    const f = fixture({ firstInsert });
    same((await f.run()).status, 500);
    const result = await (await f.run()).json(); same(result.ok, true); same(result.duplicate, true);
    same(f.counts(), { inserts: 1, uploads: 1, removals: 0 }); same(f.calls.length, 1);
  }
});

Deno.test("an ambiguous upload exception recovers only the exact durable original", async () => {
  const f = fixture({ uploadThrows: true }); f.seedOriginal();
  same((await f.run()).status, 200);
  same(f.counts(), { inserts: 1, uploads: 1, removals: 0 });
});

Deno.test("existing original recovery rejects changed bytes, MIME, size, ETag, status and redirect/final URL drift", async () => {
  const changed = bytes.slice(); changed[changed.length - 1] ^= 1;
  for (const object of [
    (result: Response) => response(changed, result.url, 200, result.headers),
    (result: Response) => response(bytes.subarray(0, bytes.length - 1), result.url, 200, { "content-type": "image/webp", etag: "1".repeat(32) }),
    (result: Response) => response(new Uint8Array([...bytes, 0]), result.url, 200, { "content-type": "image/webp", etag: "1".repeat(32) }),
    (result: Response) => { result.headers.set("content-type", "image/png"); return result; },
    (result: Response) => { result.headers.set("content-length", "52428801"); return result; },
    (result: Response) => { result.headers.delete("etag"); return result; },
    (result: Response) => response(bytes, result.url, 302, { location: `https://outside.example/${sentinel}` }),
    (result: Response) => response(bytes, `https://outside.example/${sentinel}`, 200, result.headers),
    () => { throw new Error(sentinel); },
  ]) {
    const f = fixture({ object }); f.seedOriginal();
    const result = await f.run(); same(result.status, 503);
    assert(!(await result.text()).includes(sentinel)); same(f.counts().inserts, 0); same(f.counts().removals, 0);
  }
});

Deno.test("unknown row lookup never authorizes object adoption or credentialed download", async () => {
  for (const options of [{ recoveryLookupError: true }, { recoveryLookupThrows: true }]) {
    const f = fixture(options); f.seedOriginal();
    const result = await f.run(); same(result.status, 503);
    same(f.calls.length, 1); same(f.calls[0].url, attachmentUrl);
    same(f.counts().inserts, 0); same(f.counts().removals, 0);
  }
});

Deno.test("recovery validates configured object origin before sending the service credential", async () => {
  for (const value of ["https://outside.example", "http://" + "a".repeat(20) + ".supabase.co",
    "https://user:secret@" + "a".repeat(20) + ".supabase.co", origin + "/path", origin + "?token=" + sentinel]) {
    const f = fixture({ origin: value }); f.seedOriginal();
    same((await f.run()).status, 503); same(f.calls.length, 1);
    same(f.calls[0].url, attachmentUrl); same(f.counts().inserts, 0); same(f.counts().removals, 0);
  }
});

Deno.test("actual Discord quota admission denies before Storage upload and never leaks an untrusted code", async () => {
  for (const code of ["upload_daily_limit", "upload_pending_limit", "upload_storage_limit", "upload_project_limit",
    "upload_conflict", "upload_access_denied", sentinel]) {
    const f = fixture({ reservationCode: code });
    const result = await f.run(); same(result.status, code.includes("_limit") ? 429 : 409);
    assert(!(await result.text()).includes(sentinel)); same(f.reservations(), 1);
    same(f.counts(), { inserts: 0, uploads: 0, removals: 0 });
  }
  const failed = fixture({ reservationThrows: true }); same((await failed.run()).status, 503);
  same(failed.counts().uploads, 0); same(failed.counts().inserts, 0);
});

Deno.test("reservation identity/path/state drift fails before writing the original or completion", async () => {
  for (const reservationChange of [
    (value: Record<string, unknown>) => { value.storage_path = owner + "/other.webp"; },
    (value: Record<string, unknown>) => { value.upload_id = sentinel; },
    (value: Record<string, unknown>) => { value.state = "unknown"; },
    (value: Record<string, unknown>) => { value.state = "submitted"; value.submission_id = owner; },
  ]) {
    const f = fixture({ reservationChange }); same((await f.run()).status, 409);
    same(f.counts(), { inserts: 0, uploads: 0, removals: 0 });
  }
});
