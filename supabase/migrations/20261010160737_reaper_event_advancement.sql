-- Hosted advancement is a separately activated policy, never a replay of a
-- Discord interaction. Its 9-prefixed 20-digit operational IDs exceed uint64
-- and cannot collide with real Discord snowflakes; manual RPCs stay unchanged.
create sequence private.reaper_event_advance_identity_seq;
revoke all on sequence private.reaper_event_advance_identity_seq from public, anon, authenticated, service_role;

create table private.reaper_event_advancement_policy (
  guild_id text primary key default '1078630751077142608' check (guild_id = '1078630751077142608'),
  revision integer not null default 1 check (revision = 1),
  activity_keys text[] not null default array['breaking-army', 'showdown']::text[]
    check (activity_keys = array['breaking-army', 'showdown']::text[]),
  enabled boolean not null default false,
  activated_at timestamptz,
  disabled_reason text check (disabled_reason is null or disabled_reason in ('manual', 'registry-drift', 'unresolved-run', 'unresolved-dispatch', 'dispatch-expired', 'dispatch-stalled', 'run-not-completed')),
  updated_at timestamptz not null default clock_timestamp(),
  check (not enabled or activated_at is not null)
);
insert into private.reaper_event_advancement_policy (guild_id) values ('1078630751077142608');

