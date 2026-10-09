import { asArray, asRecord, safeString, snowflake, type JsonRecord } from "./discord-interaction-helpers.ts";
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
  discordApi(path: string, init?: RequestInit): Promise<DiscordApiResult>;
  discordApiHeaders(contentType?: boolean): Headers;
  editOriginalInteractionResponse(applicationId: string, interactionToken: string, content: string): Promise<void>;
  serviceAdminClient(purpose: string): SupabaseAdminClient;
};

async function loadManagedEventResources(deps: ReaperEventSyncDependencies): Promise<JsonRecord[]> {
  const adminClient = deps.serviceAdminClient("event registry lookup");
  const { data, error } = await adminClient
    .from("discord_resources")
    .select("id,label,discord_id,discord_parent_id,metadata,enabled")
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
    safeString(event.scheduled_start_time, 60) === desired.startIso &&
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
      {
        kind: "scheduled_event",
        label: desired.title,
        discord_id: eventId,
        discord_parent_id: deps.expectedGuildId,
        enabled: true,
        url: `https://discord.com/events/${deps.expectedGuildId}/${eventId}`,
        description: desired.description,
        metadata: {
          managedBy: "reaper-event-sync",
          siteEventKey: desired.key,
          location: desired.location,
          websiteLocation: desired.websiteLocation,
          coverImageUrl: desired.coverImageUrl,
          canonicalEventId: desired.canonicalEventId,
          recurrenceRule: desired.recurrenceRule,
          source: "data/guild-schedule.json",
          startIso: desired.startIso,
          endIso: desired.endIso,
          entityType: "EXTERNAL",
        },
      },
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
): Promise<void> {
  const adminClient = deps.serviceAdminClient("duplicate event registry updates");
  await beforeWrite();
  const { error } = await adminClient
    .from("discord_resources")
    .update({
      enabled: false,
      description: `Retired duplicate scheduled event for ${desired.title}.`,
      metadata: {
        managedBy: "reaper-event-sync",
        siteEventKey: desired.key,
        duplicateOf: desired.canonicalEventId,
        retiredBy: "reaper-event-sync",
        retiredReason: "duplicate-monthly-raffle",
        retiredAt: new Date().toISOString(),
      },
    })
    .eq("kind", "scheduled_event")
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
): Promise<void> {
  for (const duplicateId of desired.duplicateEventIds) {
    if (!duplicateId || duplicateId === desired.canonicalEventId) continue;
    const existingDuplicate = existingEvents.find((event) => safeString(event.id, 24) === duplicateId);
    if (!existingDuplicate) {
      lines.push(managedEventLine("Duplicate already absent", desired, `event ${duplicateId}`));
      continue;
    }

    lines.push(managedEventLine(apply ? "Removed duplicate" : "Would remove duplicate", desired, `event ${duplicateId}`));
    if (!apply) continue;

    await beforeWrite();
    const response = await deps.discordApi(`/guilds/${deps.expectedGuildId}/scheduled-events/${duplicateId}`, {
      method: "DELETE",
      headers: deps.discordApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Duplicate removal could not be confirmed (Discord API ${response.status}).`);
    }
    await disableDuplicateEventResource(deps, duplicateId, desired, beforeWrite);
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
  const ownerId = crypto.randomUUID();
  let reserved = false;
  let reservationAttempted = false;
  let writing = false;
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
    if (!reserved || await transition("reaper_begin_event_sync_write") !== true) {
      throw new Error("Event sync reservation ownership was lost.");
    }
    // Set before sending: a failed/aborted HTTP request does not prove that
    // Discord rejected it. Never replay or automatically release that writer.
    writing = true;
  };

  try {
    if (!["apply", "preview"].includes(mode) || !/^\d{17,20}$/.test(deps.interactionId) || !/^\d{17,20}$/.test(deps.expectedGuildId)) {
      throw new Error("Event sync interaction identity is invalid.");
    }
    if (!Deno.env.get("DISCORD_BOT_TOKEN")) {
      await deps.editOriginalInteractionResponse(applicationId, interactionToken, "Reaper event sync is missing the Discord bot token.");
      return;
    }

    if (apply) {
      reservationAttempted = true;
      const result = await transition("reaper_reserve_event_sync");
      if (result !== "acquired") {
        reservationAttempted = false;
        await deps.editOriginalInteractionResponse(applicationId, interactionToken, result === "duplicate"
          ? "This event sync interaction was already handled. Use a new preview; it will not be replayed."
          : "Event sync apply is blocked by an active or unresolved guild reservation. Reconcile the prior run before retrying.");
        return;
      }
      reserved = true;
    }

    const schedule = await fetchGuildSchedule(Deno.env.get("GUILD_SCHEDULE_URL") || deps.guildScheduleUrl, deps.discordApiUserAgent);
    const desiredEvents = desiredEventsFromSchedule(schedule);
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
    const resolutions = desiredEvents.map((desired) => {
      const resource = resourceByKey.get(desired.key);
      return {
        desired,
        resource,
        existing: selectExistingScheduledEvent(existingEvents, desired, resource),
      };
    });
    const targetIds = new Set<string>();
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
    const coverData = new Map<string, string>();
    for (const { desired } of resolutions) {
      const body = await scheduledEventBody(desired, false);
      if (desired.coverImageUrl) {
        let image = coverData.get(desired.coverImageUrl);
        if (!image) {
          image = await eventCoverImageData(desired.coverImageUrl, deps.discordApiUserAgent);
          coverData.set(desired.coverImageUrl, image);
        }
        body.image = image;
      }
      bodies.set(desired.key, body);
    }

    for (const { desired, resource, existing } of resolutions) {
      const priorResources = resource ? [resource] : [];

      if (existing) {
        lines.push(managedEventLine(apply ? "Updated" : "Would update", desired, `event ${safeString(existing.id, 24) || "unknown"}`));
        if (apply) {
          await beforeWrite();
          const response = await deps.discordApi(`/guilds/${deps.expectedGuildId}/scheduled-events/${safeString(existing.id, 24)}`, {
            method: "PATCH",
            headers: deps.discordApiHeaders(true),
            body: JSON.stringify(bodies.get(desired.key)),
          });
          if (!response.ok) {
            throw new Error(`Event update could not be confirmed (Discord API ${response.status}).`);
          }
          await upsertDiscordEventResource(deps, asRecord(response.data), desired, priorResources, beforeWrite);
        }
        await processDuplicateScheduledEvents(deps, apply, desired, existingEvents, lines, beforeWrite);
        continue;
      }

      lines.push(managedEventLine(apply ? "Created" : "Would create", desired, "external scheduled event"));
      if (apply) {
        await beforeWrite();
        const response = await deps.discordApi(`/guilds/${deps.expectedGuildId}/scheduled-events`, {
          method: "POST",
          headers: deps.discordApiHeaders(true),
          body: JSON.stringify(bodies.get(desired.key)),
        });
        if (!response.ok) {
          throw new Error(`Event creation could not be confirmed (Discord API ${response.status}).`);
        }
        await upsertDiscordEventResource(deps, asRecord(response.data), desired, priorResources, beforeWrite);
      }
      await processDuplicateScheduledEvents(deps, apply, desired, existingEvents, lines, beforeWrite);
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
    let recoveryRequired = reserved && writing;
    if (reservationAttempted) {
      try {
        if (await transition("reaper_finish_event_sync", { p_outcome: writing ? "blocked" : "rejected" }) !== true) recoveryRequired = true;
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
