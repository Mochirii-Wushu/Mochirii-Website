-- Local/CI transactional fixtures only. pg_net does not send queued requests
-- before COMMIT; this test always ROLLBACKs and performs no provider traffic.
begin;
set local timezone = 'UTC';
select no_plan();

create function pg_temp.reaper_advance_fixture()
returns void language plpgsql as $$
declare activity text; ordinal integer := 0; event_id text;
begin
  delete from private.reaper_event_advance_dispatches;
  delete from private.reaper_event_sync_runs where guild_id = '1078630751077142608';
  delete from public.discord_resources where kind = 'scheduled_event' and discord_parent_id = '1078630751077142608';
  update private.reaper_event_advancement_policy set enabled = false, activated_at = null, disabled_reason = null;
  foreach activity in array array['monthly-gathering', 'monthly-raffle', 'guild-party', 'breaking-army', 'showdown', 'guild-wars', 'guild-heros-realm', 'united-resolve'] loop
    ordinal := ordinal + 1;
    event_id := case activity when 'guild-party' then '1558076114486698016' when 'monthly-gathering' then '1558024658497052722' when 'monthly-raffle' then '1479507429598302268' else '163456789012345670' || ordinal::text end;
    insert into public.discord_resources (kind, label, discord_id, discord_parent_id, metadata)
    values ('scheduled_event', activity, event_id, '1078630751077142608', jsonb_build_object(
      'managedBy', 'reaper-event-sync', 'siteEventKey', activity, 'source', 'data/guild-schedule.json', 'entityType', 'EXTERNAL',
      'startIso', '2099-01-01T14:00:00.000Z', 'endIso', '2099-01-01T16:00:00.000Z',
      'recurrenceRule', case when activity in ('breaking-army', 'showdown') then 'null'::jsonb else '{"frequency":3,"interval":1}'::jsonb end
    ));
  end loop;
end;
$$;

create function pg_temp.reaper_advance_due(p_key text default 'breaking-army')
returns void language sql as $$
  update public.discord_resources set metadata = metadata || jsonb_build_object(
    'startIso', to_char(clock_timestamp() - interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endIso', to_char(clock_timestamp() - interval '10 minutes', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) where kind = 'scheduled_event' and discord_parent_id = '1078630751077142608' and metadata->>'siteEventKey' = p_key;
$$;

create temp table advance_test_context (dispatch_id uuid, capability text, interaction_id text, response jsonb);
grant select, update on advance_test_context to service_role;
create function pg_temp.reaper_advance_enqueue()
returns void language plpgsql as $$
declare dispatch_id uuid;
begin
  truncate advance_test_context;
  dispatch_id := private.reaper_dispatch_event_advance();
  insert into advance_test_context
    select d.id, q.headers->>'x-mochirii-event-advance-capability', d.interaction_id, null
    from private.reaper_event_advance_dispatches d join net.http_request_queue q on q.id = d.request_id where d.id = dispatch_id;
end;
$$;

select ok((select relrowsecurity from pg_class where oid = 'private.reaper_event_advancement_policy'::regclass), 'activation policy has RLS');
select ok((select relrowsecurity from pg_class where oid = 'private.reaper_event_advance_dispatches'::regclass), 'capability ledger has RLS');
select ok(not has_table_privilege('anon', 'private.reaper_event_advance_dispatches', 'select,insert,update,delete') and not has_table_privilege('authenticated', 'private.reaper_event_advancement_policy', 'select,insert,update,delete'), 'browser roles cannot read capabilities or activation');
select ok(has_table_privilege('service_role', 'private.reaper_event_advance_dispatches', 'select,insert,update') and not has_table_privilege('service_role', 'private.reaper_event_advance_dispatches', 'delete'), 'service ledger privileges preserve history');
select ok(not has_function_privilege('anon', 'public.reaper_claim_event_advance(uuid,text,uuid)', 'execute') and not has_function_privilege('authenticated', 'public.reaper_set_event_advancement(boolean)', 'execute'), 'browser roles cannot activate or claim');
select ok(has_function_privilege('service_role', 'public.reaper_claim_event_advance(uuid,text,uuid)', 'execute') and has_function_privilege('service_role', 'public.reaper_finish_event_advance(uuid,uuid)', 'execute'), 'only backend can claim and finalize');
select ok(not (select prosecdef from pg_proc where oid = 'public.reaper_claim_event_advance(uuid,text,uuid)'::regprocedure) and not (select prosecdef from pg_proc where oid = 'public.reaper_set_event_advancement(boolean)'::regprocedure), 'public advancement RPCs do not elevate caller privileges');
select ok(not has_function_privilege('service_role', 'private.reaper_dispatch_event_advance()', 'execute') and not has_function_privilege('anon', 'private.reaper_dispatch_event_advance()', 'execute'), 'privileged cron dispatcher is not an exposed service RPC');
select is((select count(*)::integer from cron.job where jobname = 'reaper-event-advance-minute' and schedule = '* * * * *' and command = 'select private.reaper_dispatch_event_advance();'), 1, 'one owned minutely hosted job exists');
select is((select enabled from private.reaper_event_advancement_policy), false, 'migration never enables production dispatch');
select is(private.reaper_dispatch_event_advance(), null::uuid, 'dormant cron is a no-op without reconciled data');
select is((select count(*)::integer from private.reaper_event_advance_dispatches), 0, 'dormant tick creates no capabilities');
select is(public.reaper_set_event_advancement(true), false, 'activation refuses unreconciled registry');
select throws_ok($$select public.reaper_set_event_advancement(null)$$, '22023', 'Invalid advancement activation.', 'activation requires an explicit boolean');
select throws_ok($$update private.reaper_event_advancement_policy set activity_keys = array['guild-party']$$, '23514', null, 'policy cannot expand to another activity');
select throws_ok($$update private.reaper_event_advancement_policy set guild_id = '2078630751077142608'$$, '23514', null, 'policy cannot target another guild');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'reaper_event_advance_dispatches' and column_name in ('capability', 'token', 'secret')), 'durable ledger stores no plaintext capability');