create table private.reaper_event_advance_dispatches (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references private.reaper_event_advancement_policy(guild_id),
  policy_revision integer not null check (policy_revision = 1),
  interaction_id text not null unique check (interaction_id ~ '^9[0-9]{19}$'),
  activity_keys text[] not null check (activity_keys in (array['breaking-army']::text[], array['showdown']::text[], array['breaking-army', 'showdown']::text[])),
  target_snapshot jsonb not null check (jsonb_typeof(target_snapshot) = 'object' and octet_length(target_snapshot::text) <= 2048),
  job_key bytea not null unique check (octet_length(job_key) = 32),
  capability_hash bytea not null check (octet_length(capability_hash) = 32),
  state text not null default 'pending' check (state in ('pending', 'claimed', 'completed', 'failed', 'reconciled')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  owner_id uuid,
  claimed_at timestamptz,
  finished_at timestamptz,
  request_id bigint,
  check (pg_catalog.isfinite(created_at) and pg_catalog.isfinite(expires_at) and expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
  check (claimed_at is null or (pg_catalog.isfinite(claimed_at) and claimed_at >= created_at)),
  check (finished_at is null or (pg_catalog.isfinite(finished_at) and finished_at >= coalesce(claimed_at, created_at))),
  check ((owner_id is null) = (claimed_at is null)),
  check ((state in ('completed', 'failed', 'reconciled')) = (finished_at is not null)),
  check (state <> 'pending' or owner_id is null),
  check (state not in ('claimed', 'completed') or owner_id is not null)
);
create unique index reaper_event_advance_one_pending_guild_idx
  on private.reaper_event_advance_dispatches(guild_id) where state in ('pending', 'claimed');
alter table private.reaper_event_advancement_policy enable row level security;
alter table private.reaper_event_advance_dispatches enable row level security;
revoke all on private.reaper_event_advancement_policy, private.reaper_event_advance_dispatches from public, anon, authenticated, service_role;
grant select, update on private.reaper_event_advancement_policy to service_role;
grant select, insert, update on private.reaper_event_advance_dispatches to service_role;

-- Invalid registry strings must fail closed rather than break a cron tick.
create function private.reaper_event_advance_instant(p_value text)
returns timestamptz language plpgsql stable security invoker set search_path = ''
as $function$
declare result timestamptz;
begin
  if p_value is null or length(p_value) > 32 or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' then return null; end if;
  result := p_value::timestamptz;
  if not pg_catalog.isfinite(result) then return null; end if;
  return result;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end;
$function$;

create function private.reaper_event_advancement_registry_ready()
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select count(*) = 8 and count(distinct r.metadata->>'siteEventKey') = 8 and count(distinct r.discord_id) = 8
    and coalesce(bool_and(coalesce(
      r.metadata->>'siteEventKey' = any(array['monthly-gathering', 'monthly-raffle', 'guild-party', 'breaking-army', 'showdown', 'guild-wars', 'guild-heros-realm', 'united-resolve'])
      and r.discord_id ~ '^[0-9]{17,20}$'
      and r.metadata->>'source' = 'data/guild-schedule.json' and r.metadata->>'entityType' = 'EXTERNAL'
      and private.reaper_event_advance_instant(r.metadata->>'startIso') is not null
      and private.reaper_event_advance_instant(r.metadata->>'endIso') > private.reaper_event_advance_instant(r.metadata->>'startIso')
      and case when r.metadata->>'siteEventKey' in ('breaking-army', 'showdown')
        then r.metadata->'recurrenceRule' is not distinct from 'null'::jsonb
        else jsonb_typeof(r.metadata->'recurrenceRule') = 'object' end
      and case r.metadata->>'siteEventKey'
        when 'guild-party' then r.discord_id = '1558076114486698016'
        when 'monthly-gathering' then r.discord_id = '1558024658497052722'
        when 'monthly-raffle' then r.discord_id = '1479507429598302268'
        else true end
    , false)), false)
  from public.discord_resources r
  where r.kind = 'scheduled_event' and r.discord_parent_id = '1078630751077142608' and r.enabled
    and r.metadata->>'managedBy' = 'reaper-event-sync';
$function$;

create function private.reaper_event_advance_due_targets(p_now timestamptz)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select coalesce(jsonb_object_agg(r.metadata->>'siteEventKey', jsonb_build_object(
    'resourceId', r.id, 'discordId', r.discord_id, 'startIso', r.metadata->>'startIso', 'endIso', r.metadata->>'endIso'
  )), '{}'::jsonb)
  from public.discord_resources r
  where r.kind = 'scheduled_event' and r.discord_parent_id = '1078630751077142608' and r.enabled
    and r.metadata->>'managedBy' = 'reaper-event-sync'
    and r.metadata->>'siteEventKey' in ('breaking-army', 'showdown')
    and r.metadata->'recurrenceRule' is not distinct from 'null'::jsonb
    and private.reaper_event_advance_instant(r.metadata->>'endIso') <= p_now - interval '2 minutes';
$function$;

create function public.reaper_set_event_advancement(p_enabled boolean)
returns boolean language plpgsql security invoker set search_path = ''
as $function$
declare policy private.reaper_event_advancement_policy%rowtype; observed_at timestamptz;
begin
  if p_enabled is null then raise exception using errcode = '22023', message = 'Invalid advancement activation.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-event-sync:1078630751077142608', 0));
  select * into policy from private.reaper_event_advancement_policy where guild_id = '1078630751077142608' for update;
  if not found then return false; end if;
  observed_at := clock_timestamp();
  if not p_enabled then
    update private.reaper_event_advancement_policy set enabled = false, disabled_reason = 'manual', updated_at = observed_at where guild_id = policy.guild_id;
    return true;
  end if;
  if policy.enabled then return true; end if;
  if not private.reaper_event_advancement_registry_ready()
    or exists (select 1 from private.reaper_event_advance_dispatches where guild_id = policy.guild_id and state not in ('completed', 'reconciled'))
    or exists (select 1 from private.reaper_event_sync_runs where guild_id = policy.guild_id and (state in ('reserved', 'writing', 'blocked') or (state = 'paused' and retry_not_before > observed_at)))
  then return false; end if;
  -- Prior terminal manual runs are an explicit activation checkpoint, never
  -- replay candidates. A later paused apply disables unattended advancement.
  update private.reaper_event_advancement_policy set enabled = true, activated_at = observed_at, disabled_reason = null, updated_at = observed_at where guild_id = policy.guild_id;
  return true;
end;
$function$;

