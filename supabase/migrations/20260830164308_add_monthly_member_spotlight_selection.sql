create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Production precondition: deploy and verify the backward-compatible public winner
-- Edge reader before this migration activates the database-local selector.

create table if not exists public.member_spotlight_selections (
  cycle_month date primary key,
  winner_profile_id uuid references public.member_profiles(id) on delete set null,
  winner_display_name text not null,
  selection_pool_size integer,
  selection_method text not null,
  selected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint member_spotlight_selections_cycle_month_first_day_check
    check (extract(day from cycle_month) = 1),
  constraint member_spotlight_selections_winner_name_check
    check (
      char_length(winner_display_name) between 1 and 120
      and winner_display_name = btrim(winner_display_name)
      and winner_display_name !~ '[[:cntrl:]]'
      and winner_display_name !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    ),
  constraint member_spotlight_selections_pool_size_check
    check (selection_pool_size is null or selection_pool_size > 0),
  constraint member_spotlight_selections_method_check
    check (selection_method in ('monthly-random-active-account-v1', 'legacy-discord-poll'))
);

comment on table public.member_spotlight_selections is
  'Service-owned monthly Website member Spotlight winner snapshots. Public reads are limited to the winner display name and month through a bounded Edge Function.';

create index if not exists member_spotlight_selections_winner_profile_idx
on public.member_spotlight_selections (winner_profile_id)
where winner_profile_id is not null;

alter table public.member_spotlight_selections enable row level security;

drop policy if exists service_only_default_deny on public.member_spotlight_selections;
create policy service_only_default_deny
on public.member_spotlight_selections
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

revoke all on table public.member_spotlight_selections from public;
revoke all on table public.member_spotlight_selections from anon;
revoke all on table public.member_spotlight_selections from authenticated;
revoke all on table public.member_spotlight_selections from service_role;
grant select on table public.member_spotlight_selections to service_role;

create schema if not exists private;

create or replace function private.canonical_member_spotlight_name(source_name text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(
    nullif(
      left(
        btrim(
          regexp_replace(
            regexp_replace(
              coalesce(source_name, ''),
              U&'[\061C\200E\200F\202A-\202E\2066-\2069]',
              ' ',
              'g'
            ),
            '[[:space:][:cntrl:]]+',
            ' ',
            'g'
          )
        ),
        120
      ),
      ''
    ),
    'Mochirii Member'
  );
$function$;

revoke all on function private.canonical_member_spotlight_name(text) from public;
revoke all on function private.canonical_member_spotlight_name(text) from anon;
revoke all on function private.canonical_member_spotlight_name(text) from authenticated;
revoke all on function private.canonical_member_spotlight_name(text) from service_role;

create or replace function private.select_monthly_member_spotlight(
  selection_time timestamptz default now()
)
returns table (
  selected_cycle_month date,
  selected_winner_name text,
  created boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_month date;
  existing_selection public.member_spotlight_selections%rowtype;
  selected_profile_id uuid;
  selected_display_name text;
  eligible_count integer;
begin
  if selection_time is null then
    raise exception using
      errcode = '22004',
      message = 'Spotlight selection time is required.';
  end if;

  target_month := date_trunc('month', selection_time at time zone 'Asia/Singapore')::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mochirii-monthly-member-spotlight:' || target_month::text, 0)
  );

  select selection.*
  into existing_selection
  from public.member_spotlight_selections as selection
  where selection.cycle_month = target_month;

  if found then
    return query
    select existing_selection.cycle_month, existing_selection.winner_display_name, false;
    return;
  end if;

  with eligible as materialized (
    select
      profile.id,
      private.canonical_member_spotlight_name(profile.display_name) as display_name
    from auth.users as account
    inner join public.member_profiles as profile on profile.id = account.id
    where account.deleted_at is null
      and (account.banned_until is null or account.banned_until <= selection_time)
      and profile.member_status = 'active'
  )
  select eligible.id, eligible.display_name, (count(*) over ())::integer
  into selected_profile_id, selected_display_name, eligible_count
  from eligible
  order by extensions.gen_random_uuid()
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No eligible active Website member accounts are available for this Spotlight month.';
  end if;

  insert into public.member_spotlight_selections (
    cycle_month,
    winner_profile_id,
    winner_display_name,
    selection_pool_size,
    selection_method,
    selected_at
  ) values (
    target_month,
    selected_profile_id,
    selected_display_name,
    eligible_count,
    'monthly-random-active-account-v1',
    selection_time
  );

  return query select target_month, selected_display_name, true;
end;
$function$;

comment on function private.select_monthly_member_spotlight(timestamptz) is
  'Atomically selects one current active Website member account per Asia/Singapore calendar month. The candidate roster is never persisted.';

revoke all on function private.select_monthly_member_spotlight(timestamptz) from public;
revoke all on function private.select_monthly_member_spotlight(timestamptz) from anon;
revoke all on function private.select_monthly_member_spotlight(timestamptz) from authenticated;
revoke all on function private.select_monthly_member_spotlight(timestamptz) from service_role;

create or replace function private.backfill_legacy_member_spotlight_selections()
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  inserted_rows integer;
begin
  insert into public.member_spotlight_selections (
    cycle_month,
    winner_profile_id,
    winner_display_name,
    selection_pool_size,
    selection_method,
    selected_at
  )
  select
    legacy.cycle_month,
    legacy.winner_profile_id,
    private.canonical_member_spotlight_name(legacy.winner_display_name),
    null,
    'legacy-discord-poll',
    coalesce(legacy.published_at, legacy.finalized_at, legacy.updated_at)
  from public.spotlight_poll_cycles as legacy
  where legacy.status = 'published'
    and legacy.winner_display_name is not null
  on conflict (cycle_month) do nothing;

  get diagnostics inserted_rows = row_count;

  if exists (
    select 1
    from public.spotlight_poll_cycles as legacy
    left join public.member_spotlight_selections as selection
      on selection.cycle_month = legacy.cycle_month
    where legacy.status = 'published'
      and legacy.winner_display_name is not null
      and (
        selection.cycle_month is null
        or selection.selection_method <> 'legacy-discord-poll'
        or selection.winner_display_name is distinct from
          private.canonical_member_spotlight_name(legacy.winner_display_name)
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Legacy Spotlight backfill validation failed.';
  end if;

  return inserted_rows;
end;
$function$;

revoke all on function private.backfill_legacy_member_spotlight_selections() from public;
revoke all on function private.backfill_legacy_member_spotlight_selections() from anon;
revoke all on function private.backfill_legacy_member_spotlight_selections() from authenticated;
revoke all on function private.backfill_legacy_member_spotlight_selections() from service_role;

select private.backfill_legacy_member_spotlight_selections();

do $schedule$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname in (
      'mochirii-send-member-spotlight-poll',
      'mochirii-publish-member-spotlight-winner',
      'mochirii-select-monthly-spotlight-member'
    )
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'mochirii-select-monthly-spotlight-member',
    '5 16 * * *',
    $job$select private.select_monthly_member_spotlight(now());$job$
  );
end;
$schedule$;
