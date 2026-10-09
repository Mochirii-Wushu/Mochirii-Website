-- Reservations intentionally have no lease or automatic takeover. Discord does
-- not honor database fencing tokens: an uncertain writer must be reconciled
-- after its worker has terminated before an operator releases its reservation.
create table private.reaper_event_sync_runs (
  guild_id text not null check (guild_id ~ '^[0-9]{17,20}$'),
  interaction_id text not null check (interaction_id ~ '^[0-9]{17,20}$'),
  owner_id uuid not null,
  state text not null default 'reserved' check (state in ('reserved', 'writing', 'completed', 'rejected', 'blocked')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (guild_id, interaction_id),
  check ((state in ('completed', 'rejected')) = (finished_at is not null))
);

create unique index reaper_event_sync_one_active_guild_idx
  on private.reaper_event_sync_runs (guild_id)
  where state in ('reserved', 'writing', 'blocked');

alter table private.reaper_event_sync_runs enable row level security;
revoke all on private.reaper_event_sync_runs from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant select, insert, update on private.reaper_event_sync_runs to service_role;

create function public.reaper_reserve_event_sync(p_guild_id text, p_interaction_id text, p_owner_id uuid)
returns text
language plpgsql security invoker set search_path = ''
as $function$
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
  insert into private.reaper_event_sync_runs (guild_id, interaction_id, owner_id)
    values (p_guild_id, p_interaction_id, p_owner_id);
  return 'acquired';
end;
$function$;

create function public.reaper_begin_event_sync_write(p_guild_id text, p_interaction_id text, p_owner_id uuid)
returns boolean
language plpgsql security invoker set search_path = ''
as $function$
begin
  update private.reaper_event_sync_runs set state = 'writing'
    where guild_id = p_guild_id and interaction_id = p_interaction_id and owner_id = p_owner_id
      and state in ('reserved', 'writing');
  return found;
end;
$function$;

create function public.reaper_finish_event_sync(p_guild_id text, p_interaction_id text, p_owner_id uuid, p_outcome text)
returns boolean
language plpgsql security invoker set search_path = ''
as $function$
begin
  if p_outcome is null or p_outcome not in ('completed', 'rejected', 'blocked') then
    raise exception using errcode = '22023', message = 'Invalid event sync outcome.';
  end if;
  update private.reaper_event_sync_runs
    set state = p_outcome,
      finished_at = case when p_outcome in ('completed', 'rejected') then now() else null end
    where guild_id = p_guild_id and interaction_id = p_interaction_id and owner_id = p_owner_id
      and (state = 'reserved' or (state = 'writing' and p_outcome <> 'rejected'));
  return found;
end;
$function$;

revoke all on function public.reaper_reserve_event_sync(text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.reaper_begin_event_sync_write(text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.reaper_finish_event_sync(text, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reaper_reserve_event_sync(text, text, uuid) to service_role;
grant execute on function public.reaper_begin_event_sync_write(text, text, uuid) to service_role;
grant execute on function public.reaper_finish_event_sync(text, text, uuid, text) to service_role;