create function private.reaper_dispatch_event_advance()
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare
  policy private.reaper_event_advancement_policy%rowtype;
  pending private.reaper_event_advance_dispatches%rowtype;
  observed_at timestamptz;
  targets jsonb;
  keys text[];
  capability text;
  dispatch_id uuid;
  operational_id text;
  reason text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-event-sync:1078630751077142608', 0));
  select * into policy from private.reaper_event_advancement_policy where guild_id = '1078630751077142608' for update;
  if not found or not policy.enabled then return null; end if;
  observed_at := clock_timestamp();
  if not private.reaper_event_advancement_registry_ready() then reason := 'registry-drift';
  elsif exists (select 1 from private.reaper_event_sync_runs where guild_id = policy.guild_id and (state = 'blocked' or (state = 'paused' and finished_at >= policy.activated_at))) then reason := 'unresolved-run';
  elsif exists (select 1 from private.reaper_event_advance_dispatches where guild_id = policy.guild_id and state = 'failed') then reason := 'unresolved-dispatch';
  end if;
  select * into pending from private.reaper_event_advance_dispatches where guild_id = policy.guild_id and state in ('pending', 'claimed') for update;
  if reason is null and found then
    if pending.state = 'pending' and pending.expires_at <= observed_at then reason := 'dispatch-expired';
    elsif pending.state = 'claimed' and (pending.claimed_at <= observed_at - interval '2 minutes'
      or not exists (select 1 from private.reaper_event_sync_runs where guild_id = policy.guild_id and interaction_id = pending.interaction_id and owner_id = pending.owner_id and state in ('reserved', 'writing', 'completed')))
    then reason := 'dispatch-stalled';
    else return null;
    end if;
  end if;
  if reason is not null then
    update private.reaper_event_advancement_policy set enabled = false, disabled_reason = reason, updated_at = observed_at where guild_id = policy.guild_id;
    if pending.id is not null then update private.reaper_event_advance_dispatches set state = 'failed', finished_at = observed_at where id = pending.id; end if;
    return null;
  end if;
  if exists (select 1 from private.reaper_event_sync_runs where guild_id = policy.guild_id and state in ('reserved', 'writing', 'blocked')) then return null; end if;
  targets := private.reaper_event_advance_due_targets(observed_at);
  if targets = '{}'::jsonb then return null; end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(targets) key;
  capability := encode(extensions.gen_random_bytes(32), 'hex');
  operational_id := '9' || lpad(nextval('private.reaper_event_advance_identity_seq')::text, 19, '0');
  insert into private.reaper_event_advance_dispatches (guild_id, policy_revision, interaction_id, activity_keys, target_snapshot, job_key, capability_hash, created_at, expires_at)
  values (policy.guild_id, policy.revision, operational_id, keys, targets, extensions.digest(targets::text, 'sha256'), extensions.digest(capability, 'sha256'), observed_at, observed_at + interval '2 minutes')
  on conflict (job_key) do nothing returning id into dispatch_id;
  if dispatch_id is null then
    update private.reaper_event_advancement_policy set enabled = false, disabled_reason = 'unresolved-dispatch', updated_at = observed_at where guild_id = policy.guild_id;
    return null;
  end if;
  -- Fixed origin/path prevents arbitrary network destinations. A preview DB
  -- token is not present in production's claim table; the worker additionally
  -- checks its actual runtime project URL before any claim or Discord access.
  update private.reaper_event_advance_dispatches set request_id = net.http_post(
    url := 'https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/reaper-discord-interactions/advance',
    body := jsonb_build_object('dispatchId', dispatch_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-mochirii-event-advance-capability', capability),
    timeout_milliseconds := 5000
  ) where id = dispatch_id;
  return dispatch_id;
end;
$function$;

create function public.reaper_claim_event_advance(p_dispatch_id uuid, p_capability text, p_owner_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare policy private.reaper_event_advancement_policy%rowtype; dispatch private.reaper_event_advance_dispatches%rowtype; observed_at timestamptz; result text;
begin
  if p_dispatch_id is null or p_owner_id is null or p_capability is null or p_capability !~ '^[a-f0-9]{64}$' then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-event-sync:1078630751077142608', 0));
  select * into policy from private.reaper_event_advancement_policy where guild_id = '1078630751077142608' for update;
  if not found or not policy.enabled then return null; end if;
  select * into dispatch from private.reaper_event_advance_dispatches where id = p_dispatch_id for update;
  if not found or dispatch.guild_id <> policy.guild_id or dispatch.policy_revision <> policy.revision or dispatch.state <> 'pending'
    or dispatch.capability_hash <> extensions.digest(p_capability, 'sha256') then return null; end if;
  observed_at := clock_timestamp();
  if dispatch.expires_at <= observed_at then
    update private.reaper_event_advance_dispatches set state = 'failed', finished_at = observed_at where id = dispatch.id;
    update private.reaper_event_advancement_policy set enabled = false, disabled_reason = 'dispatch-expired', updated_at = observed_at where guild_id = policy.guild_id;
    return null;
  end if;
  if not private.reaper_event_advancement_registry_ready() or dispatch.target_snapshot <> private.reaper_event_advance_due_targets(observed_at)
    or dispatch.activity_keys is distinct from array(select key from jsonb_object_keys(dispatch.target_snapshot) key order by key)
    or dispatch.job_key <> extensions.digest(dispatch.target_snapshot::text, 'sha256') then
    update private.reaper_event_advance_dispatches set state = 'failed', finished_at = observed_at where id = dispatch.id;
    update private.reaper_event_advancement_policy set enabled = false, disabled_reason = 'registry-drift', updated_at = observed_at where guild_id = policy.guild_id;
    return null;
  end if;
  if exists (select 1 from private.reaper_event_sync_runs where guild_id = policy.guild_id and (state = 'blocked' or (state = 'paused' and finished_at >= policy.activated_at))) then
    update private.reaper_event_advance_dispatches set state = 'failed', finished_at = observed_at where id = dispatch.id;
    update private.reaper_event_advancement_policy set enabled = false, disabled_reason = 'unresolved-run', updated_at = observed_at where guild_id = policy.guild_id;
    return null;
  end if;
  result := public.reaper_reserve_event_sync(dispatch.guild_id, dispatch.interaction_id, p_owner_id);
  if result <> 'acquired' then return null; end if;
  update private.reaper_event_advance_dispatches set state = 'claimed', owner_id = p_owner_id, claimed_at = observed_at where id = dispatch.id;
  return jsonb_build_object('interactionId', dispatch.interaction_id, 'guildId', dispatch.guild_id, 'activityKeys', dispatch.activity_keys);
end;
$function$;

create function public.reaper_finish_event_advance(p_dispatch_id uuid, p_owner_id uuid)
returns boolean language plpgsql security invoker set search_path = ''
as $function$
declare dispatch private.reaper_event_advance_dispatches%rowtype; observed_at timestamptz;
begin
  if p_dispatch_id is null or p_owner_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-event-sync:1078630751077142608', 0));
  select * into dispatch from private.reaper_event_advance_dispatches where id = p_dispatch_id for update;
  if not found or dispatch.owner_id is distinct from p_owner_id or dispatch.state not in ('claimed', 'completed') then return false; end if;
  if dispatch.state = 'completed' then return true; end if;
  observed_at := clock_timestamp();
  if exists (select 1 from private.reaper_event_sync_runs where guild_id = dispatch.guild_id and interaction_id = dispatch.interaction_id and owner_id = p_owner_id and state = 'completed' and finished_at is not null) then
    update private.reaper_event_advance_dispatches set state = 'completed', finished_at = observed_at where id = dispatch.id;
    return true;
  end if;
  update private.reaper_event_advance_dispatches set state = 'failed', finished_at = observed_at where id = dispatch.id;
  update private.reaper_event_advancement_policy set enabled = false, disabled_reason = 'run-not-completed', updated_at = observed_at where guild_id = dispatch.guild_id;
  return false;
end;
$function$;

revoke all on function private.reaper_event_advance_instant(text), private.reaper_event_advancement_registry_ready(), private.reaper_event_advance_due_targets(timestamptz), private.reaper_dispatch_event_advance() from public, anon, authenticated, service_role;
grant execute on function private.reaper_event_advance_instant(text), private.reaper_event_advancement_registry_ready(), private.reaper_event_advance_due_targets(timestamptz) to service_role;
revoke all on function public.reaper_set_event_advancement(boolean), public.reaper_claim_event_advance(uuid,text,uuid), public.reaper_finish_event_advance(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.reaper_set_event_advancement(boolean), public.reaper_claim_event_advance(uuid,text,uuid), public.reaper_finish_event_advance(uuid,uuid) to service_role;

-- Scheduling the dormant dispatcher changes no provider state. Activation is
-- a separate approved RPC after deployment, reconciliation and exact preview.
do $block$
declare job bigint;
begin
  for job in select jobid from cron.job where jobname = 'reaper-event-advance-minute' loop perform cron.unschedule(job); end loop;
  perform cron.schedule('reaper-event-advance-minute', '* * * * *', 'select private.reaper_dispatch_event_advance();');
end;
$block$;