select pg_temp.reaper_advance_fixture();
select is(private.reaper_event_advancement_registry_ready(), true, 'exact eight stable keys and protected keepers reconcile');
select is(public.reaper_set_event_advancement(true), true, 'explicit activation succeeds after reconciliation');
select is(private.reaper_dispatch_event_advance(), null::uuid, 'future activity occurrences do not dispatch');
select is((select count(*)::integer from private.reaper_event_advance_dispatches), 0, 'no due occurrence means no job or request');
update public.discord_resources set metadata = metadata - 'entityType' where metadata->>'siteEventKey' = 'guild-wars' and discord_parent_id = '1078630751077142608';
select is(private.reaper_event_advancement_registry_ready(), false, 'one incomplete metadata row cannot disappear into bool_and NULL');
select is(private.reaper_dispatch_event_advance(), null::uuid, 'registry drift sends no request');
select is((select disabled_reason from private.reaper_event_advancement_policy), 'registry-drift', 'registry drift latches policy disabled');

select pg_temp.reaper_advance_fixture();
update public.discord_resources set metadata = metadata || '{"startIso":"2000-01-03T14:00:00Z","endIso":"2000-01-03T16:00:00Z"}'::jsonb where metadata->>'siteEventKey' = 'breaking-army' and discord_parent_id = '1078630751077142608';
select is(private.reaper_event_advance_due_targets('2000-01-03T16:01:59.999999Z'), '{}'::jsonb, 'end plus delay remains exclusive immediately before boundary');
select is((select array_agg(key order by key) from jsonb_object_keys(private.reaper_event_advance_due_targets('2000-01-03T16:02:00Z')) key), array['breaking-army']::text[], 'exact end plus two-minute auto-completion delay becomes due');
select is(private.reaper_event_advance_instant('2026-02-30T14:00:00Z'), null::timestamptz, 'invalid calendar date fails closed');
select is(private.reaper_event_advance_instant('2026-10-10T14:00:00+00:00'), null::timestamptz, 'registry accepts only explicit UTC ISO authority');
select is(private.reaper_event_advance_instant('2026-10-10T14:00:00.123456Z'), '2026-10-10T14:00:00.123456Z'::timestamptz, 'microsecond boundary precision is preserved');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
select public.reaper_set_event_advancement(true);
select is(public.reaper_reserve_event_sync('1078630751077142608', '1734567890123456789', '11111111-1111-4111-8111-111111111111'), 'acquired', 'manual sync owns shared guild before cron');
select is(private.reaper_dispatch_event_advance(), null::uuid, 'manual active writer prevents any enqueue');
select is((select count(*)::integer from private.reaper_event_advance_dispatches), 0, 'cron does not manufacture a competing job');
select is(public.reaper_reserve_event_sync('2078630751077142608', '1734567890123456789', '22222222-2222-4222-8222-222222222222'), 'acquired', 'another guild remains independent');
select public.reaper_finish_event_sync('1078630751077142608', '1734567890123456789', '11111111-1111-4111-8111-111111111111', 'rejected');
select public.reaper_finish_event_sync('2078630751077142608', '1734567890123456789', '22222222-2222-4222-8222-222222222222', 'rejected');
select pg_temp.reaper_advance_enqueue();
select is((select count(*)::integer from advance_test_context), 1, 'one due activity enqueues one claimable dispatch');
select ok((select interaction_id ~ '^9[0-9]{19}$' and interaction_id::numeric > 18446744073709551615::numeric from advance_test_context), 'hosted identity is provably outside Discord uint64 namespace');
select ok((select capability ~ '^[a-f0-9]{64}$' from advance_test_context), 'dispatch has 256-bit opaque capability');
select ok((select d.capability_hash = extensions.digest(c.capability, 'sha256') from advance_test_context c join private.reaper_event_advance_dispatches d on d.id = c.dispatch_id), 'durable capability is stored only as SHA256');
select ok((select q.url = 'https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/reaper-discord-interactions/advance' and q.method = 'POST' and convert_from(q.body, 'UTF8')::jsonb = jsonb_build_object('dispatchId', d.id) from advance_test_context c join private.reaper_event_advance_dispatches d on d.id = c.dispatch_id join net.http_request_queue q on q.id = d.request_id), 'queue is pinned to approved project, method, route and dispatch-only body');
select is(private.reaper_dispatch_event_advance(), null::uuid, 'second tick never requeues pending capability');

