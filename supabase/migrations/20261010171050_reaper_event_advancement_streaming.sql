-- Expand reconciliation to the three approved native Twitch series. The only
-- rolling targets remain Breaking Army and Showdown. Do not replace a live
-- guard while an owner or one-use dispatch may still depend on it.
do $migration$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-event-sync:1078630751077142608', 0));
  if not exists (select 1 from private.reaper_event_advancement_policy where guild_id = '1078630751077142608' and not enabled and revision = 1)
    or exists (select 1 from private.reaper_event_sync_runs where guild_id = '1078630751077142608'
      and (state in ('reserved', 'writing', 'blocked') or (state = 'paused' and retry_not_before > clock_timestamp())))
    or exists (select 1 from private.reaper_event_advance_dispatches where guild_id = '1078630751077142608' and state not in ('completed', 'reconciled'))
  then
    raise exception using errcode = '55000', message = 'Disable and reconcile event advancement before replacing its registry guard.';
  end if;

  execute $definition$
    create or replace function private.reaper_event_advancement_registry_ready()
    returns boolean language sql stable security invoker set search_path = ''
    as $function$
      with managed as (
        select r.discord_id, r.metadata, r.metadata->>'siteEventKey' as activity,
          private.reaper_event_advance_instant(r.metadata->>'startIso') as starts_at,
          private.reaper_event_advance_instant(r.metadata->>'endIso') as ends_at,
          private.reaper_event_advance_instant(r.metadata->'recurrenceRule'->>'start') as anchor_at,
          case r.metadata->>'siteEventKey'
            when 'twitch-mochi-monday' then 0 when 'twitch-mochi-tuesday' then 1 when 'twitch-mochi-wednesday' then 2 end as stream_day
        from public.discord_resources r
        where r.kind = 'scheduled_event' and r.discord_parent_id = '1078630751077142608' and r.enabled
          and r.metadata->>'managedBy' = 'reaper-event-sync'
      )
      select count(*) = 11 and count(distinct activity) = 11 and count(distinct discord_id) = 11
        and coalesce(bool_and(coalesce(
          activity = any(array['monthly-gathering', 'monthly-raffle', 'guild-party', 'breaking-army', 'showdown', 'guild-wars', 'guild-heros-realm', 'united-resolve',
            'twitch-mochi-monday', 'twitch-mochi-tuesday', 'twitch-mochi-wednesday'])
          and discord_id ~ '^[0-9]{17,20}$'
          and metadata->>'source' = 'data/guild-schedule.json' and metadata->>'entityType' = 'EXTERNAL'
          and starts_at is not null and ends_at > starts_at
          and case when activity in ('breaking-army', 'showdown')
            then metadata->'recurrenceRule' is not distinct from 'null'::jsonb
            else jsonb_typeof(metadata->'recurrenceRule') = 'object' end
          and case activity
            when 'guild-party' then discord_id = '1558076114486698016'
            when 'monthly-gathering' then discord_id = '1558024658497052722'
            when 'monthly-raffle' then discord_id = '1479507429598302268'
            else true end
          and case when stream_day is not null then
            metadata->>'location' = 'https://www.twitch.tv/mochiriiguild'
            and metadata->>'websiteLocation' = 'https://www.twitch.tv/mochiriiguild'
            and metadata->'coverImageUrl' is not distinct from 'null'::jsonb
            and metadata->'coverImageSha256' is not distinct from 'null'::jsonb
            and metadata->'discordImageHash' is not distinct from 'null'::jsonb
            and (starts_at at time zone 'UTC')::time = time '13:30:00'
            and extract(isodow from starts_at at time zone 'UTC') = stream_day + 1
            and ends_at = starts_at + interval '2 hours'
            and anchor_at is not null and anchor_at <= starts_at
            and mod(extract(epoch from starts_at - anchor_at), 604800) = 0
            and jsonb_strip_nulls(metadata->'recurrenceRule') = jsonb_build_object(
              'start', metadata->'recurrenceRule'->>'start', 'frequency', 2, 'interval', 1, 'by_weekday', jsonb_build_array(stream_day))
          else true end
        , false)), false)
      from managed;
    $function$;
  $definition$;
end;
$migration$;
