-- One-off recovery, separately approval-gated with this release.
-- Execution 954928d3-4569-4938-874e-8c37580d6911 terminated at
-- 2026-10-09T07:54:58.279Z. The post-termination readback reconciled five
-- creations, one canonical raffle update and five superseded registry rows.
-- This does not mark the incomplete sync completed or replay its interaction.
do $recovery$
declare
  interrupted private.reaper_event_sync_runs%rowtype;
  registry_count bigint;
  enabled_count bigint;
  registry_sha256 text;
  changed_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-event-sync:1078630751077142608', 0));
  select * into interrupted from private.reaper_event_sync_runs
    where guild_id = '1078630751077142608' and interaction_id = '1558024648422068314'
    for update;
  -- Local and hosted preview databases do not contain the production run.
  if not found then return; end if;
  if interrupted.owner_id <> 'adcb5a39-002c-4a71-9283-1f5bc55aef7c'::uuid
    or interrupted.state <> 'blocked'
    or interrupted.created_at <> '2026-10-09T07:53:43.597142Z'::timestamptz
    or interrupted.finished_at is not null then
    raise exception 'Interrupted event sync recovery identity/state mismatch.';
  end if;
  if (select count(*) from private.reaper_event_sync_runs
    where guild_id = interrupted.guild_id and state in ('reserved', 'writing', 'blocked')) <> 1 then
    raise exception 'Interrupted event sync recovery has another unresolved run.';
  end if;
  -- Stable UTC JSON encoding binds all columns of every managed registry row,
  -- including disabled history; any intervening registry change fails closed.
  perform pg_catalog.set_config('TimeZone', 'UTC', true);
  select count(*), count(*) filter (where enabled),
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_agg(to_jsonb(resource) order by resource.id)::text, 'UTF8')), 'hex')
    into registry_count, enabled_count, registry_sha256
    from public.discord_resources resource
    where kind = 'scheduled_event' and discord_parent_id = interrupted.guild_id
      and metadata->>'managedBy' = 'reaper-event-sync';
  if registry_count <> 39 or enabled_count <> 17
    or registry_sha256 is distinct from '096e2a3c269f46f6881c8841729195028e37d2039a2b1218767dc81008a43122' then
    raise exception 'Interrupted event sync recovery registry drift.';
  end if;
  update private.reaper_event_sync_runs
    set state = 'rejected', finished_at = pg_catalog.clock_timestamp()
    where guild_id = interrupted.guild_id and interaction_id = interrupted.interaction_id
      and owner_id = interrupted.owner_id and state = 'blocked' and finished_at is null;
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then raise exception 'Interrupted event sync recovery did not update exactly one run.'; end if;
end;
$recovery$;