set local role service_role;
select is(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), repeat('0', 64), '11111111-1111-4111-8111-111111111111'), null::jsonb, 'unknown/copied-project token has no authority');
select is(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), null), null::jsonb, 'claim requires an owner fence');
update advance_test_context set response = public.reaper_claim_event_advance(dispatch_id, capability, '11111111-1111-4111-8111-111111111111');
select ok((select response = jsonb_build_object('interactionId', interaction_id, 'guildId', '1078630751077142608', 'activityKeys', array['breaking-army']) from advance_test_context), 'claim returns only fixed operational identity and allowlisted activity');
select ok((select r.state = 'reserved' and r.owner_id = '11111111-1111-4111-8111-111111111111'::uuid from private.reaper_event_sync_runs r join advance_test_context c on r.interaction_id = c.interaction_id where r.guild_id = '1078630751077142608'), 'capability consumption atomically acquires existing guild reservation');
select is(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '22222222-2222-4222-8222-222222222222'), null::jsonb, 'consumed capability never replays or changes owner');
select is(public.reaper_reserve_event_sync('1078630751077142608', '1834567890123456789', '22222222-2222-4222-8222-222222222222'), 'busy', 'hosted reservation excludes concurrent manual apply');
select is(public.reaper_finish_event_advance((select dispatch_id from advance_test_context), '22222222-2222-4222-8222-222222222222'), false, 'wrong owner cannot finalize dispatch');
select is(public.reaper_finish_event_sync('1078630751077142608', (select interaction_id from advance_test_context), '11111111-1111-4111-8111-111111111111', 'completed'), true, 'same owner durably completes underlying run');
select is(public.reaper_finish_event_advance((select dispatch_id from advance_test_context), '11111111-1111-4111-8111-111111111111'), true, 'dispatch completion requires completed durable run');
select is(public.reaper_finish_event_advance((select dispatch_id from advance_test_context), '11111111-1111-4111-8111-111111111111'), true, 'completion acknowledgement is idempotent');
select is(public.reaper_reserve_event_sync('1078630751077142608', (select interaction_id from advance_test_context), '22222222-2222-4222-8222-222222222222'), 'duplicate', 'hosted run remains permanently deduplicated');
reset role;
select is(private.reaper_dispatch_event_advance(), null::uuid, 'completed job with unchanged target cannot be replayed');
select is((select enabled from private.reaper_event_advancement_policy), false, 'unchanged target after claimed completion requires reconciliation');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
select public.reaper_set_event_advancement(true);
select pg_temp.reaper_advance_enqueue();
update private.reaper_event_advance_dispatches set created_at = clock_timestamp() - interval '4 minutes', expires_at = clock_timestamp() - interval '1 minute';
select is(private.reaper_dispatch_event_advance(), null::uuid, 'expired pending dispatch is never reissued');
select is((select disabled_reason from private.reaper_event_advancement_policy), 'dispatch-expired', 'expiry is a permanent policy hold');
select is(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '11111111-1111-4111-8111-111111111111'), null::jsonb, 'expired capability cannot acquire');
select is(public.reaper_set_event_advancement(true), false, 'unreconciled failed dispatch prevents reactivation');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
select public.reaper_set_event_advancement(true);
select pg_temp.reaper_advance_enqueue();
update public.discord_resources set metadata = metadata || '{"startIso":"2000-01-01T14:00:00Z"}'::jsonb where metadata->>'siteEventKey' = 'breaking-army' and discord_parent_id = '1078630751077142608';
select is(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '11111111-1111-4111-8111-111111111111'), null::jsonb, 'claim revalidates exact target snapshot');
select is((select count(*)::integer from private.reaper_event_sync_runs where guild_id = '1078630751077142608'), 0, 'drift failure creates no reservation');
select is((select disabled_reason from private.reaper_event_advancement_policy), 'registry-drift', 'changed ownership/time stops unattended advancement');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
select public.reaper_set_event_advancement(true);
select pg_temp.reaper_advance_enqueue();
update private.reaper_event_advance_dispatches set activity_keys = array['showdown'];
select is(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '11111111-1111-4111-8111-111111111111'), null::jsonb, 'stored activity scope cannot differ from authenticated target snapshot');
select is((select count(*)::integer from private.reaper_event_sync_runs where guild_id = '1078630751077142608'), 0, 'mismatched job scope produces zero reservations or provider work');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
select public.reaper_set_event_advancement(true);
select pg_temp.reaper_advance_enqueue();
select public.reaper_reserve_event_sync('1078630751077142608', '1734567890123456789', '22222222-2222-4222-8222-222222222222');
select is(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '11111111-1111-4111-8111-111111111111'), null::jsonb, 'manual apply that starts after enqueue wins the shared reservation');
select is((select state from private.reaper_event_advance_dispatches), 'pending', 'busy claim never consumes capability or takes over manual owner');
select public.reaper_finish_event_sync('1078630751077142608', '1734567890123456789', '22222222-2222-4222-8222-222222222222', 'rejected');
select ok(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '11111111-1111-4111-8111-111111111111') is not null, 'never-consumed capability may acquire after confirmed preflight rejection');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
select pg_temp.reaper_advance_due('showdown');
select public.reaper_set_event_advancement(true);
select pg_temp.reaper_advance_enqueue();
select is((select activity_keys from private.reaper_event_advance_dispatches), array['breaking-army', 'showdown']::text[], 'overdue outage batches at most the two approved activities');
select ok(not exists (select 1 from private.reaper_event_advance_dispatches where target_snapshot ?| array['guild-party', 'guild-wars', 'monthly-gathering', 'monthly-raffle']), 'native series are excluded even when other activities are due');

