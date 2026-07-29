begin;

set local lock_timeout = '5s';

-- Preserve the exact reviewed rules payload that a cycle names. The canonical
-- jsonb representation is the durable public artifact; its database-computed
-- digest and source commit bind every non-draft cycle to reconstructable rules.
create table public.raffle_rule_snapshots (
  id uuid primary key default gen_random_uuid(),
  rules_version text not null unique,
  rules_version_url text generated always as (
    '/raffle#drawing-rules-' || rules_version
  ) stored,
  canonical_rules jsonb not null,
  rules_content_hash text not null,
  source_commit_sha text not null,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint raffle_rule_snapshots_version_check check (
    rules_version ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
  ),
  constraint raffle_rule_snapshots_content_check check (
    jsonb_typeof(canonical_rules) = 'object'
    and canonical_rules <> '{}'::jsonb
    and pg_column_size(canonical_rules) <= 262144
  ),
  constraint raffle_rule_snapshots_hash_check check (
    rules_content_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint raffle_rule_snapshots_source_commit_check check (
    source_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  constraint raffle_rule_snapshots_cycle_binding_key unique (
    rules_version,
    rules_version_url,
    rules_content_hash
  )
);

comment on table public.raffle_rule_snapshots is
  'Append-only canonical official-rules snapshots. Each reviewed version is bound to its exact content digest and Website source commit.';

create or replace function public.prevent_raffle_rule_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'raffle_rule_snapshot_is_immutable';
end;
$$;

create trigger prevent_raffle_rule_snapshot_mutation
before update or delete on public.raffle_rule_snapshots
for each row execute function public.prevent_raffle_rule_snapshot_mutation();

alter table public.raffle_cycles
  add constraint raffle_cycles_rules_snapshot_fk
  foreign key (rules_version, rules_version_url, rules_content_hash)
  references public.raffle_rule_snapshots (
    rules_version,
    rules_version_url,
    rules_content_hash
  )
  on update restrict
  on delete restrict;

-- Cover every new or previously unindexed raffle foreign key so parent-row
-- maintenance and service-side joins never require a full child-table scan.
create index raffle_cycles_rules_snapshot_idx
  on public.raffle_cycles (
    rules_version,
    rules_version_url,
    rules_content_hash
  )
  where rules_content_hash is not null;

create index raffle_rule_snapshots_reviewed_by_idx
  on public.raffle_rule_snapshots (reviewed_by);

create index raffle_fulfillment_jobs_result_cycle_idx
  on public.raffle_fulfillment_jobs (draw_result_id, cycle_id);

create or replace function public.archive_raffle_rules_snapshot(
  p_rules_version text,
  p_canonical_rules jsonb,
  p_source_commit_sha text,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_hash text;
  snapshot_row public.raffle_rule_snapshots%rowtype;
  inserted boolean := false;
begin
  perform private.assert_raffle_service_caller();

  if p_actor_id is null
    or coalesce(p_rules_version, '') !~ '^[a-z0-9][a-z0-9._-]{2,63}$'
    or coalesce(p_source_commit_sha, '') !~ '^[0-9a-f]{40}$'
    or p_canonical_rules is null
    or pg_catalog.jsonb_typeof(p_canonical_rules) <> 'object'
    or p_canonical_rules = '{}'::jsonb
    or pg_catalog.pg_column_size(p_canonical_rules) > 262144 then
    raise exception 'invalid_raffle_rules_snapshot';
  end if;

  canonical_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_canonical_rules::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.raffle_rule_snapshots (
    rules_version,
    canonical_rules,
    rules_content_hash,
    source_commit_sha,
    reviewed_by,
    reviewed_at
  ) values (
    p_rules_version,
    p_canonical_rules,
    canonical_hash,
    p_source_commit_sha,
    p_actor_id,
    p_now
  )
  on conflict (rules_version) do nothing
  returning * into snapshot_row;

  if found then
    inserted := true;
    insert into public.raffle_audit_events (
      actor_id,
      event_type,
      dedupe_key,
      event_at,
      sanitized_data
    ) values (
      p_actor_id,
      'rules_snapshot_archived',
      'raffle:rules:' || p_rules_version || ':' || canonical_hash || ':archived',
      p_now,
      jsonb_build_object('outcome', 'archived')
    ) on conflict (dedupe_key) do nothing;
  else
    select * into snapshot_row
    from public.raffle_rule_snapshots
    where rules_version = p_rules_version;

    if snapshot_row.id is null
      or snapshot_row.rules_content_hash <> canonical_hash
      or snapshot_row.source_commit_sha <> p_source_commit_sha
      or snapshot_row.canonical_rules <> p_canonical_rules then
      raise exception 'raffle_rules_snapshot_conflict';
    end if;
  end if;

  return jsonb_build_object(
    'rulesVersion', snapshot_row.rules_version,
    'rulesUrl', snapshot_row.rules_version_url,
    'rulesContentHash', snapshot_row.rules_content_hash,
    'sourceCommitSha', snapshot_row.source_commit_sha,
    'duplicate', not inserted
  );
end;
$$;

-- Keep every path that locks both a draw result and its cycle in result-first
-- order. This prevents the member claim path and scheduled expiry from forming
-- a result/cycle lock inversion while preserving the existing notice contract.
create or replace function public.record_raffle_private_notice(
  p_cycle_id uuid,
  p_draw_result_id uuid,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  result_row public.raffle_draw_results%rowtype;
begin
  perform private.assert_raffle_service_caller();
  if p_actor_id is null then raise exception 'notice_actor_required'; end if;

  select * into result_row
  from public.raffle_draw_results
  where id = p_draw_result_id and cycle_id = p_cycle_id
  for update;
  if not found then raise exception 'raffle_notice_target_not_found'; end if;

  select * into cycle_row
  from public.raffle_cycles
  where id = p_cycle_id
  for update;
  if not found then raise exception 'raffle_notice_target_not_found'; end if;

  if result_row.contacted_at is not null then
    return jsonb_build_object('noticeState', 'notice_recorded', 'duplicate', true);
  end if;
  if cycle_row.status <> 'drawn' or p_now > cycle_row.expires_at
    or result_row.result_kind not in ('paid_winner', 'alternate')
    or result_row.status <> 'selected'
    or result_row.claim_opened_at is null
    or result_row.claim_deadline is null
    or p_now > result_row.claim_deadline then
    raise exception 'raffle_notice_not_recordable';
  end if;

  update public.raffle_draw_results
  set status = 'contacted', contacted_at = p_now, updated_at = p_now
  where id = result_row.id;
  insert into public.raffle_audit_events (
    cycle_id, draw_id, draw_result_id, member_id, actor_id,
    event_type, event_at, sanitized_data
  ) values (
    result_row.cycle_id, result_row.draw_id, result_row.id,
    result_row.member_id, p_actor_id, 'private_notice_recorded', p_now,
    jsonb_build_object('claimState', 'contacted', 'outcome', 'notice_recorded')
  );
  return jsonb_build_object('noticeState', 'notice_recorded', 'duplicate', false);
end;
$$;

-- The scheduler advances one cycle through claim expiry, alternate promotion,
-- or completion behind a cycle row lock. Each state transition and its audit
-- evidence commit in the same transaction, so retries are idempotent and two
-- workers cannot promote the same alternate.
create or replace function public.advance_raffle_claim_schedule(
  p_cycle_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  expired_row public.raffle_draw_results%rowtype;
  alternate_row public.raffle_draw_results%rowtype;
  expired_count integer := 0;
  promoted boolean := false;
  completed boolean := false;
  active_recipient boolean := false;
  transition text := 'wait';
  opened_at timestamptz;
  deadline timestamptz;
begin
  perform private.assert_raffle_service_caller();

  if p_cycle_id is null or p_now is null then
    raise exception 'invalid_raffle_schedule_request';
  end if;

  select * into cycle_row
  from public.raffle_cycles
  where id = p_cycle_id;

  if not found then
    raise exception 'raffle_cycle_not_found';
  end if;

  if cycle_row.status <> 'drawn' or p_now < cycle_row.draw_at then
    return jsonb_build_object(
      'cycleId', cycle_row.id,
      'expiredCount', 0,
      'promoted', false,
      'completed', false,
      'changedCount', 0,
      'transition', 'wait',
      'duplicate', true
    );
  end if;

  -- Lock only the result rows this transition may mutate, in stable selection
  -- order, before locking the cycle. Existing claim, decline, fulfillment and
  -- notice RPCs use the same result-first order.
  perform result.id
  from public.raffle_draw_results result
  where result.cycle_id = p_cycle_id
    and result.result_kind in ('paid_winner', 'alternate')
    and result.status in ('selected', 'contacted')
    and result.claim_opened_at is not null
    and result.claim_deadline is not null
    and result.claim_deadline < p_now
  order by result.selection_order, result.id
  for update;

  select * into alternate_row
  from public.raffle_draw_results result
  where result.cycle_id = p_cycle_id
    and result.result_kind = 'alternate'
    and result.status = 'selected'
    and result.claim_opened_at is null
  order by result.selection_order, result.id
  limit 1
  for update;

  select * into cycle_row
  from public.raffle_cycles
  where id = p_cycle_id
  for update;

  if not found then
    raise exception 'raffle_cycle_not_found';
  end if;

  if cycle_row.status <> 'drawn' or p_now < cycle_row.draw_at then
    return jsonb_build_object(
      'cycleId', cycle_row.id,
      'expiredCount', 0,
      'promoted', false,
      'completed', false,
      'changedCount', 0,
      'transition', 'wait',
      'duplicate', true
    );
  end if;

  for expired_row in
    update public.raffle_draw_results result
    set status = 'expired', updated_at = p_now
    where result.cycle_id = cycle_row.id
      and result.result_kind in ('paid_winner', 'alternate')
      and result.status in ('selected', 'contacted')
      and result.claim_opened_at is not null
      and result.claim_deadline is not null
      and result.claim_deadline < p_now
    returning result.*
  loop
    expired_count := expired_count + 1;
    insert into public.raffle_audit_events (
      cycle_id,
      draw_id,
      draw_result_id,
      member_id,
      event_type,
      dedupe_key,
      event_at,
      sanitized_data
    ) values (
      expired_row.cycle_id,
      expired_row.draw_id,
      expired_row.id,
      expired_row.member_id,
      'claim_expired',
      'raffle:' || expired_row.id::text || ':claim-expired',
      p_now,
      jsonb_build_object('claimState', 'expired')
    ) on conflict (dedupe_key) do nothing;
  end loop;

  select exists (
    select 1
    from public.raffle_draw_results result
    where result.cycle_id = cycle_row.id
      and result.result_kind in ('paid_winner', 'alternate')
      and (
        result.status in ('claimed', 'fulfilled')
        or (
          result.status in ('selected', 'contacted')
          and result.claim_opened_at is not null
        )
      )
  ) into active_recipient;

  if p_now > cycle_row.expires_at then
    transition := 'complete';
  elsif active_recipient then
    transition := 'wait';
  elsif alternate_row.id is not null
    and p_now + pg_catalog.make_interval(days => cycle_row.claim_window_days)
      <= cycle_row.expires_at then
    transition := 'promote';
  else
    transition := 'complete';
  end if;

  if transition = 'promote' then
    opened_at := p_now;
    deadline := p_now
      + pg_catalog.make_interval(days => cycle_row.claim_window_days);

    update public.raffle_draw_results
    set claim_opened_at = opened_at,
        claim_deadline = deadline,
        claim_window_days = cycle_row.claim_window_days,
        updated_at = opened_at
    where id = alternate_row.id
      and status = 'selected'
      and claim_opened_at is null;

    if found then
      promoted := true;
      insert into public.raffle_audit_events (
        cycle_id,
        draw_id,
        draw_result_id,
        member_id,
        event_type,
        dedupe_key,
        event_at,
        sanitized_data
      ) values (
        alternate_row.cycle_id,
        alternate_row.draw_id,
        alternate_row.id,
        alternate_row.member_id,
        'alternate_promoted',
        'raffle:' || alternate_row.id::text || ':alternate-promoted',
        p_now,
        jsonb_build_object('claimState', 'selected')
      ) on conflict (dedupe_key) do nothing;
    end if;
  elsif transition = 'complete' then
    update public.raffle_cycles
    set status = 'complete',
        completed_at = p_now,
        updated_at = p_now
    where id = cycle_row.id and status = 'drawn';

    if found then
      completed := true;
      insert into public.raffle_audit_events (
        cycle_id,
        event_type,
        dedupe_key,
        event_at,
        sanitized_data
      ) values (
        cycle_row.id,
        'cycle_completed',
        'raffle:' || cycle_row.id::text || ':cycle-completed',
        p_now,
        jsonb_build_object('cycleStatus', 'complete')
      ) on conflict (dedupe_key) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'cycleId', cycle_row.id,
    'expiredCount', expired_count,
    'promoted', promoted,
    'completed', completed,
    'changedCount', expired_count
      + case when promoted then 1 else 0 end
      + case when completed then 1 else 0 end,
    'transition', transition,
    'duplicate', expired_count = 0 and not promoted and not completed
  );
end;
$$;

alter table public.raffle_rule_snapshots enable row level security;
revoke all on table public.raffle_rule_snapshots
from public, anon, authenticated, service_role;
grant select on table public.raffle_rule_snapshots to service_role;
create policy service_only_default_deny on public.raffle_rule_snapshots
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on function public.prevent_raffle_rule_snapshot_mutation()
from public, anon, authenticated, service_role;
revoke all on function public.archive_raffle_rules_snapshot(text, jsonb, text, uuid, timestamptz)
from public, anon, authenticated;
revoke all on function public.advance_raffle_claim_schedule(uuid, timestamptz)
from public, anon, authenticated;

grant execute on function public.archive_raffle_rules_snapshot(text, jsonb, text, uuid, timestamptz)
to service_role;
grant execute on function public.advance_raffle_claim_schedule(uuid, timestamptz)
to service_role;

commit;
