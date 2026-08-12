-- Establish the inert, server-only persistence substrate for service
-- entitlements. This migration intentionally creates no producer, dispatcher,
-- backfill, HTTP call, or pg_cron job. A later reviewed migration must enable
-- each runtime capability explicitly.

create schema if not exists private;

create table private.member_entitlement_runtime_control (
  singleton boolean primary key default true,
  producer_enabled boolean not null default false,
  expiry_sweeper_enabled boolean not null default false,
  social_dispatcher_enabled boolean not null default false,
  forums_dispatcher_enabled boolean not null default false,
  social_login_enabled boolean not null default false,
  forums_login_enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  constraint member_entitlement_runtime_control_singleton_check
    check (singleton)
);

insert into private.member_entitlement_runtime_control (singleton)
values (true)
on conflict (singleton) do nothing;

create table private.member_entitlement_subject_locks (
  subject uuid primary key,
  created_at timestamptz not null default clock_timestamp()
);

create table private.member_entitlement_events (
  event_id uuid primary key default gen_random_uuid(),
  subject uuid not null,
  revision bigint not null,
  active boolean not null,
  discord_verified boolean not null,
  verified_at timestamptz,
  expires_at timestamptz,
  entitled_at_effective_time boolean generated always as (active and discord_verified) stored not null,
  effective_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint member_entitlement_events_revision_check
    check (revision between 1 and 9223372036854775807),
  constraint member_entitlement_events_verification_check
    check (
      (
        discord_verified is true
        and verified_at is not null
        and expires_at is not null
        and expires_at = verified_at + interval '7 days'
        and effective_at >= verified_at
        and effective_at < expires_at
      )
      or (
        discord_verified is false
        and verified_at is null
        and expires_at is null
      )
    ),
  constraint member_entitlement_events_subject_revision_key
    unique (subject, revision),
  constraint member_entitlement_events_identity_key
    unique (event_id, subject, revision)
);

create table private.member_entitlement_state (
  subject uuid primary key,
  active boolean not null,
  discord_verified boolean not null,
  verified_at timestamptz,
  expires_at timestamptz,
  entitled_at_effective_time boolean generated always as (active and discord_verified) stored not null,
  revision bigint not null,
  event_id uuid not null unique,
  effective_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint member_entitlement_state_revision_check
    check (revision between 1 and 9223372036854775807),
  constraint member_entitlement_state_verification_check
    check (
      (
        discord_verified is true
        and verified_at is not null
        and expires_at is not null
        and expires_at = verified_at + interval '7 days'
        and effective_at >= verified_at
        and effective_at < expires_at
      )
      or (
        discord_verified is false
        and verified_at is null
        and expires_at is null
      )
    ),
  constraint member_entitlement_state_event_fkey
    foreign key (event_id, subject, revision)
    references private.member_entitlement_events (event_id, subject, revision)
    on delete restrict,
  constraint member_entitlement_state_subject_lock_fkey
    foreign key (subject)
    references private.member_entitlement_subject_locks (subject)
    on delete restrict
);

create table private.member_entitlement_event_targets (
  event_id uuid not null references private.member_entitlement_events(event_id) on delete restrict,
  consumer text not null,
  required_at timestamptz not null default clock_timestamp(),
  primary key (event_id, consumer),
  constraint member_entitlement_event_targets_consumer_check
    check (consumer in ('social', 'forums'))
);

create table private.member_entitlement_expiry_due (
  subject uuid primary key references private.member_entitlement_state(subject) on delete cascade,
  due_at timestamptz not null,
  expected_revision bigint not null,
  expected_verified_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint member_entitlement_expiry_due_revision_check
    check (expected_revision between 1 and 9223372036854775807)
);

create index member_entitlement_events_subject_effective_idx
on private.member_entitlement_events (subject, effective_at desc);

create index member_entitlement_expiry_due_order_idx
on private.member_entitlement_expiry_due (due_at, subject);

alter table private.member_entitlement_runtime_control enable row level security;
alter table private.member_entitlement_subject_locks enable row level security;
alter table private.member_entitlement_events enable row level security;
alter table private.member_entitlement_state enable row level security;
alter table private.member_entitlement_event_targets enable row level security;
alter table private.member_entitlement_expiry_due enable row level security;

create policy member_entitlement_runtime_control_client_deny
on private.member_entitlement_runtime_control
as restrictive for all to anon, authenticated
using (false) with check (false);

