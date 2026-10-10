-- Every containment writer shares this guild fence. An uncertain writer has no
-- lease, expiry, takeover, or automatic retry. Receipts permanently deduplicate
-- immutable Gateway requests and manual/rollback invocations.
create table private.reaper_pending_containment_policy (
  guild_id text primary key check (guild_id = '1078630751077142608'),
  enabled boolean not null default false
);
insert into private.reaper_pending_containment_policy (guild_id) values ('1078630751077142608');

create table private.reaper_pending_containment_runs (
  request_key text primary key check (
    request_key ~ '^gateway:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or request_key ~ '^discord:[0-9]{17,20}$'
    or request_key ~ '^rollback:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  guild_id text not null references private.reaper_pending_containment_policy (guild_id),
  subject_id text not null check (subject_id = '*' or subject_id ~ '^[0-9]{16,22}$'),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null,
  state text not null default 'reserved' check (state in ('reserved','writing','completed','rejected','blocked')),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  result jsonb,
  check ((state in ('completed','rejected')) = (finished_at is not null)),
  check ((state = 'completed') = (result is not null)),
  check ((request_key like 'gateway:%') = (subject_id <> '*'))
);
create unique index reaper_pending_containment_one_active_guild_idx
  on private.reaper_pending_containment_runs (guild_id)
  where state in ('reserved','writing','blocked');
alter table private.reaper_pending_containment_policy enable row level security;
alter table private.reaper_pending_containment_runs enable row level security;
revoke all on private.reaper_pending_containment_policy, private.reaper_pending_containment_runs from public, anon, authenticated, service_role;
grant select, update on private.reaper_pending_containment_policy to service_role;
grant select, insert, update on private.reaper_pending_containment_runs to service_role;

create function public.reaper_reserve_pending_containment(p_request_key text, p_subject_id text, p_input_sha256 text, p_owner_id uuid)
returns text language plpgsql security invoker set search_path = '' as $function$
declare prior private.reaper_pending_containment_runs%rowtype;
begin
  if p_request_key is null or not (
    p_request_key ~ '^gateway:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_key ~ '^discord:[0-9]{17,20}$'
    or p_request_key ~ '^rollback:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) or p_subject_id is null or not (p_subject_id = '*' or p_subject_id ~ '^[0-9]{16,22}$')
    or ((p_request_key like 'gateway:%') <> (p_subject_id <> '*'))
    or p_input_sha256 is null or p_input_sha256 !~ '^[0-9a-f]{64}$' or p_owner_id is null then
    raise exception using errcode = '22023', message = 'Invalid containment request identity.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-pending-containment:1078630751077142608', 0));
  select * into prior from private.reaper_pending_containment_runs where request_key = p_request_key;
  if found then
    if prior.subject_id <> p_subject_id or prior.input_sha256 <> p_input_sha256 then return 'identity_conflict'; end if;
    return 'duplicate';
  end if;
  if exists (select 1 from private.reaper_pending_containment_runs where state in ('reserved','writing','blocked')) then return 'busy'; end if;
  if not exists (select 1 from private.reaper_pending_containment_policy where guild_id = '1078630751077142608' and enabled) then return 'disabled'; end if;
  insert into private.reaper_pending_containment_runs (request_key,guild_id,subject_id,input_sha256,owner_id)
    values (p_request_key,'1078630751077142608',p_subject_id,p_input_sha256,p_owner_id);
  return 'acquired';
end;
$function$;

create function public.reaper_pending_containment_status(p_request_key text)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select coalesce((select pg_catalog.jsonb_build_object('state', state, 'result', result)
    from private.reaper_pending_containment_runs where request_key = p_request_key),
    '{"state":"missing","result":null}'::jsonb);
$function$;

create function public.reaper_begin_pending_containment_write(p_request_key text, p_owner_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $function$
begin
  update private.reaper_pending_containment_runs set state = 'writing'
    where request_key = p_request_key and owner_id = p_owner_id and state in ('reserved','writing');
  return found;
end;
$function$;

create function public.reaper_finish_pending_containment(p_request_key text, p_owner_id uuid, p_outcome text, p_result jsonb default null)
returns boolean language plpgsql security invoker set search_path = '' as $function$
declare item text;
begin
  if p_outcome is null or p_outcome not in ('completed','rejected','blocked') then
    raise exception using errcode = '22023', message = 'Invalid containment outcome.';
  end if;
  if p_outcome = 'completed' then
    if p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_result)) <> 3
      or not (p_result ?& array['discordWrites','dbWrites','staleRecordsCleared']) then
      raise exception using errcode = '22023', message = 'Invalid containment receipt.';
    end if;
    foreach item in array array['discordWrites','dbWrites','staleRecordsCleared'] loop
      if pg_catalog.jsonb_typeof(p_result -> item) <> 'number' or (p_result ->> item) !~ '^(0|[1-9][0-9]{0,4})$'
        or (p_result ->> item)::integer > 10000 then
        raise exception using errcode = '22023', message = 'Invalid containment receipt.';
      end if;
    end loop;
  elsif p_result is not null then
    raise exception using errcode = '22023', message = 'Only completed containment has a receipt.';
  end if;
  update private.reaper_pending_containment_runs
    set state = p_outcome, finished_at = case when p_outcome = 'blocked' then null else pg_catalog.clock_timestamp() end,
      result = p_result
    where request_key = p_request_key and owner_id = p_owner_id
      and (state = 'reserved' or (state = 'writing' and p_outcome <> 'rejected'));
  return found;
end;
$function$;

create function public.reaper_set_pending_containment_enabled(p_enabled boolean)
returns boolean language plpgsql security invoker set search_path = '' as $function$
begin
  if p_enabled is null then raise exception using errcode = '22023', message = 'Invalid containment policy.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-pending-containment:1078630751077142608', 0));
  if p_enabled and exists (select 1 from private.reaper_pending_containment_runs where state in ('reserved','writing','blocked')) then
    raise exception using errcode = '55000', message = 'Reconcile active containment before changing policy.';
  end if;
  update private.reaper_pending_containment_policy set enabled = p_enabled where guild_id = '1078630751077142608';
  return found;
end;
$function$;

revoke all on function public.reaper_reserve_pending_containment(text,text,text,uuid), public.reaper_pending_containment_status(text),
  public.reaper_begin_pending_containment_write(text,uuid), public.reaper_finish_pending_containment(text,uuid,text,jsonb),
  public.reaper_set_pending_containment_enabled(boolean) from public, anon, authenticated, service_role;
grant execute on function public.reaper_reserve_pending_containment(text,text,text,uuid), public.reaper_pending_containment_status(text),
  public.reaper_begin_pending_containment_write(text,uuid), public.reaper_finish_pending_containment(text,uuid,text,jsonb),
  public.reaper_set_pending_containment_enabled(boolean) to service_role;
