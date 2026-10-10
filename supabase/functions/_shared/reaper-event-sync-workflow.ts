import { asArray, asRecord, safeString, snowflake, type JsonRecord } from "./discord-interaction-helpers.ts";
import { EventSyncPause } from "./reaper-event-sync-transport.ts";
import {
  DISCORD_EVENT_ENTITY_EXTERNAL,
  desiredEventsFromSchedule,
  eventCoverImageData,
  eventLocation,
  fetchGuildSchedule,
  managedEventLine,
  scheduledEventBody,
  type ScheduleEvent,
} from "./reaper-discord-events.ts";

type SupabaseAdminClient = {
  from(table: string): any;
  rpc(name: string, args: JsonRecord): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

type DiscordApiResult = {
  ok: boolean;
  status: number;
  data: unknown;
};

export type ReaperEventSyncDependencies = {
  interactionId: string;
  expectedGuildId: string;
  guildScheduleUrl: string;
  discordApiUserAgent: string;
  discordApi(path: string, init?: RequestInit, beforeAttempt?: () => Promise<void>): Promise<DiscordApiResult>;
  discordApiHeaders(contentType?: boolean): Headers;
  editOriginalInteractionResponse(applicationId: string, interactionToken: string, content: string): Promise<void>;
  serviceAdminClient(purpose: string): SupabaseAdminClient;
  // Hosted advancement is limited to already reconciled rolling activities.
  advanceKeys?: string[];
  reservationOwnerId?: string;
  now?: Date;
};

async function loadManagedEventResources(deps: ReaperEventSyncDependencies): Promise<JsonRecord[]> {
  const adminClient = deps.serviceAdminClient("event registry lookup");
  const { data, error } = await adminClient
    .from("discord_resources")
    .select("id,label,discord_id,discord_parent_id,metadata,enabled,url,description")
    .eq("kind", "scheduled_event")
    .eq("discord_parent_id", deps.expectedGuildId)
    .eq("enabled", true);

  if (error || !Array.isArray(data)) {
    console.error("reaper-discord-interactions scheduled event registry lookup failed", {
      code: error?.code,
      message: error?.message,
    });
    throw new Error("Scheduled event registry could not be read.");
  }

  return asArray(data).map(asRecord).filter((resource) => {
    const metadata = asRecord(resource.metadata);
    return metadata.managedBy === "reaper-event-sync";
  });
}

function instant(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function normalizedRecurrence(value: unknown): string | null {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const rule = value as JsonRecord;
  const arrays = ["by_weekday", "by_n_weekday", "by_month", "by_month_day", "by_year_day"];
  if (Object.keys(rule).some((key) => !["start", "end", "frequency", "interval", "count", ...arrays].includes(key)) ||
    instant(rule.start) === null || !Number.isInteger(rule.frequency) || !Number.isInteger(rule.interval)) return null;
  const normalized: JsonRecord = { start: instant(rule.start), end: null, frequency: rule.frequency, interval: rule.interval, count: null };
  if (rule.end !== undefined && rule.end !== null) {
    if (instant(rule.end) === null) return null;
    normalized.end = instant(rule.end);
  }
  if (rule.count !== undefined && rule.count !== null) {
    if (!Number.isInteger(rule.count)) return null;
    normalized.count = rule.count;
  }
  for (const key of arrays) {
    const items = rule[key];
    if (items === undefined || items === null) { normalized[key] = null; continue; }
    if (!Array.isArray(items)) return null;
    const values: string[] = [];
    for (const item of items) {
      if (key === "by_n_weekday") {
        if (!item || typeof item !== "object" || Array.isArray(item) ||
          Object.keys(item).length !== 2 || !Number.isInteger(item.n) || !Number.isInteger(item.day)) return null;
        values.push(JSON.stringify([item.n, item.day]));
      } else {
        if (!Number.isInteger(item)) return null;
        values.push(JSON.stringify(item));
      }
    }
    if (new Set(values).size !== values.length) return null;
    normalized[key] = values.sort();
  }
  return JSON.stringify(normalized);
}

export function scheduledEventFieldsMatch(event: JsonRecord, body: JsonRecord, guildId: string): boolean {
  const recurrence = normalizedRecurrence(body.recurrence_rule);
  return event.guild_id === guildId && event.status === 1 &&
    event.entity_type === body.entity_type && event.privacy_level === body.privacy_level &&
    event.channel_id === null && event.entity_id === null &&
    event.name === body.name && event.description === body.description &&
    instant(event.scheduled_start_time) !== null && instant(event.scheduled_start_time) === instant(body.scheduled_start_time) &&
    instant(event.scheduled_end_time) !== null && instant(event.scheduled_end_time) === instant(body.scheduled_end_time) &&
    asRecord(event.entity_metadata).location === asRecord(body.entity_metadata).location &&
    recurrence !== null && normalizedRecurrence(event.recurrence_rule) === recurrence;
}

// A native series keeps its original anchor as its next occurrences pass.
// Preserve only an equivalent supported rule, on-rule UTC clock and duration;
// a matching title or a stale registry value does not establish equivalence.
export function preserveNativeSeriesAnchor(desired: ScheduleEvent, existing: JsonRecord | null): ScheduleEvent {
  if (!desired.recurrenceRule || !existing) return desired;
  const rule = asRecord(existing.recurrence_rule);
  const anchor = instant(rule.start);
  const start = instant(existing.scheduled_start_time);
  const end = instant(existing.scheduled_end_time);
  const selected = instant(desired.startIso)!;
  const duration = instant(desired.endIso)! - selected;
  const day = 86_400_000;
  if (anchor === null || start === null || end === null || anchor > start || start > selected ||
    anchor % day !== selected % day || start % day !== selected % day || end - start !== duration ||
    normalizedRecurrence({ ...rule, start: desired.startIso }) !== normalizedRecurrence(desired.recurrenceRule)) return desired;

  const onRule = (value: number): boolean => {
    const date = new Date(value);
    const weekday = (date.getUTCDay() + 6) % 7;
    if (rule.interval !== 1) return false;
    if (rule.frequency === 3) return !Array.isArray(rule.by_weekday) || rule.by_weekday.includes(weekday);
    if (rule.frequency === 2) return Array.isArray(rule.by_weekday) && rule.by_weekday.length === 1 && rule.by_weekday[0] === weekday;
    if (rule.frequency === 1) {
      const nth = asRecord(asArray(rule.by_n_weekday)[0]);
      return asArray(rule.by_n_weekday).length === 1 && nth.day === weekday && nth.n === Math.ceil(date.getUTCDate() / 7);
    }
    return false;
  };
  if (!onRule(anchor) || !onRule(start) || !onRule(selected)) return desired;
  return { ...desired, startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString(), recurrenceRule: { ...desired.recurrenceRule, start: new Date(anchor).toISOString() } };
}

function discordImageHash(event: JsonRecord): string | null {
  return typeof event.image === "string" && /^(?:a_)?[a-f0-9]{32}$/.test(event.image) ? event.image : null;
}

async function coverSha256(image: string): Promise<string> {
  const bytes = Uint8Array.from(atob(image.slice(image.indexOf(",") + 1)), (char) => char.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function resourcePayload(deps: ReaperEventSyncDependencies, event: JsonRecord, desired: ScheduleEvent, digest: string | null): JsonRecord {
  const eventId = snowflake(event.id);
  if (!eventId) throw new Error("Discord scheduled event id is missing.");
  return {
    kind: "scheduled_event", label: desired.title, discord_id: eventId,
    discord_parent_id: deps.expectedGuildId, enabled: true,
    url: `https://discord.com/events/${deps.expectedGuildId}/${eventId}`, description: desired.description,
    metadata: {
      managedBy: "reaper-event-sync", siteEventKey: desired.key, location: desired.location,
      websiteLocation: desired.websiteLocation, coverImageUrl: desired.coverImageUrl,
      coverImageSha256: digest, discordImageHash: discordImageHash(event),
      canonicalEventId: desired.canonicalEventId, recurrenceRule: desired.recurrenceRule,
      source: "data/guild-schedule.json", startIso: desired.startIso, endIso: desired.endIso, entityType: "EXTERNAL",
    },
  };
}

function registryMatches(resource: JsonRecord | undefined, payload: JsonRecord): boolean {
  if (!resource) return false;
  for (const [key, value] of Object.entries(payload)) {
    if (key === "kind") continue; // The registry query already restricts kind.
    if (key === "metadata") {
      const actual = asRecord(resource.metadata);
      if (Object.entries(asRecord(value)).some(([name, expected]) => name === "recurrenceRule"
        ? normalizedRecurrence(actual[name]) === null || normalizedRecurrence(actual[name]) !== normalizedRecurrence(expected)
        : actual[name] !== expected)) return false;
    } else if (resource[key] !== value) return false;
  }
  return true;
}

export function indexManagedEventResources(resources: JsonRecord[]): Map<string, JsonRecord> {
  const indexed = new Map<string, JsonRecord>();
  for (const resource of resources) {
    const key = safeString(asRecord(resource.metadata).siteEventKey, 100);
    if (!key) continue;
    if (indexed.has(key)) {
      throw new Error(`Multiple enabled managed event resources exist for ${key}.`);
    }
    indexed.set(key, resource);
  }
  return indexed;
}

export function selectExistingScheduledEvent(
  existingEvents: JsonRecord[],
  desired: ScheduleEvent,
  resource: JsonRecord | undefined,
): JsonRecord | null {
  const resourceMetadata = asRecord(resource?.metadata);
  const resourceEventId = resource?.enabled === true && resourceMetadata.managedBy === "reaper-event-sync" && resourceMetadata.siteEventKey === desired.key
    ? snowflake(resource.discord_id)
    : null;
  const explicitIds = [...new Set(
    [desired.canonicalEventId, resourceEventId].filter((value): value is string => Boolean(value)),
  )];
  const explicitMatches = existingEvents.filter((event) => explicitIds.includes(safeString(event.id, 24) || ""));
  const exactMatches = existingEvents.filter((event) =>
    safeString(event.name, 100) === desired.title &&
    instant(event.scheduled_start_time) === instant(desired.startIso) &&
    Number(event.entity_type) === DISCORD_EVENT_ENTITY_EXTERNAL &&
    eventLocation(event) === desired.location
  );

  const explicitMatchIds = new Set(explicitMatches.map((event) => safeString(event.id, 24)).filter(Boolean));
  const exactMatchIds = new Set(exactMatches.map((event) => safeString(event.id, 24)).filter(Boolean));
  if (explicitMatchIds.size > 1 || exactMatchIds.size > 1) {
    throw new Error(`Discord scheduled event identity is ambiguous for ${desired.key}.`);
  }

  const explicit = explicitMatches[0] || null;
  const exact = exactMatches[0] || null;
  if (explicit && exact && safeString(explicit.id, 24) !== safeString(exact.id, 24)) {
    throw new Error(`Discord scheduled event identity conflicts for ${desired.key}.`);
  }

  if (exact && !explicit) {
    throw new Error(`Unregistered Discord event requires explicit adoption for ${desired.key}.`);
  }
  if (explicit && Number(explicit.entity_type) !== DISCORD_EVENT_ENTITY_EXTERNAL) {
    throw new Error(`Discord event type conflicts for ${desired.key}.`);
  }
  return explicit;
}

export function resolveManagedActivity(
  existingEvents: JsonRecord[],
  desired: ScheduleEvent,
  resourceByKey: Map<string, JsonRecord>,
) {
  const keys = [desired.key, ...(desired.legacyKeys || [])];
  const priorResources = keys.flatMap((key) => {
    const row = resourceByKey.get(key);
    return row ? [row] : [];
  });
  const live = priorResources.flatMap((resource) => {
    const event = existingEvents.find((event) => event.id === resource.discord_id);
    return event ? [{ resource, event }] : [];
  });
  const current = live.find(({ resource }) => asRecord(resource.metadata).siteEventKey === desired.key);
  const matching = live.filter(({ event }) => instant(event.scheduled_start_time) === instant(desired.startIso));
  // Legacy ownership comes only from the registry. Multiple legacy entries
  // require one unambiguous current/upcoming keeper in the reviewed plan.
  const keeper = current || (live.length === 1 ? live[0] : matching.length === 1 ? matching[0] : undefined);
  if (live.length && !keeper) throw new Error(`Legacy activity keeper is ambiguous for ${desired.key}.`);
  const resource = keeper?.resource || resourceByKey.get(desired.key) || priorResources[0];
  const duplicateResources = live.filter(({ event }) => event.id !== keeper?.event.id).map(({ resource }) => resource);
  const duplicateIds = new Set(duplicateResources.map((row) => row.discord_id));
  const ownedIds = new Set([...priorResources.map((row) => row.discord_id), desired.canonicalEventId, ...desired.duplicateEventIds]);
  if (existingEvents.some((event) => event.name === desired.title && !ownedIds.has(event.id))) {
    throw new Error(`Unregistered activity event requires explicit adoption for ${desired.key}.`);
  }
  const normalizedResource = resource ? { ...resource, metadata: { ...asRecord(resource.metadata), siteEventKey: desired.key } } : undefined;
  const existing = selectExistingScheduledEvent(existingEvents.filter((event) => !duplicateIds.has(event.id)), desired, normalizedResource);
  return { resource, existing, priorResources, duplicateResources };
}

export function supersededManagedEventResources(resources: JsonRecord[], currentEventId: string): JsonRecord[] {
  return resources.filter((resource) => {
    const resourceEventId = safeString(resource.discord_id, 24);
    return resourceEventId && resourceEventId !== currentEventId;
  });
}

async function retireSupersededEventResources(
  deps: ReaperEventSyncDependencies,
  resources: JsonRecord[],
  currentEventId: string,
  desired: ScheduleEvent,
  beforeWrite: () => Promise<void>,
): Promise<void> {
  const superseded = supersededManagedEventResources(resources, currentEventId);
  if (!superseded.length) return;

  const adminClient = deps.serviceAdminClient("superseded event registry updates");
  for (const resource of superseded) {
    const resourceId = safeString(resource.id, 80);
    if (!resourceId) {
      throw new Error("Superseded scheduled event registry id is missing.");
    }
    await beforeWrite();
    const { error } = await adminClient
      .from("discord_resources")
      .update({
        enabled: false,
        description: `Retired superseded scheduled event for ${desired.title}.`,
        metadata: {
          ...asRecord(resource.metadata),
          supersededBy: currentEventId,
          retiredBy: "reaper-event-sync",
          retiredReason: "superseded-managed-event",
          retiredAt: new Date().toISOString(),
        },
      })
      .eq("id", resourceId)
      .eq("kind", "scheduled_event")
      .eq("enabled", true);

    if (error) {
      console.error("reaper-discord-interactions superseded event registry update failed", {
        code: error.code,
        message: error.message,
      });
      throw new Error("Scheduled event was recorded but its superseded registry row could not be retired.");
    }
  }
}

async function upsertDiscordEventResource(
  deps: ReaperEventSyncDependencies,
  event: JsonRecord,
  desired: ScheduleEvent,
  priorResources: JsonRecord[],
  beforeWrite: () => Promise<void>,
  digest: string | null,
): Promise<void> {
  const eventId = snowflake(event.id);

  if (!eventId) {
    throw new Error("Discord scheduled event id is missing.");
  }

  const adminClient = deps.serviceAdminClient("event registry updates");
  await beforeWrite();
  const { error } = await adminClient
    .from("discord_resources")
    .upsert(
      resourcePayload(deps, event, desired, digest),
      { onConflict: "kind,discord_id" },
    );

  if (error) {
    console.error("reaper-discord-interactions scheduled event registry upsert failed", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Scheduled event was changed but could not be recorded in the website registry.");
  }

  await retireSupersededEventResources(deps, priorResources, eventId, desired, beforeWrite);
}

async function disableDuplicateEventResource(
  deps: ReaperEventSyncDependencies,
  eventId: string,
  desired: ScheduleEvent,
  beforeWrite: () => Promise<void>,
  priorResource?: JsonRecord,
  keeperId?: string,
): Promise<void> {
  const adminClient = deps.serviceAdminClient("duplicate event registry updates");
  await beforeWrite();
  const { error } = await adminClient
    .from("discord_resources")
    .update({
      enabled: false,
      description: `Retired duplicate scheduled event for ${desired.title}.`,
      metadata: {
        ...asRecord(priorResource?.metadata),
        managedBy: "reaper-event-sync",
        siteEventKey: desired.key,
        duplicateOf: keeperId || desired.canonicalEventId,
        retiredBy: "reaper-event-sync",
        retiredReason: priorResource ? "consolidated-activity-series" : "duplicate-monthly-raffle",
        retiredAt: new Date().toISOString(),
      },
    })
    .eq("kind", "scheduled_event")
    .eq("discord_parent_id", deps.expectedGuildId)
    .eq("discord_id", eventId);

  if (error) {
    console.error("reaper-discord-interactions duplicate scheduled event registry update failed", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Duplicate scheduled event was removed but could not be retired in the website registry.");
  }
}

async function processDuplicateScheduledEvents(
  deps: ReaperEventSyncDependencies,
  apply: boolean,
  desired: ScheduleEvent,
  existingEvents: JsonRecord[],
  lines: string[],
  beforeWrite: () => Promise<void>,
  mutateDiscord: (path: string, init: RequestInit) => Promise<DiscordApiResult>,
  checkpoint: () => void,
  duplicateResources: JsonRecord[] = [],
  keeperId?: string,
): Promise<void> {
  const duplicateIds = [...new Set([...desired.duplicateEventIds, ...duplicateResources.map((row) => String(row.discord_id))])];
  for (const duplicateId of duplicateIds) {
    if (!duplicateId || duplicateId === desired.canonicalEventId) continue;
    const existingDuplicate = existingEvents.find((event) => safeString(event.id, 24) === duplicateId);
    if (!existingDuplicate) {
      lines.push(managedEventLine("Duplicate already absent", desired, `event ${duplicateId}`));
      continue;
    }

    if (!apply) {
      lines.push(managedEventLine("Would remove duplicate", desired, `event ${duplicateId}`));
      continue;
    }

    const response = await mutateDiscord(`/guilds/${deps.expectedGuildId}/scheduled-events/${duplicateId}`, {
      method: "DELETE",
      headers: deps.discordApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Duplicate removal could not be confirmed (Discord API ${response.status}).`);
    }
    await disableDuplicateEventResource(deps, duplicateId, desired, beforeWrite,
      duplicateResources.find((row) => row.discord_id === duplicateId), keeperId);
    checkpoint();
    lines.push(managedEventLine("Removed duplicate", desired, `event ${duplicateId}`));
  }
}

export async function processEventSync(
  mode: string,
  interactionToken: string,
  applicationId: string,
  deps: ReaperEventSyncDependencies,
): Promise<void> {
  const apply = mode === "apply";
  const lines: string[] = [];
  const ownerId = deps.reservationOwnerId || crypto.randomUUID();
  let reserved = Boolean(deps.reservationOwnerId);
  let reservationAttempted = reserved;
  let writing = false;
  let checkpointSafe = true;
  let pauseUncertain = false;
  const reservationArgs = {
    p_guild_id: deps.expectedGuildId,
    p_interaction_id: deps.interactionId,
    p_owner_id: ownerId,
  };
  const transition = async (name: string, extra: JsonRecord = {}): Promise<unknown> => {
    const { data, error } = await deps.serviceAdminClient("event sync reservation").rpc(name, { ...reservationArgs, ...extra });
    if (error) throw new Error("Event sync reservation could not be verified.");
    return data;
  };
  const beforeWrite = async () => {
    // The fence RPC itself may commit before its response is lost. Once
    // attempted, neither that uncertainty nor an unconfirmed provider request
    // can use the pre-write rejected transition to release this writer.
    writing = true;
    if (!reserved || await transition("reaper_begin_event_sync_write") !== true) {
      throw new Error("Event sync reservation ownership was lost.");
    }
  };
  const checkpoint = () => { checkpointSafe = true; };
  const mutateDiscord = async (path: string, init: RequestInit): Promise<DiscordApiResult> => {
    if (!checkpointSafe) throw new Error("Prior event mutation is not durably recorded.");
    await beforeWrite();
    checkpointSafe = false;
    try {
      return await deps.discordApi(path, init, beforeWrite);
    } catch (error) {
      // Only this transport type certifies no outstanding/unconfirmed write:
      // an unstarted attempt or a fully read, explicit rate-limit rejection.
      if (error instanceof EventSyncPause) checkpoint();
      throw error;
    }
  };

  try {
    if ((deps.advanceKeys && !deps.reservationOwnerId) || (deps.reservationOwnerId && (!apply || !deps.advanceKeys || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(deps.reservationOwnerId)))) {
      throw new Error("Hosted event reservation identity is invalid.");
    }
    if (!["apply", "preview"].includes(mode) || !/^\d{17,20}$/.test(deps.interactionId) || !/^\d{17,20}$/.test(deps.expectedGuildId)) {
      throw new Error("Event sync interaction identity is invalid.");
    }
    if (!Deno.env.get("DISCORD_BOT_TOKEN")) {
      await deps.editOriginalInteractionResponse(applicationId, interactionToken, "Reaper event sync is missing the Discord bot token.");
      return;
    }

    if (apply && !reserved) {
      reservationAttempted = true;
      const result = await transition("reaper_reserve_event_sync");
      if (result !== "acquired") {
        reservationAttempted = false;
        await deps.editOriginalInteractionResponse(applicationId, interactionToken, result === "cooldown"
          ? "Event sync is cooling down after a paused run. Wait for its recorded retry time, then obtain a new preview and approval for a new apply interaction. Nothing was replayed."
          : result === "duplicate"
          ? "This event sync interaction was already handled. Use a new preview; it will not be replayed."
          : "Event sync apply is blocked by an active or unresolved guild reservation. Reconcile the prior run before retrying.");
        return;
      }
      reserved = true;
    }

    const schedule = await fetchGuildSchedule(Deno.env.get("GUILD_SCHEDULE_URL") || deps.guildScheduleUrl, deps.discordApiUserAgent);
    const now = deps.now || new Date();
    let desiredEvents = desiredEventsFromSchedule(schedule, now);
    if (deps.advanceKeys) {
      if (!deps.advanceKeys.length || deps.advanceKeys.length > 2 || new Set(deps.advanceKeys).size !== deps.advanceKeys.length ||
        deps.advanceKeys.some((key) => !["breaking-army", "showdown"].includes(key) || !desiredEvents.some((event) => event.key === key && event.recurrenceRule === null))) {
        throw new Error("Rolling activity advancement scope is invalid.");
      }
      desiredEvents = desiredEvents.filter((event) => deps.advanceKeys!.includes(event.key));
    }
    if (!desiredEvents.length) {
      throw new Error("Website schedule has no events.");
    }
    const desiredKeys = new Set<string>();
    const duplicateEventIds = new Set<string>();
    for (const desired of desiredEvents) {
      if (desiredKeys.has(desired.key)) {
        throw new Error(`Website scheduled event key is ambiguous for ${desired.key}.`);
      }
      desiredKeys.add(desired.key);
      for (const id of desired.duplicateEventIds) duplicateEventIds.add(id);
    }

    const [resources, eventsResponse] = await Promise.all([
      loadManagedEventResources(deps),
      deps.discordApi(`/guilds/${deps.expectedGuildId}/scheduled-events`, {
        headers: deps.discordApiHeaders(),
      }),
    ]);

    if (!eventsResponse.ok) {
      throw new Error("Discord scheduled events could not be read.");
    }

    if (!Array.isArray(eventsResponse.data)) throw new Error("Discord scheduled event response is malformed.");
    const existingEvents = eventsResponse.data.map(asRecord);
    const existingIds = existingEvents.map((event) => snowflake(event.id));
    if (existingIds.some((id) => !id) || new Set(existingIds).size !== existingIds.length) {
      throw new Error("Discord scheduled event identities are malformed.");
    }
    const resourceByKey = indexManagedEventResources(resources);
    // Completed events are history, never revived or deleted. Cancellation or
    // premature disappearance during automatic upkeep requires owner review.
    if (deps.advanceKeys) {
      for (const desired of desiredEvents) {
        const resource = resourceByKey.get(desired.key);
        const metadata = asRecord(resource?.metadata);
        if (!resource || instant(metadata.startIso) === null || instant(metadata.endIso) === null ||
          instant(metadata.endIso)! <= instant(metadata.startIso)! || instant(metadata.endIso)! > now.getTime() ||
          metadata.recurrenceRule !== null || metadata.startIso === desired.startIso) {
          throw new Error(`Rolling activity is not ready to advance for ${desired.key}.`);
        }
        let priorEvent = existingEvents.find((event) => event.id === resource.discord_id);
        if (!priorEvent) {
          const priorId = snowflake(resource.discord_id);
          if (!priorId) throw new Error(`Rolling activity identity is invalid for ${desired.key}.`);
          const readback = await deps.discordApi(`/guilds/${deps.expectedGuildId}/scheduled-events/${priorId}`, { headers: deps.discordApiHeaders() });
          if (!readback.ok || !readback.data || typeof readback.data !== "object" || Array.isArray(readback.data)) {
            throw new Error(`Rolling activity completion could not be confirmed for ${desired.key}.`);
          }
          priorEvent = asRecord(readback.data);
        }
        if (priorEvent.id !== resource.discord_id || priorEvent.status !== 3 || priorEvent.guild_id !== deps.expectedGuildId ||
          priorEvent.entity_type !== DISCORD_EVENT_ENTITY_EXTERNAL || priorEvent.recurrence_rule !== null ||
          instant(priorEvent.scheduled_start_time) !== instant(metadata.startIso) || instant(priorEvent.scheduled_end_time) !== instant(metadata.endIso)) {
          throw new Error(`Rolling activity has not completed for ${desired.key}.`);
        }
      }
    }
    const completedIds = new Set(existingEvents.filter((event) => event.status === 3 &&
      event.guild_id === deps.expectedGuildId && event.entity_type === DISCORD_EVENT_ENTITY_EXTERNAL &&
      instant(event.scheduled_end_time) !== null && instant(event.scheduled_end_time)! <= now.getTime()).map((event) => event.id));
    const currentEvents = existingEvents.filter((event) => !completedIds.has(event.id));
    const resolutions = desiredEvents.map((desired) => {
      const { resource, existing, priorResources, duplicateResources } = resolveManagedActivity(currentEvents, desired, resourceByKey);
      if (deps.advanceKeys && (duplicateResources.length || priorResources.some((row) => asRecord(row.metadata).siteEventKey !== desired.key))) {
        throw new Error(`Rolling activity needs manual reconciliation for ${desired.key}.`);
      }
      for (const duplicate of duplicateResources) duplicateEventIds.add(String(duplicate.discord_id));
      if (existing && (existing.status !== 1 || existing.guild_id !== deps.expectedGuildId || existing.entity_type !== DISCORD_EVENT_ENTITY_EXTERNAL)) {
        throw new Error(`Managed event identity or scheduled status is invalid for ${desired.key}.`);
      }
      return {
        desired: preserveNativeSeriesAnchor(desired, existing),
        resource,
        existing,
        priorResources,
        duplicateResources,
      };
    });
    const targetIds = new Set<string>();
    if (existingEvents.some((event) => duplicateEventIds.has(String(event.id)) && (event.status !== 1 || event.guild_id !== deps.expectedGuildId || event.entity_type !== DISCORD_EVENT_ENTITY_EXTERNAL))) {
      throw new Error("Duplicate event identity, type or scheduled status is invalid.");
    }
    for (const { desired, existing } of resolutions) {
      if (!existing) continue;
      const targetId = snowflake(existing.id)!;
      if (targetIds.has(targetId) || duplicateEventIds.has(targetId)) {
        throw new Error(`Discord scheduled event target conflicts for ${desired.key}.`);
      }
      targetIds.add(targetId);
    }

    // Preflight every identity and image before the first mutation. Preview
    // exercises the same readiness checks without reserving or writing.
    const bodies = new Map<string, JsonRecord>();
    const digests = new Map<string, string | null>();
    const coverData = new Map<string, { image: string; digest: string }>();
    for (const { desired } of resolutions) {
      const body = await scheduledEventBody(desired, false);
      body.recurrence_rule = desired.recurrenceRule;
      body.image = null;
      let digest: string | null = null;
      if (desired.coverImageUrl) {
        let cover = coverData.get(desired.coverImageUrl);
        if (!cover) {
          const image = await eventCoverImageData(desired.coverImageUrl, deps.discordApiUserAgent);
          cover = { image, digest: await coverSha256(image) };
          coverData.set(desired.coverImageUrl, cover);
        }
        body.image = cover.image;
        digest = cover.digest;
      }
      bodies.set(desired.key, body);
      digests.set(desired.key, digest);
    }

    for (const { desired, resource, existing, priorResources: allPriorResources, duplicateResources } of resolutions) {
      // Keep live duplicate ownership enabled until DELETE and retirement have
      // both been acknowledged. A paused/uncertain run can then be reconciled.
      const duplicateIds = new Set(duplicateResources.map((row) => row.discord_id));
      const priorResources = allPriorResources.filter((row) => !duplicateIds.has(row.discord_id));
      const body = bodies.get(desired.key)!;
      const digest = digests.get(desired.key)!;
      const metadata = asRecord(resource?.metadata);
      const receiptMatches = digest === null
        ? existing?.image === null || existing?.image === undefined
        : metadata.coverImageSha256 === digest && discordImageHash(existing || {}) !== null &&
          metadata.discordImageHash === discordImageHash(existing || {});
      if (existing && scheduledEventFieldsMatch(existing, body, deps.expectedGuildId) && receiptMatches) {
        const registryReady = registryMatches(resource, resourcePayload(deps, existing, desired, digest)) &&
          supersededManagedEventResources(priorResources, String(existing.id)).length === 0;
        if (apply && !registryReady) {
          checkpointSafe = false;
          await upsertDiscordEventResource(deps, existing, desired, priorResources, beforeWrite, digest);
          checkpoint();
        }
        lines.push(managedEventLine(registryReady ? "Unchanged" : apply ? "Registry repaired" : "Would repair registry", desired, `event ${existing.id}`));
      } else if (!apply) {
        lines.push(managedEventLine(existing ? "Would update" : "Would create", desired, existing ? `event ${existing.id}` : "external scheduled event"));
      } else {
        const target = existing ? snowflake(existing.id)! : null;
        const response = await mutateDiscord(`/guilds/${deps.expectedGuildId}/scheduled-events${target ? `/${target}` : ""}`, {
          method: target ? "PATCH" : "POST", headers: deps.discordApiHeaders(true), body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Event ${target ? "update" : "creation"} could not be confirmed (Discord API ${response.status}).`);
        const event = asRecord(response.data);
        if (!snowflake(event.id) || (target !== null && event.id !== target) ||
          (!target && (existingIds.includes(snowflake(event.id)) || duplicateEventIds.has(String(event.id)) || targetIds.has(String(event.id)))) ||
          !scheduledEventFieldsMatch(event, body, deps.expectedGuildId) ||
          (digest !== null ? !discordImageHash(event) : event.image !== null && event.image !== undefined)) {
          throw new Error("Discord successful event response could not be verified.");
        }
        targetIds.add(String(event.id));
        await upsertDiscordEventResource(deps, event, desired, priorResources, beforeWrite, digest);
        checkpoint();
        lines.push(managedEventLine(target ? "Updated" : "Created", desired, `event ${event.id}`));
      }
      const keeper = targetIds.has(String(existing?.id)) ? String(existing!.id) : undefined;
      await processDuplicateScheduledEvents(deps, apply, desired, existingEvents, lines, beforeWrite, mutateDiscord, checkpoint, duplicateResources, keeper);
      if (!apply) {
        const staleRows = supersededManagedEventResources(priorResources, String(existing?.id || ""));
        if (staleRows.length) lines.push(managedEventLine("Would retire superseded registry", desired, `${staleRows.length} owned row(s)`));
      }
    }

    if (reserved) {
      if (await transition("reaper_finish_event_sync", { p_outcome: "completed" }) !== true) {
        throw new Error("Event sync completion could not be recorded.");
      }
      reserved = false;
      reservationAttempted = false;
    }
    const intro = apply
      ? "Event sync finished. Only Reaper-managed external Discord events were created or updated."
      : "Event sync preview. No Discord scheduled events were changed.";
    await deps.editOriginalInteractionResponse(applicationId, interactionToken, `${intro}\n${lines.slice(0, 25).join("\n")}`);
  } catch (error) {
    if (error instanceof EventSyncPause && checkpointSafe) {
      try {
        if (reserved) {
          if (await transition("reaper_pause_event_sync", { p_retry_not_before: error.notBeforeIso }) !== true) throw new Error("Pause could not be recorded.");
          reserved = false;
          reservationAttempted = false;
        }
        await deps.editOriginalInteractionResponse(applicationId, interactionToken,
          `Event sync ${apply ? "apply" : "preview"} is incomplete and paused (${error.reason}). Retry not before ${new Date(Date.parse(error.notBeforeIso) + 480 * 60_000).toISOString().replace("T", " ").replace("Z", " UTC+8")}. Nothing will resume automatically; obtain a new preview and approval before a new apply interaction.\n${lines.slice(0, 25).join("\n")}`);
        return;
      } catch {
        pauseUncertain = true;
      }
    }
    let recoveryRequired = pauseUncertain || (reserved && writing);
    if (reservationAttempted) {
      try {
        if (await transition("reaper_finish_event_sync", { p_outcome: writing || pauseUncertain ? "blocked" : "rejected" }) !== true) recoveryRequired = true;
      } catch {
        recoveryRequired = true;
      }
    }
    console.error("reaper-discord-interactions event sync failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await deps.editOriginalInteractionResponse(
      applicationId,
      interactionToken,
      recoveryRequired
        ? "Event sync requires reconciliation after an uncertain write or reservation failure. Do not retry apply: reconcile Discord and the registry after the prior worker has terminated, then verify or release its reservation through the approved recovery procedure."
        : "Reaper event sync could not be completed. Check schedule, cover readiness and event ownership, then run a new preview. Unregistered matching events require explicit adoption.",
    );
  }
}