create policy member_entitlement_subject_locks_client_deny
on private.member_entitlement_subject_locks
as restrictive for all to anon, authenticated
using (false) with check (false);

create policy member_entitlement_events_client_deny
on private.member_entitlement_events
as restrictive for all to anon, authenticated
using (false) with check (false);

create policy member_entitlement_state_client_deny
on private.member_entitlement_state
as restrictive for all to anon, authenticated
using (false) with check (false);

create policy member_entitlement_event_targets_client_deny
on private.member_entitlement_event_targets
as restrictive for all to anon, authenticated
using (false) with check (false);

create policy member_entitlement_expiry_due_client_deny
on private.member_entitlement_expiry_due
as restrictive for all to anon, authenticated
using (false) with check (false);

revoke all on table private.member_entitlement_runtime_control from public, anon, authenticated, service_role;
revoke all on table private.member_entitlement_subject_locks from public, anon, authenticated, service_role;
revoke all on table private.member_entitlement_events from public, anon, authenticated, service_role;
revoke all on table private.member_entitlement_state from public, anon, authenticated, service_role;
revoke all on table private.member_entitlement_event_targets from public, anon, authenticated, service_role;
revoke all on table private.member_entitlement_expiry_due from public, anon, authenticated, service_role;

create or replace function private.reject_member_entitlement_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Member entitlement events are append-only.' using errcode = '55000';
end;
$$;

revoke all on function private.reject_member_entitlement_event_mutation()
from public, anon, authenticated, service_role;

create trigger member_entitlement_events_append_only
before update or delete on private.member_entitlement_events
for each row execute function private.reject_member_entitlement_event_mutation();

