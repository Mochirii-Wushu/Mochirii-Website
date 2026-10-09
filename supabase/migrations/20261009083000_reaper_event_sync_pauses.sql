-- A pause is terminal for its interaction. Only a fresh, separately approved
-- invocation may re-preflight after the durable guild cooldown has elapsed.
-- The application may pause only at an acknowledged provider/registry boundary;
-- uncertain writes remain blocked and have no automatic release or takeover.
alter table private.reaper_event_sync_runs
  add column retry_not_before timestamptz,
  drop constraint reaper_event_sync_runs_state_check,
  drop constraint reaper_event_sync_runs_check,
  add constraint reaper_event_sync_runs_state_check
    check (state in ('reserved', 'writing', 'completed', 'rejected', 'blocked', 'paused')),
  add constraint reaper_event_sync_runs_check
    check ((state in ('completed', 'rejected', 'paused')) = (finished_at is not null)),
  add constraint reaper_event_sync_runs_retry_not_before_check
    check (retry_not_before is null or (
      state = 'paused' and pg_catalog.isfinite(retry_not_before)
      and retry_not_before >= finished_at
    ));

-- The existing unique active-guild index is unchanged: paused history cannot
-- become an active writer again, but its unexpired cooldown must be checked.
create index reaper_event_sync_paused_cooldown_idx
  on private.reaper_event_sync_runs (guild_id, retry_not_before)
  where state = 'paused' and retry_not_before is not null;

create or replace function public.reaper_reserve_event_sync(p_guild_id text, p_interaction_id text, p_owner_id uuid)
returns text
language plpgsql security invoker set search_path = ''
as $function$
declare
  reservation_time timestamptz;
begin
  if p_guild_id is null or p_guild_id !~ '^[0-9]{17,20}$'
    or p_interaction_id is null or p_interaction_id !~ '^[0-9]{17,20}$'
    or p_owner_id is null then
    raise exception using errcode = '22023', message = 'Invalid event sync reservation identity.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-event-sync:' || p_guild_id, 0));
  if exists (select 1 from private.reaper_event_sync_runs where guild_id = p_guild_id and interaction_id = p_interaction_id) then
    return 'duplicate';
  end if;
  if exists (select 1 from private.reaper_event_sync_runs where guild_id = p_guild_id and state in ('reserved', 'writing', 'blocked')) then
    return 'busy';
  end if;
  -- Transaction now() can predate a wait for the advisory lock. Check the
  -- actual wall clock after acquiring it, with an end-exclusive cooldown.
  reservation_time := pg_catalog.clock_timestamp();
  if exists (
    select 1 from private.reaper_event_sync_runs
    where guild_id = p_guild_id and state = 'paused'
      and retry_not_before is not null and retry_not_before > reservation_time
  ) then
    return 'cooldown';
  end if;
  insert into private.reaper_event_sync_runs (guild_id, interaction_id, owner_id)
    values (p_guild_id, p_interaction_id, p_owner_id);
  return 'acquired';
end;
$function$;

create function public.reaper_pause_event_sync(p_guild_id text, p_interaction_id text, p_owner_id uuid, p_retry_not_before timestamptz)
returns boolean
language plpgsql security invoker set search_path = ''
as $function$
declare
  pause_time timestamptz;
begin
  if p_guild_id is null or p_guild_id !~ '^[0-9]{17,20}$'
    or p_interaction_id is null or p_interaction_id !~ '^[0-9]{17,20}$'
    or p_owner_id is null then
    raise exception using errcode = '22023', message = 'Invalid event sync reservation identity.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-event-sync:' || p_guild_id, 0));
  pause_time := pg_catalog.clock_timestamp();
  if p_retry_not_before is null or not pg_catalog.isfinite(p_retry_not_before)
    or p_retry_not_before > pause_time + interval '7 days' then
    raise exception using errcode = '22023', message = 'Invalid event sync pause deadline.';
  end if;
  update private.reaper_event_sync_runs
    set state = 'paused', finished_at = pause_time,
      retry_not_before = greatest(p_retry_not_before, pause_time)
    where guild_id = p_guild_id and interaction_id = p_interaction_id and owner_id = p_owner_id
      and state in ('reserved', 'writing');
  return found;
end;
$function$;

revoke all on function public.reaper_reserve_event_sync(text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.reaper_pause_event_sync(text, text, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reaper_reserve_event_sync(text, text, uuid) to service_role;
grant execute on function public.reaper_pause_event_sync(text, text, uuid, timestamptz) to service_role;
