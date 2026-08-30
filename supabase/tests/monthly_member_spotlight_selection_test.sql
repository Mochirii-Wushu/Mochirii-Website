begin;
select plan(27);

select has_table('public', 'member_spotlight_selections', 'monthly Spotlight selection table exists');
select col_type_is('public', 'member_spotlight_selections', 'cycle_month', 'date', 'cycle month is a date');
select col_type_is('public', 'member_spotlight_selections', 'winner_profile_id', 'uuid', 'winner profile uses the account identifier type');
select col_type_is('public', 'member_spotlight_selections', 'winner_display_name', 'text', 'winner display-name snapshot is text');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.member_spotlight_selections'::regclass),
  'monthly Spotlight selections have RLS enabled'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'member_spotlight_selections'
      and policyname = 'service_only_default_deny'
      and permissive = 'RESTRICTIVE'
      and roles = array['anon', 'authenticated']::name[]
  ),
  'client roles have an explicit restrictive default-deny policy'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.member_spotlight_selections'::regclass
      and contype = 'p'
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.member_spotlight_selections'::regclass
           and attname = 'cycle_month')
      ]::smallint[]
  ),
  'one database row is permitted per calendar month'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'member_spotlight_selections'
      and indexname = 'member_spotlight_selections_winner_profile_idx'
  ),
  'winner foreign-key lookups have a supporting partial index'
);
select ok(
  has_function_privilege('postgres', 'private.select_monthly_member_spotlight(timestamptz)', 'execute')
  and has_function_privilege('postgres', 'private.canonical_member_spotlight_name(text)', 'execute')
  and has_function_privilege('postgres', 'private.backfill_legacy_member_spotlight_selections()', 'execute')
  and not has_function_privilege('anon', 'private.select_monthly_member_spotlight(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.select_monthly_member_spotlight(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'private.select_monthly_member_spotlight(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'private.canonical_member_spotlight_name(text)', 'execute')
  and not has_function_privilege('service_role', 'private.backfill_legacy_member_spotlight_selections()', 'execute'),
  'only the database owner can execute the monthly selector and migration helpers'
);
select ok(
  has_table_privilege('service_role', 'public.member_spotlight_selections', 'select')
  and not has_table_privilege('anon', 'public.member_spotlight_selections', 'select')
  and not has_table_privilege('authenticated', 'public.member_spotlight_selections', 'select'),
  'the selection table is service-readable but never client-readable'
);
select is(
  (
    select count(*)::integer
    from cron.job
    where jobname = 'mochirii-select-monthly-spotlight-member'
      and schedule = '5 16 * * *'
      and command = 'select private.select_monthly_member_spotlight(now());'
      and active
  ),
  1,
  'one active daily retry schedule starts at 00:05 Asia/Singapore'
);
select is(
  (
    select count(*)::integer
    from cron.job
    where jobname in (
      'mochirii-send-member-spotlight-poll',
      'mochirii-publish-member-spotlight-winner'
    )
  ),
  0,
  'legacy poll schedules are absent'
);

insert into public.spotlight_poll_cycles (
  cycle_month,
  poll_date,
  vote_open_at,
  vote_close_at,
  status,
  discord_channel_id,
  poll_question,
  winner_display_name,
  published_at
) values (
  '2098-12-01',
  '2098-12-01',
  '2098-12-01T00:05:00+08:00',
  '2098-12-08T00:05:00+08:00',
  'published',
  '1234567890123456',
  'Legacy Spotlight fixture',
  U&'Legacy\200F Winner',
  '2098-12-08T00:05:00+08:00'
);

select is(
  private.backfill_legacy_member_spotlight_selections(),
  1,
  'the actual migration backfill imports one published legacy winner'
);
select is(
  (
    select concat_ws('|', cycle_month::text, winner_display_name, selection_method)
    from public.member_spotlight_selections
    where cycle_month = '2098-12-01'
  ),
  '2098-12-01|Legacy Winner|legacy-discord-poll',
  'the backfill preserves the month and canonical winner snapshot exactly'
);
select is(
  private.backfill_legacy_member_spotlight_selections(),
  0,
  'the actual legacy backfill is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.member_spotlight_selections
    where cycle_month = '2098-12-01'
  ),
  1,
  'backfill replay retains one immutable row'
);