create or replace function public.commit_member_entitlement_snapshot_core_v1(
  p_subject uuid,
  p_expected_revision bigint,
  p_active boolean,
  p_discord_verified boolean,
  p_verified_at timestamptz,
  p_expires_at timestamptz
)
returns table (
  result_subject uuid,
  result_revision bigint,
  result_event_id uuid,
  result_active boolean,
  result_discord_verified boolean,
  result_verified_at timestamptz,
  result_expires_at timestamptz,
  result_entitled_at_effective_time boolean,
  result_effective_at timestamptz,
  result_changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_producer_enabled boolean;
  v_claims_raw text;
  v_claims_role text;
  v_legacy_role text;
  v_existing private.member_entitlement_state%rowtype;
  v_has_existing boolean;
  v_revision bigint;
  v_event_id uuid;
begin
  v_claims_raw := nullif(current_setting('request.jwt.claims', true), '');
  v_legacy_role := nullif(current_setting('request.jwt.claim.role', true), '');

  if v_claims_raw is not null then
    begin
      v_claims_role := v_claims_raw::jsonb ->> 'role';
    exception
      when invalid_text_representation then
        raise exception 'Service role authorization is required.' using errcode = '42501';
    end;
  end if;

  if (
    v_claims_raw is not null
    and (
      v_claims_role is distinct from 'service_role'
      or (v_legacy_role is not null and v_legacy_role is distinct from v_claims_role)
    )
  ) or (
    v_claims_raw is null
    and v_legacy_role is distinct from 'service_role'
  ) then
    raise exception 'Service role authorization is required.' using errcode = '42501';
  end if;

  select control.producer_enabled
  into v_producer_enabled
  from private.member_entitlement_runtime_control as control
  where control.singleton is true;

  if v_producer_enabled is distinct from true then
    raise exception 'Member entitlement commits are disabled.' using errcode = '55000';
  end if;

  if p_subject is null or p_expected_revision is null
    or p_active is null or p_discord_verified is null
  then
    raise exception 'Member entitlement core fields are required.' using errcode = '22004';
  end if;

  if p_expected_revision < 0 then
    raise exception 'Expected revision is invalid.' using errcode = '22023';
  end if;

  insert into private.member_entitlement_subject_locks (subject)
  values (p_subject)
  on conflict (subject) do nothing;

  perform 1
  from private.member_entitlement_subject_locks as subject_lock
  where subject_lock.subject = p_subject
  for update;

  -- Timestamp validity is checked at the serialized mutation point. Re-sample
  -- only after the stable subject lock is held so a call cannot wait past its
  -- own expiry and then publish an already-stale positive snapshot.
  v_now := clock_timestamp();

  if p_discord_verified is true then
    if p_verified_at is null or p_expires_at is null then
      raise exception 'Verified entitlement timestamps are required.' using errcode = '22004';
    end if;
    if p_verified_at > v_now
      or p_expires_at <> p_verified_at + interval '7 days'
      or p_expires_at <= v_now
    then
      raise exception 'Verified entitlement timestamps are invalid.' using errcode = '22007';
    end if;
  elsif p_verified_at is not null or p_expires_at is not null then
    raise exception 'Denied entitlement timestamps must be null.' using errcode = '22007';
  end if;

  select state.*
  into v_existing
  from private.member_entitlement_state as state
  where state.subject = p_subject;
  v_has_existing := found;

  if (not v_has_existing and p_expected_revision <> 0)
    or (v_has_existing and v_existing.revision <> p_expected_revision)
  then
    raise exception 'Member entitlement revision conflict.' using errcode = '40001';
  end if;

  if v_has_existing
    and v_existing.active = p_active
    and v_existing.discord_verified = p_discord_verified
    and v_existing.verified_at is not distinct from p_verified_at
    and v_existing.expires_at is not distinct from p_expires_at
  then
    return query
    select
      v_existing.subject,
      v_existing.revision,
      null::uuid,
      v_existing.active,
      v_existing.discord_verified,
      v_existing.verified_at,
      v_existing.expires_at,
      v_existing.entitled_at_effective_time,
      v_existing.effective_at,
      false;
    return;
  end if;

  if v_has_existing and v_existing.revision = 9223372036854775807 then
    raise exception 'Member entitlement revision is exhausted.' using errcode = '22003';
  end if;

  v_revision := case when v_has_existing then v_existing.revision + 1 else 1 end;
  v_event_id := gen_random_uuid();

  insert into private.member_entitlement_events (
    event_id,
    subject,
    revision,
    active,
    discord_verified,
    verified_at,
    expires_at,
    effective_at
  ) values (
    v_event_id,
    p_subject,
    v_revision,
    p_active,
    p_discord_verified,
    p_verified_at,
    p_expires_at,
    v_now
  );

  insert into private.member_entitlement_state (
    subject,
    active,
    discord_verified,
    verified_at,
    expires_at,
    revision,
    event_id,
    effective_at,
    updated_at
  ) values (
    p_subject,
    p_active,
    p_discord_verified,
    p_verified_at,
    p_expires_at,
    v_revision,
    v_event_id,
    v_now,
    v_now
  )
  on conflict (subject) do update set
    active = excluded.active,
    discord_verified = excluded.discord_verified,
    verified_at = excluded.verified_at,
    expires_at = excluded.expires_at,
    revision = excluded.revision,
    event_id = excluded.event_id,
    effective_at = excluded.effective_at,
    updated_at = excluded.updated_at;

  insert into private.member_entitlement_event_targets (event_id, consumer, required_at)
  values
    (v_event_id, 'social', v_now),
    (v_event_id, 'forums', v_now);

  if p_discord_verified is true then
    insert into private.member_entitlement_expiry_due (
      subject,
      due_at,
      expected_revision,
      expected_verified_at,
      created_at,
      updated_at
    ) values (
      p_subject,
      p_expires_at,
      v_revision,
      p_verified_at,
      v_now,
      v_now
    )
    on conflict (subject) do update set
      due_at = excluded.due_at,
      expected_revision = excluded.expected_revision,
      expected_verified_at = excluded.expected_verified_at,
      updated_at = excluded.updated_at;
  else
    delete from private.member_entitlement_expiry_due as due
    where due.subject = p_subject;
  end if;

  return query
  select
    state.subject,
    state.revision,
    state.event_id,
    state.active,
    state.discord_verified,
    state.verified_at,
    state.expires_at,
    state.entitled_at_effective_time,
    state.effective_at,
    true
  from private.member_entitlement_state as state
  where state.subject = p_subject;
end;
$$;

revoke all on function public.commit_member_entitlement_snapshot_core_v1(uuid, bigint, boolean, boolean, timestamptz, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.commit_member_entitlement_snapshot_core_v1(uuid, bigint, boolean, boolean, timestamptz, timestamptz)
to service_role;

create or replace function private.process_member_entitlement_expiries_core_v1(
  p_now timestamptz,
  p_limit integer default 100
)
returns table (
  scanned_count integer,
  expired_count integer,
  superseded_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expiry_sweeper_enabled boolean;
  v_subject uuid;
  v_due private.member_entitlement_expiry_due%rowtype;
  v_state private.member_entitlement_state%rowtype;
  v_event_id uuid;
  v_revision bigint;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Expiry sweep bounds are invalid.' using errcode = '22023';
  end if;

  select control.expiry_sweeper_enabled
  into v_expiry_sweeper_enabled
  from private.member_entitlement_runtime_control as control
  where control.singleton is true;

  if v_expiry_sweeper_enabled is distinct from true then
    raise exception 'Member entitlement expiry processing is disabled.' using errcode = '55000';
  end if;

  scanned_count := 0;
  expired_count := 0;
  superseded_count := 0;

  for v_subject in
    select due.subject
    from private.member_entitlement_expiry_due as due
    join private.member_entitlement_subject_locks as subject_lock
      on subject_lock.subject = due.subject
    where due.due_at <= p_now
    order by due.due_at, due.subject
    for update of subject_lock skip locked
    limit p_limit
  loop
    scanned_count := scanned_count + 1;

    select due.*
    into v_due
    from private.member_entitlement_expiry_due as due
    where due.subject = v_subject
      and due.due_at <= p_now
    for update;

    if not found then
      continue;
    end if;

    select state.*
    into v_state
    from private.member_entitlement_state as state
    where state.subject = v_due.subject
    for update;

    if not found
      or v_state.discord_verified is false
      or v_state.revision <> v_due.expected_revision
      or v_state.verified_at is distinct from v_due.expected_verified_at
      or v_state.expires_at is distinct from v_due.due_at
      or v_state.expires_at > p_now
    then
      delete from private.member_entitlement_expiry_due as stale_due
      where stale_due.subject = v_due.subject;
      superseded_count := superseded_count + 1;
      continue;
    end if;

    if v_state.revision = 9223372036854775807 then
      raise exception 'Member entitlement revision is exhausted.' using errcode = '22003';
    end if;

    v_revision := v_state.revision + 1;
    v_event_id := gen_random_uuid();

    insert into private.member_entitlement_events (
      event_id,
      subject,
      revision,
      active,
      discord_verified,
      verified_at,
      expires_at,
      effective_at
    ) values (
      v_event_id,
      v_state.subject,
      v_revision,
      v_state.active,
      false,
      null,
      null,
      p_now
    );

    update private.member_entitlement_state as state
    set
      discord_verified = false,
      verified_at = null,
      expires_at = null,
      revision = v_revision,
      event_id = v_event_id,
      effective_at = p_now,
      updated_at = p_now
    where state.subject = v_state.subject
      and state.revision = v_due.expected_revision
      and state.verified_at = v_due.expected_verified_at
      and state.expires_at = v_due.due_at;

    if not found then
      raise exception 'Member entitlement expiry compare-and-swap failed.' using errcode = '40001';
    end if;

    insert into private.member_entitlement_event_targets (event_id, consumer, required_at)
    values
      (v_event_id, 'social', p_now),
      (v_event_id, 'forums', p_now);

    delete from private.member_entitlement_expiry_due as completed_due
    where completed_due.subject = v_state.subject;

    expired_count := expired_count + 1;
  end loop;

  return next;
end;
$$;

revoke all on function private.process_member_entitlement_expiries_core_v1(timestamptz, integer)
from public, anon, authenticated, service_role;

create or replace function private.run_member_entitlement_expiry_sweep_v1()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform *
  from private.process_member_entitlement_expiries_core_v1(clock_timestamp(), 100);
end;
$$;

revoke all on function private.run_member_entitlement_expiry_sweep_v1()
from public, anon, authenticated, service_role;

comment on table private.member_entitlement_runtime_control is
  'Source-only activation gates. All capabilities remain false until a separately reviewed migration enables them.';
comment on table private.member_entitlement_events is
  'Append-only full core entitlement snapshots with no member profile, role-list, provider, transport, or secret payload.';
comment on column private.member_entitlement_state.entitled_at_effective_time is
  'Historical decision at effective_at only. A future producer must also require expires_at > its current decision time.';
comment on table private.member_entitlement_event_targets is
  'Inert per-consumer delivery obligations only. A later accepted transport migration must define delivery and acknowledgement semantics.';
comment on function private.run_member_entitlement_expiry_sweep_v1() is
  'Unscheduled pg_cron target. This migration creates no cron.job.';
