begin;
select plan(63);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'reaper_event_sync_runs' and column_name = 'retry_not_before' and data_type = 'timestamp with time zone' and is_nullable = 'YES'),
  'pause cooldown is durable and existing reservations need no deadline'
);
select ok((select relrowsecurity from pg_class where oid = 'private.reaper_event_sync_runs'::regclass), 'pause migration preserves reservation RLS');
select ok(
  not has_table_privilege('anon', 'private.reaper_event_sync_runs', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.reaper_event_sync_runs', 'select,insert,update,delete'),
  'browser roles have no reservation table privileges'
);
select ok(
  has_table_privilege('service_role', 'private.reaper_event_sync_runs', 'select')
  and has_table_privilege('service_role', 'private.reaper_event_sync_runs', 'insert')
  and has_table_privilege('service_role', 'private.reaper_event_sync_runs', 'update')
  and not has_table_privilege('service_role', 'private.reaper_event_sync_runs', 'delete'),
  'service role retains only required reservation table privileges'
);
select ok(
  not has_function_privilege('anon', 'public.reaper_pause_event_sync(text,text,uuid,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.reaper_pause_event_sync(text,text,uuid,timestamptz)', 'execute'),
  'browser roles cannot pause a writer'
);
select ok(has_function_privilege('service_role', 'public.reaper_pause_event_sync(text,text,uuid,timestamptz)', 'execute'), 'service role may pause its writer');
select ok(
  not exists (
    select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.reaper_pause_event_sync(text,text,uuid,timestamptz)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no pause RPC execution grant'
);
select ok(
  not (select prosecdef from pg_proc where oid = 'public.reaper_pause_event_sync(text,text,uuid,timestamptz)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.reaper_reserve_event_sync(text,text,uuid)'::regprocedure),
  'pause and reserve remain security invoker'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.reaper_pause_event_sync(text,text,uuid,timestamptz)'::regprocedure)
  and (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.reaper_reserve_event_sync(text,text,uuid)'::regprocedure),
  'pause and reserve use empty search paths'
);
select ok(
  (select indisunique and pg_get_expr(indpred, indrelid) = '(state = ANY (ARRAY[''reserved''::text, ''writing''::text, ''blocked''::text]))' from pg_index where indexrelid = 'private.reaper_event_sync_one_active_guild_idx'::regclass),
  'existing active index excludes only terminal runs and retains blocked locks'
);
select ok(
  exists (select 1 from pg_index where indexrelid = 'private.reaper_event_sync_paused_cooldown_idx'::regclass and not indisunique and indpred is not null),
  'paused cooldown history has a separate partial lookup index'
);
select ok(
  position('pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''reaper-event-sync:'' || p_guild_id, 0))' in pg_get_functiondef('public.reaper_pause_event_sync(text,text,uuid,timestamptz)'::regprocedure)) > 0
  and position('pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''reaper-event-sync:'' || p_guild_id, 0))' in pg_get_functiondef('public.reaper_reserve_event_sync(text,text,uuid)'::regprocedure)) > 0,
  'pause and reserve serialize on the identical transaction-scoped guild lock'
);

set local role service_role;
select is(public.reaper_reserve_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333'), 'acquired', 'first fresh interaction acquires');
select is(public.reaper_pause_event_sync('843456789012345678', '853456789012345678', '44444444-4444-4444-8444-444444444444', clock_timestamp() + interval '1 hour'), false, 'wrong owner cannot pause');
select is(public.reaper_pause_event_sync('943456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', clock_timestamp() + interval '1 hour'), false, 'wrong guild cannot pause');
select is(public.reaper_pause_event_sync('843456789012345678', '863456789012345678', '33333333-3333-4333-8333-333333333333', clock_timestamp() + interval '1 hour'), false, 'wrong interaction cannot pause');
select is((select state from private.reaper_event_sync_runs where guild_id = '843456789012345678' and interaction_id = '853456789012345678'), 'reserved', 'failed owner fences preserve active reservation');
select throws_ok($$select public.reaper_pause_event_sync('invalid', '853456789012345678', '33333333-3333-4333-8333-333333333333', clock_timestamp())$$, '22023', 'Invalid event sync reservation identity.', 'pause rejects malformed guild');
select throws_ok($$select public.reaper_pause_event_sync('843456789012345678', 'invalid', '33333333-3333-4333-8333-333333333333', clock_timestamp())$$, '22023', 'Invalid event sync reservation identity.', 'pause rejects malformed interaction');
select throws_ok($$select public.reaper_pause_event_sync('843456789012345678', '853456789012345678', null, clock_timestamp())$$, '22023', 'Invalid event sync reservation identity.', 'pause rejects null owner');
select throws_ok($$select public.reaper_pause_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', null)$$, '22023', 'Invalid event sync pause deadline.', 'pause requires a deadline');
select throws_ok($$select public.reaper_pause_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', 'infinity')$$, '22023', 'Invalid event sync pause deadline.', 'pause rejects infinite future cooldown');
select throws_ok($$select public.reaper_pause_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', '-infinity')$$, '22023', 'Invalid event sync pause deadline.', 'pause rejects infinite past cooldown');
select throws_ok($$select public.reaper_pause_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', clock_timestamp() + interval '8 days')$$, '22023', 'Invalid event sync pause deadline.', 'pause rejects excessive cooldown');
select is((select state from private.reaper_event_sync_runs where guild_id = '843456789012345678' and interaction_id = '853456789012345678'), 'reserved', 'invalid deadlines preserve active reservation');
select is(public.reaper_pause_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', clock_timestamp() + interval '7 days'), true, 'reserved owner can pause within seven-day bound');
select ok(
  (select state = 'paused' and finished_at is not null and retry_not_before > finished_at and retry_not_before <= finished_at + interval '7 days' from private.reaper_event_sync_runs where guild_id = '843456789012345678' and interaction_id = '853456789012345678'),
  'pause stores terminal state, completion time and bounded deadline together'
);
select is(public.reaper_reserve_event_sync('843456789012345678', '853456789012345678', '44444444-4444-4444-8444-444444444444'), 'duplicate', 'paused interaction stays permanently deduped before cooldown check');
select is(public.reaper_reserve_event_sync('843456789012345678', '863456789012345678', '44444444-4444-4444-8444-444444444444'), 'cooldown', 'fresh interaction cannot bypass guild cooldown');
select is((select count(*) from private.reaper_event_sync_runs where guild_id = '843456789012345678' and interaction_id = '863456789012345678'), 0::bigint, 'cooldown rejection inserts no reservation');
select is(public.reaper_begin_event_sync_write('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333'), false, 'paused interaction cannot reopen for writes');
select is(public.reaper_finish_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', 'completed'), false, 'paused interaction cannot become completed');
select is(public.reaper_finish_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', 'rejected'), false, 'paused interaction cannot become rejected');
select is(public.reaper_finish_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', 'blocked'), false, 'paused interaction cannot become blocked');
select is(public.reaper_pause_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', clock_timestamp()), false, 'paused interaction cannot shorten or refresh its deadline');
select throws_ok($$select public.reaper_finish_event_sync('843456789012345678', '853456789012345678', '33333333-3333-4333-8333-333333333333', 'paused')$$, '22023', 'Invalid event sync outcome.', 'ordinary finish RPC does not gain a pause escape hatch');
select is(public.reaper_reserve_event_sync('943456789012345678', '953456789012345678', '44444444-4444-4444-8444-444444444444'), 'acquired', 'another guild can reserve during cooldown');
select is(public.reaper_begin_event_sync_write('943456789012345678', '953456789012345678', '44444444-4444-4444-8444-444444444444'), true, 'second guild enters writing');
select is(public.reaper_pause_event_sync('943456789012345678', '953456789012345678', '44444444-4444-4444-8444-444444444444', '1900-01-01T00:00:00Z'), true, 'writing owner may pause at an acknowledged boundary with a delayed response');
select ok(
  (select state = 'paused' and finished_at = retry_not_before and finished_at >= transaction_timestamp() from private.reaper_event_sync_runs where guild_id = '943456789012345678' and interaction_id = '953456789012345678'),
  'past finite deadline clamps to the actual pause timestamp'
);
select is(public.reaper_reserve_event_sync('943456789012345678', '953456789012345678', '44444444-4444-4444-8444-444444444444'), 'duplicate', 'expired paused interaction still never replays');
select is(public.reaper_reserve_event_sync('943456789012345678', '963456789012345678', '44444444-4444-4444-8444-444444444444'), 'acquired', 'fresh interaction acquires at or after cooldown end');
select is(public.reaper_reserve_event_sync('943456789012345678', '973456789012345678', '33333333-3333-4333-8333-333333333333'), 'busy', 'new active writer remains exclusive after pause');
select is(public.reaper_begin_event_sync_write('943456789012345678', '963456789012345678', '44444444-4444-4444-8444-444444444444'), true, 'fresh acquired owner enters writing');
select is(public.reaper_finish_event_sync('943456789012345678', '963456789012345678', '44444444-4444-4444-8444-444444444444', 'blocked'), true, 'uncertain writer stays blocked');
select is(public.reaper_pause_event_sync('943456789012345678', '963456789012345678', '44444444-4444-4444-8444-444444444444', clock_timestamp()), false, 'pause cannot release a blocked run');
select is(public.reaper_begin_event_sync_write('943456789012345678', '963456789012345678', '44444444-4444-4444-8444-444444444444'), false, 'blocked writer cannot resume');
select is(public.reaper_finish_event_sync('943456789012345678', '963456789012345678', '44444444-4444-4444-8444-444444444444', 'completed'), false, 'finish still cannot clear blocked run');
select ok((select state = 'blocked' and finished_at is null and retry_not_before is null from private.reaper_event_sync_runs where guild_id = '943456789012345678' and interaction_id = '963456789012345678'), 'blocked run retains its indefinite active lock');

-- Exercise precedence when historical pauses and a blocked run coexist. This
-- fixture mutation is rolled back; no transition RPC releases a blocked run.
update private.reaper_event_sync_runs set retry_not_before = clock_timestamp() + interval '1 hour' where guild_id = '943456789012345678' and interaction_id = '953456789012345678';
select is(public.reaper_reserve_event_sync('943456789012345678', '963456789012345678', '33333333-3333-4333-8333-333333333333'), 'duplicate', 'identity dedup precedes active busy and historical cooldown');
select is(public.reaper_reserve_event_sync('943456789012345678', '973456789012345678', '33333333-3333-4333-8333-333333333333'), 'busy', 'active blocked lock precedes historical cooldown');

update private.reaper_event_sync_runs set retry_not_before = finished_at where guild_id = '843456789012345678' and interaction_id = '853456789012345678';
insert into private.reaper_event_sync_runs (guild_id, interaction_id, owner_id, state, finished_at, retry_not_before)
  values ('843456789012345678', '883456789012345678', '33333333-3333-4333-8333-333333333333', 'paused', clock_timestamp(), clock_timestamp() + interval '1 hour');
select is(public.reaper_reserve_event_sync('843456789012345678', '863456789012345678', '44444444-4444-4444-8444-444444444444'), 'cooldown', 'any unexpired prior paused interaction enforces cooldown');
select is(public.reaper_reserve_event_sync('843456789012345678', '853456789012345678', '44444444-4444-4444-8444-444444444444'), 'duplicate', 'old paused identity stays deduped after its deadline expires');
update private.reaper_event_sync_runs set retry_not_before = finished_at where guild_id = '843456789012345678' and state = 'paused';
select is(public.reaper_reserve_event_sync('843456789012345678', '863456789012345678', '44444444-4444-4444-8444-444444444444'), 'acquired', 'fresh interaction acquires after every prior cooldown expires');
select is(public.reaper_pause_event_sync('843456789012345678', '863456789012345678', '33333333-3333-4333-8333-333333333333', clock_timestamp()), false, 'old owner cannot pause new interaction');
select is(public.reaper_finish_event_sync('843456789012345678', '863456789012345678', '44444444-4444-4444-8444-444444444444', 'rejected'), true, 'existing reserved preflight rejection still works');
select is(public.reaper_reserve_event_sync('843456789012345678', '893456789012345678', '44444444-4444-4444-8444-444444444444'), 'acquired', 'fresh interaction still acquires after rejection');
select is(public.reaper_finish_event_sync('843456789012345678', '893456789012345678', '44444444-4444-4444-8444-444444444444', 'completed'), true, 'existing completion still works');
select is(public.reaper_pause_event_sync('843456789012345678', '893456789012345678', '44444444-4444-4444-8444-444444444444', clock_timestamp()), false, 'completed interaction cannot be paused');
select is(public.reaper_pause_event_sync('843456789012345678', '863456789012345678', '44444444-4444-4444-8444-444444444444', clock_timestamp()), false, 'rejected interaction cannot be paused');
select throws_ok($$update private.reaper_event_sync_runs set retry_not_before = clock_timestamp() where guild_id = '943456789012345678' and interaction_id = '963456789012345678'$$, '23514', null, 'blocked run cannot carry an expiring cooldown');
select throws_ok($$update private.reaper_event_sync_runs set finished_at = null where guild_id = '843456789012345678' and interaction_id = '853456789012345678'$$, '23514', null, 'paused state requires terminal timestamp');
select throws_ok($$update private.reaper_event_sync_runs set retry_not_before = finished_at - interval '1 second' where guild_id = '843456789012345678' and interaction_id = '853456789012345678'$$, '23514', null, 'stored pause deadline cannot precede its terminal timestamp');

reset role;
select * from finish();
rollback;