update public.member_profiles set member_status = 'suspended';

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  ('71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'spotlight-a@example.invalid', '', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'spotlight-b@example.invalid', '', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'spotlight-c@example.invalid', '', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'spotlight-d@example.invalid', '', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'spotlight-e@example.invalid', '', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'spotlight-f@example.invalid', '', now(), now(), now());

update public.member_profiles
set
  display_name = case id
    when '71000000-0000-4000-8000-000000000001' then 'Lantern Alpha'
    when '71000000-0000-4000-8000-000000000002' then U&'Lantern\000A\200FBeta'
    when '71000000-0000-4000-8000-000000000003' then 'Pending Member'
    when '71000000-0000-4000-8000-000000000004' then 'Suspended Member'
    when '71000000-0000-4000-8000-000000000005' then 'Banned Member'
    else 'Deleted Member'
  end,
  member_status = case
    when id in (
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000002',
      '71000000-0000-4000-8000-000000000005',
      '71000000-0000-4000-8000-000000000006'
    ) then 'active'
    when id = '71000000-0000-4000-8000-000000000003' then 'pending'
    else 'suspended'
  end,
  discord_user_id = null,
  discord_verified_at = null
where id::text like '71000000-0000-4000-8000-%';

update auth.users
set banned_until = '2099-12-31T00:00:00Z'
where id = '71000000-0000-4000-8000-000000000005';

update auth.users
set deleted_at = '2098-12-31T00:00:00Z'
where id = '71000000-0000-4000-8000-000000000006';

create temporary table spotlight_first_call as
select * from private.select_monthly_member_spotlight('2099-01-31T16:05:00Z');

select is(
  (select selected_cycle_month::text from spotlight_first_call),
  '2099-02-01',
  'the monthly boundary is calculated in Asia/Singapore'
);
select is((select created from spotlight_first_call), true, 'the first call creates the monthly winner');
select is(
  (select selection_pool_size from public.member_spotlight_selections where cycle_month = '2099-02-01'),
  2,
  'every active non-banned account remains eligible without Discord or display-name filtering'
);
select ok(
  (select selected_winner_name from spotlight_first_call) in ('Lantern Alpha', 'Lantern Beta'),
  'pending, suspended, banned, and deleted accounts cannot win'
);
select is(
  (select count(*)::integer from public.member_spotlight_selections where cycle_month = '2099-02-01'),
  1,
  'the first call stores one row for the month'
);

create temporary table spotlight_replay_call as
select * from private.select_monthly_member_spotlight('2099-02-14T08:00:00Z');

select is((select created from spotlight_replay_call), false, 'a same-month retry does not redraw');
select is(
  (select selected_winner_name from spotlight_replay_call),
  (select selected_winner_name from spotlight_first_call),
  'a same-month retry returns the exact original winner'
);

update public.member_profiles
set member_status = 'suspended'
where id = '71000000-0000-4000-8000-000000000001';

create temporary table spotlight_next_month_call as
select * from private.select_monthly_member_spotlight('2099-02-28T16:05:00Z');

select is((select created from spotlight_next_month_call), true, 'the first call in a new month creates a new selection');
select is(
  (select selected_winner_name from spotlight_next_month_call),
  'Lantern Beta',
  'an active account with a control-bearing source name remains eligible and receives a safe public snapshot'
);
select is(
  (select count(*)::integer from public.member_spotlight_selections where cycle_month in ('2099-02-01', '2099-03-01')),
  2,
  'successive months retain one independent immutable snapshot each'
);

update public.member_profiles set member_status = 'suspended';
select throws_ok(
  $$select * from private.select_monthly_member_spotlight('2099-03-31T16:05:00Z')$$,
  'P0002',
  'No eligible active Website member accounts are available for this Spotlight month.',
  'an empty eligible pool fails with one fixed category and creates no row'
);

select * from finish();
rollback;
