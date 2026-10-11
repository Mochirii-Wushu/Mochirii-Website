-- Dormant, service-only recovery control plane. Ciphertext is created/deleted
-- only through Storage API; permanent UUID receipts contain no member payload.
create table private.reaper_gateway_operations_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  backup_required boolean not null default false,
  retention_enabled boolean not null default false,
  incident_hold boolean not null default false
);
insert into private.reaper_gateway_operations_policy default values;

create table private.reaper_gateway_operations_heartbeat (
  singleton boolean primary key default true check (singleton),
  request_id uuid not null,
  observed_at timestamptz not null,
  received_at timestamptz not null,
  healthy boolean not null,
  checkpoint_id uuid,
  captured_at timestamptz,
  checked_at timestamptz,
  check ((checkpoint_id is null and captured_at is null and checked_at is null)
    or (checkpoint_id is not null and captured_at is not null and checked_at is not null and checked_at >= captured_at))
);

create table private.reaper_gateway_operations_nonces (
  nonce uuid primary key,
  received_at timestamptz not null default clock_timestamp()
);
create index reaper_gateway_operations_nonce_age_idx on private.reaper_gateway_operations_nonces (received_at);

create table private.reaper_gateway_operations_receipts (
  request_id uuid primary key check (request_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  ciphertext_sha256 text not null check (ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext_bytes bigint not null check (ciphertext_bytes between 64 and 16777216),
  captured_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  state text not null default 'pending' check (state in ('pending','accepted','deleting','blocked','retired'))
);
create unique index reaper_gateway_operations_one_writer_idx
  on private.reaper_gateway_operations_receipts ((true)) where state in ('pending','deleting','blocked');
create index reaper_gateway_operations_retention_idx
  on private.reaper_gateway_operations_receipts (captured_at desc, request_id) where state = 'accepted';
create unique index reaper_gateway_operations_live_object_idx
  on private.reaper_gateway_operations_receipts (('v1/' || request_id::text || '.age')) include (ciphertext_bytes) where state <> 'retired';

alter table private.reaper_gateway_operations_policy enable row level security;
alter table private.reaper_gateway_operations_heartbeat enable row level security;
alter table private.reaper_gateway_operations_nonces enable row level security;
alter table private.reaper_gateway_operations_receipts enable row level security;
revoke all on private.reaper_gateway_operations_policy, private.reaper_gateway_operations_heartbeat,
  private.reaper_gateway_operations_nonces, private.reaper_gateway_operations_receipts from public, anon, authenticated, service_role;
grant select, update on private.reaper_gateway_operations_policy to service_role;
grant select, insert, update on private.reaper_gateway_operations_heartbeat, private.reaper_gateway_operations_receipts to service_role;
grant select, insert, delete on private.reaper_gateway_operations_nonces to service_role;

-- Bucket creation via SQL is supported; objects remain API-only. Conflict is a
-- deployment stop, never permission or configuration takeover of an old bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('reaper-gateway-recovery', 'reaper-gateway-recovery', false, 16777216, array['application/octet-stream']);

create function private.reaper_gateway_operations_bucket_ready()
returns boolean language sql stable security invoker set search_path = '' as $function$
  select exists (select 1 from storage.buckets where id = 'reaper-gateway-recovery'
    and not public and file_size_limit = 16777216 and allowed_mime_types = array['application/octet-stream']);
$function$;

create function private.reaper_gateway_operations_bucket_known()
returns boolean language sql stable security invoker set search_path = '' as $function$
  select not exists (select 1 from storage.objects o where o.bucket_id = 'reaper-gateway-recovery'
    and not exists (select 1 from private.reaper_gateway_operations_receipts r
      where o.name = 'v1/' || r.request_id::text || '.age' and r.state <> 'retired'
        and o.metadata ->> 'size' = r.ciphertext_bytes::text));
$function$;

create function public.reaper_gateway_operations_auth(p_nonce uuid, p_timestamp bigint)
returns boolean language plpgsql security invoker set search_path = '' as $function$
declare observed_at timestamptz := clock_timestamp();
begin
  if p_nonce is null or p_nonce::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_timestamp is null or abs(extract(epoch from observed_at) - p_timestamp) > 120 then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-gateway-operations-auth', 0));
  delete from private.reaper_gateway_operations_nonces where received_at < observed_at - interval '10 minutes';
  if (select count(*) from private.reaper_gateway_operations_nonces) >= 1000 then return false; end if;
  insert into private.reaper_gateway_operations_nonces (nonce, received_at) values (p_nonce, observed_at) on conflict do nothing;
  return found;
end;
$function$;

create function public.reaper_gateway_operations_status()
returns boolean language sql stable security invoker set search_path = '' as $function$
  select exists (select 1 from private.reaper_gateway_operations_policy p
    join private.reaper_gateway_operations_heartbeat h using (singleton)
    where p.enabled and not p.incident_hold and h.healthy
      and h.received_at >= statement_timestamp() - interval '180 seconds'
      and h.received_at <= statement_timestamp()
      and private.reaper_gateway_operations_bucket_ready()
      and private.reaper_gateway_operations_bucket_known()
      and not exists (select 1 from private.reaper_gateway_operations_receipts where state in ('pending','deleting','blocked'))
      and (not p.backup_required or (h.checked_at >= statement_timestamp() - interval '900 seconds'
        and h.checked_at <= statement_timestamp() and exists (
          select 1 from private.reaper_gateway_operations_receipts r join storage.objects o
            on o.bucket_id = 'reaper-gateway-recovery' and o.name = 'v1/' || r.request_id::text || '.age'
          where r.request_id = h.checkpoint_id and r.state = 'accepted' and r.captured_at = h.captured_at
            and o.metadata ->> 'size' = r.ciphertext_bytes::text))));
$function$;

create function public.reaper_gateway_operations_heartbeat(p_request_id uuid, p_observed_at timestamptz, p_healthy boolean,
  p_checkpoint_id uuid, p_captured_at timestamptz, p_checked_at timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $function$
declare observed_at timestamptz := clock_timestamp();
begin
  if p_request_id is null or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_observed_at is null or p_healthy is null or abs(extract(epoch from observed_at - p_observed_at)) > 120
    or not ((p_checkpoint_id is null and p_captured_at is null and p_checked_at is null)
      or (p_checkpoint_id is not null and p_captured_at is not null and p_checked_at is not null
        and p_checked_at >= p_captured_at and p_checked_at <= observed_at)) then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-gateway-operations', 0));
  if not exists (select 1 from private.reaper_gateway_operations_policy where enabled and not incident_hold)
    or not private.reaper_gateway_operations_bucket_ready()
    or exists (select 1 from private.reaper_gateway_operations_heartbeat h where h.observed_at > p_observed_at) then return false; end if;
  if p_checkpoint_id is not null and not exists (select 1 from private.reaper_gateway_operations_receipts
    where request_id = p_checkpoint_id and state = 'accepted' and captured_at = p_captured_at) then return false; end if;
  insert into private.reaper_gateway_operations_heartbeat (singleton, request_id, observed_at, received_at, healthy, checkpoint_id, captured_at, checked_at)
    values (true, p_request_id, p_observed_at, observed_at, p_healthy, p_checkpoint_id, p_captured_at, p_checked_at)
    on conflict (singleton) do update set request_id = excluded.request_id, observed_at = excluded.observed_at,
      received_at = excluded.received_at, healthy = excluded.healthy, checkpoint_id = excluded.checkpoint_id,
      captured_at = excluded.captured_at, checked_at = excluded.checked_at;
  return true;
end;
$function$;

create function public.reaper_gateway_operations_receipt(p_request_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select coalesce((select jsonb_build_object('version', 1, 'request_id', request_id,
    'state', case when state = 'deleting' then 'blocked' else state end,
    'captured_at', to_char(captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ciphertext_sha256', ciphertext_sha256, 'ciphertext_bytes', ciphertext_bytes)
    from private.reaper_gateway_operations_receipts where request_id = p_request_id),
    jsonb_build_object('version', 1, 'request_id', p_request_id, 'state', 'missing', 'captured_at', null,
      'ciphertext_sha256', null, 'ciphertext_bytes', null));
$function$;

create function public.reaper_gateway_operations_reserve(p_request_id uuid, p_sha256 text, p_bytes bigint, p_captured_at timestamptz)
returns text language plpgsql security invoker set search_path = '' as $function$
declare prior private.reaper_gateway_operations_receipts%rowtype; observed_at timestamptz := clock_timestamp();
begin
  if p_request_id is null or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_bytes is null or p_bytes not between 64 and 16777216
    or p_captured_at is null or p_captured_at > observed_at then return 'invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-gateway-operations', 0));
  select * into prior from private.reaper_gateway_operations_receipts where request_id = p_request_id;
  if found then
    if prior.ciphertext_sha256 <> p_sha256 or prior.ciphertext_bytes <> p_bytes or prior.captured_at <> p_captured_at then return 'identity_conflict'; end if;
    return 'duplicate';
  end if;
  if not exists (select 1 from private.reaper_gateway_operations_policy where enabled and not incident_hold)
    or not private.reaper_gateway_operations_bucket_ready() then return 'disabled'; end if;
  if not private.reaper_gateway_operations_bucket_known() then
    update private.reaper_gateway_operations_policy set incident_hold = true;
    return 'disabled';
  end if;
  if exists (select 1 from private.reaper_gateway_operations_receipts where state in ('pending','deleting','blocked')) then return 'busy'; end if;
  if (select count(*) from private.reaper_gateway_operations_receipts where state <> 'retired') >= 15
    or (select coalesce(sum(ciphertext_bytes), 0) from private.reaper_gateway_operations_receipts where state <> 'retired') + p_bytes > 251658240 then return 'full'; end if;
  insert into private.reaper_gateway_operations_receipts (request_id, ciphertext_sha256, ciphertext_bytes, captured_at)
    values (p_request_id, p_sha256, p_bytes, p_captured_at);
  return 'acquired';
end;
$function$;

create function public.reaper_gateway_operations_complete(p_request_id uuid, p_sha256 text, p_bytes bigint)
returns boolean language plpgsql security invoker set search_path = '' as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-gateway-operations', 0));
  update private.reaper_gateway_operations_receipts r set state = 'accepted'
    where r.request_id = p_request_id and r.state in ('pending','accepted')
      and r.ciphertext_sha256 = p_sha256 and r.ciphertext_bytes = p_bytes
      and exists (select 1 from storage.objects o where o.bucket_id = 'reaper-gateway-recovery'
        and o.name = 'v1/' || r.request_id::text || '.age' and o.metadata ->> 'size' = r.ciphertext_bytes::text);
  return found;
end;
$function$;

create function public.reaper_gateway_operations_block(p_request_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-gateway-operations', 0));
  update private.reaper_gateway_operations_receipts set state = 'blocked'
    where request_id = p_request_id and state in ('pending','deleting','blocked');
  if not found then return false; end if;
  update private.reaper_gateway_operations_policy set incident_hold = true;
  return true;
end;
$function$;

create function public.reaper_gateway_operations_prune_claim()
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare selected private.reaper_gateway_operations_receipts%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-gateway-operations', 0));
  if not exists (select 1 from private.reaper_gateway_operations_policy where enabled and retention_enabled and not incident_hold)
    or not private.reaper_gateway_operations_bucket_ready()
    or exists (select 1 from private.reaper_gateway_operations_receipts where state in ('pending','deleting','blocked')) then return null; end if;
  if not private.reaper_gateway_operations_bucket_known()
    or (select count(*) from private.reaper_gateway_operations_receipts where state <> 'retired') > 15
    or (select coalesce(sum(ciphertext_bytes), 0) from private.reaper_gateway_operations_receipts where state <> 'retired') > 251658240 then
    update private.reaper_gateway_operations_policy set incident_hold = true;
    return null;
  end if;
  with recent as (
    select request_id from private.reaper_gateway_operations_receipts where state = 'accepted'
      order by captured_at desc, request_id limit 8
  ), daily as (
    select distinct on ((captured_at at time zone 'Asia/Singapore')::date) request_id
      from private.reaper_gateway_operations_receipts where state = 'accepted'
        and (captured_at at time zone 'Asia/Singapore')::date between (statement_timestamp() at time zone 'Asia/Singapore')::date - 6
          and (statement_timestamp() at time zone 'Asia/Singapore')::date
      order by (captured_at at time zone 'Asia/Singapore')::date, captured_at desc, request_id
  ) select * into selected from private.reaper_gateway_operations_receipts
    where state = 'accepted' and request_id not in (select request_id from recent union select request_id from daily)
    order by captured_at, request_id limit 1;
  if not found then return null; end if;
  update private.reaper_gateway_operations_receipts set state = 'deleting' where request_id = selected.request_id;
  return jsonb_build_object('request_id', selected.request_id, 'ciphertext_sha256', selected.ciphertext_sha256, 'ciphertext_bytes', selected.ciphertext_bytes);
end;
$function$;

create function public.reaper_gateway_operations_prune_complete(p_request_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reaper-gateway-operations', 0));
  update private.reaper_gateway_operations_receipts r set state = 'retired'
    where r.request_id = p_request_id and r.state = 'deleting'
      and not exists (select 1 from storage.objects o where o.bucket_id = 'reaper-gateway-recovery' and o.name = 'v1/' || r.request_id::text || '.age');
  return found;
end;
$function$;

-- Fixed hosted maintenance; no outbound request while the additive policy is
-- disabled. A network timeout never clears a durable deleting/upload fence.
create function private.reaper_gateway_operations_dispatch_maintenance()
returns bigint language plpgsql security definer set search_path = '' as $function$
declare shared_secret text;
begin
  if not exists (select 1 from private.reaper_gateway_operations_policy where enabled and retention_enabled and not incident_hold)
    or exists (select 1 from private.reaper_gateway_operations_receipts where state in ('pending','deleting','blocked')) then return null; end if;
  select decrypted_secret into shared_secret from vault.decrypted_secrets where name = 'reaper_gateway_operations_maintenance_secret';
  if shared_secret is null or octet_length(shared_secret) not between 32 and 256 then return null; end if;
  return net.http_post(url := 'https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/reaper-gateway-operations/maintenance',
    body := '{}'::jsonb, headers := jsonb_build_object('Content-Type', 'application/json', 'x-reaper-maintenance-secret', shared_secret), timeout_milliseconds := 90000);
end;
$function$;

revoke all on function private.reaper_gateway_operations_bucket_ready(), private.reaper_gateway_operations_bucket_known(),
  private.reaper_gateway_operations_dispatch_maintenance() from public, anon, authenticated, service_role;
grant execute on function private.reaper_gateway_operations_bucket_ready(), private.reaper_gateway_operations_bucket_known() to service_role;
revoke all on function public.reaper_gateway_operations_auth(uuid,bigint), public.reaper_gateway_operations_status(),
  public.reaper_gateway_operations_heartbeat(uuid,timestamptz,boolean,uuid,timestamptz,timestamptz),
  public.reaper_gateway_operations_receipt(uuid), public.reaper_gateway_operations_reserve(uuid,text,bigint,timestamptz),
  public.reaper_gateway_operations_complete(uuid,text,bigint), public.reaper_gateway_operations_block(uuid),
  public.reaper_gateway_operations_prune_claim(), public.reaper_gateway_operations_prune_complete(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reaper_gateway_operations_auth(uuid,bigint), public.reaper_gateway_operations_status(),
  public.reaper_gateway_operations_heartbeat(uuid,timestamptz,boolean,uuid,timestamptz,timestamptz),
  public.reaper_gateway_operations_receipt(uuid), public.reaper_gateway_operations_reserve(uuid,text,bigint,timestamptz),
  public.reaper_gateway_operations_complete(uuid,text,bigint), public.reaper_gateway_operations_block(uuid),
  public.reaper_gateway_operations_prune_claim(), public.reaper_gateway_operations_prune_complete(uuid) to service_role;

do $block$
begin
  if exists (select 1 from cron.job where jobname = 'reaper-gateway-recovery-maintenance') then
    raise exception 'Existing recovery maintenance job requires reconciliation.';
  end if;
  perform cron.schedule('reaper-gateway-recovery-maintenance', '*/15 * * * *', 'select private.reaper_gateway_operations_dispatch_maintenance();');
end;
$block$;
