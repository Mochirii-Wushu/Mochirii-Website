begin;
select plan(25);

select ok(to_regclass('private.reaper_event_sync_runs') is not null, 'durable event sync reservations exist in private schema');
select ok((select relrowsecurity from pg_class where oid = 'private.reaper_event_sync_runs'::regclass), 'reservation table enables RLS');
select ok(
  not has_table_privilege('anon', 'private.reaper_event_sync_runs', 'select')
  and not has_table_privilege('authenticated', 'private.reaper_event_sync_runs', 'select')
  and not has_table_privilege('authenticated', 'private.reaper_event_sync_runs', 'update'),
  'browser roles cannot read or alter reservations'
);
select ok(
  not has_function_privilege('anon', 'public.reaper_reserve_event_sync(text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.reaper_begin_event_sync_write(text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.reaper_finish_event_sync(text,text,uuid,text)', 'execute'),
  'browser roles cannot invoke sync reservation RPCs'
);
select ok(
  has_function_privilege('service_role', 'public.reaper_reserve_event_sync(text,text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.reaper_begin_event_sync_write(text,text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.reaper_finish_event_sync(text,text,uuid,text)', 'execute'),
  'service role can invoke the atomic transitions'
);
select ok(
  not (select prosecdef from pg_proc where oid = 'public.reaper_reserve_event_sync(text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.reaper_begin_event_sync_write(text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.reaper_finish_event_sync(text,text,uuid,text)'::regprocedure),
  'RPCs run as invoker with no privilege elevation'
);
select ok(
  exists (select 1 from pg_index where indexrelid = 'private.reaper_event_sync_one_active_guild_idx'::regclass and indisunique and indpred is not null),
  'partial unique index prevents multiple active guild writers'
);

set local role service_role;
select is(public.reaper_reserve_event_sync('123456789012345678', '223456789012345678', '11111111-1111-4111-8111-111111111111'), 'acquired', 'first owner acquires reservation');
select is(public.reaper_reserve_event_sync('123456789012345678', '223456789012345678', '22222222-2222-4222-8222-222222222222'), 'duplicate', 'same interaction never replays');
select is(public.reaper_reserve_event_sync('123456789012345678', '323456789012345678', '22222222-2222-4222-8222-222222222222'), 'busy', 'other interaction cannot acquire active guild');
select is(public.reaper_begin_event_sync_write('123456789012345678', '223456789012345678', '22222222-2222-4222-8222-222222222222'), false, 'wrong owner cannot write');
select is(public.reaper_finish_event_sync('123456789012345678', '223456789012345678', '22222222-2222-4222-8222-222222222222', 'rejected'), false, 'wrong owner cannot release reservation');
select is(public.reaper_begin_event_sync_write('123456789012345678', '223456789012345678', '11111111-1111-4111-8111-111111111111'), true, 'owner enters writing before provider request');
select is(public.reaper_finish_event_sync('123456789012345678', '223456789012345678', '11111111-1111-4111-8111-111111111111', 'rejected'), false, 'writing run cannot use preflight release');

update private.reaper_event_sync_runs set created_at = '1900-01-01T00:00:00Z' where guild_id = '123456789012345678';
select is(public.reaper_reserve_event_sync('123456789012345678', '323456789012345678', '22222222-2222-4222-8222-222222222222'), 'busy', 'age never expires or takes over an active writer');
select is(public.reaper_finish_event_sync('123456789012345678', '223456789012345678', '11111111-1111-4111-8111-111111111111', 'blocked'), true, 'uncertain writer becomes blocked');
select is(public.reaper_finish_event_sync('123456789012345678', '223456789012345678', '11111111-1111-4111-8111-111111111111', 'completed'), false, 'ordinary completion cannot clear blocked recovery');
select is(public.reaper_begin_event_sync_write('123456789012345678', '223456789012345678', '11111111-1111-4111-8111-111111111111'), false, 'blocked writer cannot issue further writes');
select is(public.reaper_reserve_event_sync('123456789012345678', '323456789012345678', '22222222-2222-4222-8222-222222222222'), 'busy', 'blocked guild has no automatic takeover');

select is(public.reaper_reserve_event_sync('423456789012345678', '523456789012345678', '22222222-2222-4222-8222-222222222222'), 'acquired', 'different guild can run independently');
select is(public.reaper_finish_event_sync('423456789012345678', '523456789012345678', '22222222-2222-4222-8222-222222222222', 'rejected'), true, 'preflight failure releases reservation');
select is(public.reaper_reserve_event_sync('423456789012345678', '523456789012345678', '22222222-2222-4222-8222-222222222222'), 'duplicate', 'rejected interaction remains deduped');
select is(public.reaper_reserve_event_sync('423456789012345678', '623456789012345678', '22222222-2222-4222-8222-222222222222'), 'acquired', 'fresh interaction can retry preflight failure');
select is(public.reaper_finish_event_sync('423456789012345678', '623456789012345678', '22222222-2222-4222-8222-222222222222', 'completed'), true, 'successful run releases guild while retaining interaction record');
select throws_ok($$select public.reaper_reserve_event_sync('invalid', '723456789012345678', '11111111-1111-4111-8111-111111111111')$$, '22023', 'Invalid event sync reservation identity.', 'invalid identities reject before reservation');

reset role;
select * from finish();
rollback;