select pg_temp.reaper_advance_fixture();
update public.discord_resources set discord_id = '1634567890123456799' where metadata->>'siteEventKey' = 'guild-party' and discord_parent_id = '1078630751077142608';
select is(public.reaper_set_event_advancement(true), false, 'activation preserves exact owner-selected Party keeper');
select pg_temp.reaper_advance_fixture();
update public.discord_resources set metadata = metadata || '{"siteEventKey":"guild-party"}'::jsonb where metadata->>'siteEventKey' = 'guild-wars' and discord_parent_id = '1078630751077142608';
select is(private.reaper_event_advancement_registry_ready(), false, 'duplicate enabled stable key cannot activate');

select pg_temp.reaper_advance_fixture();
insert into private.reaper_event_sync_runs (guild_id, interaction_id, owner_id, state, created_at, finished_at, retry_not_before) values ('1078630751077142608', '1734567890123456789', '11111111-1111-4111-8111-111111111111', 'paused', clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 hour');
select is(public.reaper_set_event_advancement(true), false, 'unexpired historical cooldown blocks even a fresh policy activation');
select is((select count(*)::integer from private.reaper_event_advance_dispatches), 0, 'cooldown rejection never allocates a dispatch');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
select public.reaper_set_event_advancement(true);
select pg_temp.reaper_advance_enqueue();
update private.reaper_event_advance_dispatches set created_at = clock_timestamp() - interval '4 minutes', expires_at = clock_timestamp() - interval '1 minute';
select is(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '11111111-1111-4111-8111-111111111111'), null::jsonb, 'claim independently rejects expired capability before another cron tick');
select is((select disabled_reason from private.reaper_event_advancement_policy), 'dispatch-expired', 'direct expired claim also latches policy off');
select is((select count(*)::integer from private.reaper_event_sync_runs where guild_id = '1078630751077142608'), 0, 'expired claim never reserves a writer');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
insert into private.reaper_event_sync_runs (guild_id, interaction_id, owner_id, state, created_at, finished_at, retry_not_before) values ('1078630751077142608', '1734567890123456789', '11111111-1111-4111-8111-111111111111', 'paused', clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 hour');
select is(public.reaper_set_event_advancement(true), true, 'approved activation checkpoints old terminal pause without replay');
select pg_temp.reaper_advance_enqueue();
select ok((select count(*) = 1 from advance_test_context), 'historical terminal pause is not resumed and does not masquerade as new failure');
select public.reaper_reserve_event_sync('1078630751077142608', '1834567890123456789', '22222222-2222-4222-8222-222222222222');
select public.reaper_pause_event_sync('1078630751077142608', '1834567890123456789', '22222222-2222-4222-8222-222222222222', clock_timestamp());
select is(public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '11111111-1111-4111-8111-111111111111'), null::jsonb, 'new manual pause blocks claim even after its cooldown has expired');
select is((select disabled_reason from private.reaper_event_advancement_policy), 'unresolved-run', 'new pause requires operator reconciliation');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
select public.reaper_set_event_advancement(true);
select pg_temp.reaper_advance_enqueue();
select public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '11111111-1111-4111-8111-111111111111');
select public.reaper_pause_event_sync('1078630751077142608', (select interaction_id from advance_test_context), '11111111-1111-4111-8111-111111111111', clock_timestamp() + interval '1 hour');
select is(public.reaper_finish_event_advance((select dispatch_id from advance_test_context), '11111111-1111-4111-8111-111111111111'), false, 'paused hosted run cannot be reported complete');
select is((select state from private.reaper_event_advance_dispatches), 'failed', 'paused dispatch stays unreconciled');
select is((select enabled from private.reaper_event_advancement_policy), false, 'pause disables subsequent scheduling');
select is(private.reaper_dispatch_event_advance(), null::uuid, 'paused run has no automatic continuation');
select is(public.reaper_set_event_advancement(true), false, 'cooldown and failed dispatch prevent ordinary reactivation');

select pg_temp.reaper_advance_fixture();
select pg_temp.reaper_advance_due();
select public.reaper_set_event_advancement(true);
select pg_temp.reaper_advance_enqueue();
select public.reaper_claim_event_advance((select dispatch_id from advance_test_context), (select capability from advance_test_context), '11111111-1111-4111-8111-111111111111');
update private.reaper_event_advance_dispatches set created_at = clock_timestamp() - interval '4 minutes', expires_at = clock_timestamp() - interval '1 minute', claimed_at = clock_timestamp() - interval '3 minutes';
select is(private.reaper_dispatch_event_advance(), null::uuid, 'hung claimed dispatch cannot be redelivered');
select is((select disabled_reason from private.reaper_event_advancement_policy), 'dispatch-stalled', 'hung dispatch latches unattended worker off');
select is((select state from private.reaper_event_sync_runs where guild_id = '1078630751077142608'), 'reserved', 'hung detection never expires or takes over guild reservation');
select is(public.reaper_reserve_event_sync('1078630751077142608', '1834567890123456789', '22222222-2222-4222-8222-222222222222'), 'busy', 'unknown claim acknowledgement keeps shared guild locked');
select public.reaper_finish_event_sync('1078630751077142608', (select interaction_id from advance_test_context), '11111111-1111-4111-8111-111111111111', 'blocked');
select is(public.reaper_set_event_advancement(true), false, 'activation cannot clear blocked writer');
select is((select state from private.reaper_event_sync_runs where guild_id = '1078630751077142608'), 'blocked', 'blocked state and permanent dedup history remain intact');

select * from finish();
rollback;
