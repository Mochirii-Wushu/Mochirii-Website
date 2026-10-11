begin;
select no_plan();
select ok((select not enabled and not backup_required and not retention_enabled and not incident_hold from private.reaper_gateway_operations_policy), 'all operations default inactive');
select is((select count(*) from private.reaper_gateway_operations_receipts), 0::bigint, 'migration creates no checkpoint identity');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.reaper_gateway_operations_policy'::regclass,
  'private.reaper_gateway_operations_heartbeat'::regclass, 'private.reaper_gateway_operations_nonces'::regclass,
  'private.reaper_gateway_operations_receipts'::regclass)), 'all private tables enable RLS');
select ok(not has_table_privilege('anon', oid, 'select') and not has_table_privilege('authenticated', oid, 'insert,update,delete'), 'browser roles cannot access private table: ' || relname)
  from pg_class where oid in ('private.reaper_gateway_operations_policy'::regclass, 'private.reaper_gateway_operations_heartbeat'::regclass,
    'private.reaper_gateway_operations_nonces'::regclass, 'private.reaper_gateway_operations_receipts'::regclass);
select ok(not has_table_privilege('service_role','private.reaper_gateway_operations_receipts','delete,truncate'), 'runtime cannot delete UUID tombstones');
select ok(has_table_privilege('service_role','private.reaper_gateway_operations_receipts','select,insert,update'), 'runtime explicit narrow receipt grants');
select ok(exists (select 1 from pg_index where indexrelid='private.reaper_gateway_operations_one_writer_idx'::regclass and indisunique and indpred is not null), 'unique partial index independently enforces one uncertain writer');
select ok(exists (select 1 from pg_index where indexrelid='private.reaper_gateway_operations_live_object_idx'::regclass and indisunique and indpred is not null), 'live object index excludes permanent retired tombstones');
select ok(not has_function_privilege('anon',oid,'execute') and not has_function_privilege('authenticated',oid,'execute')
  and has_function_privilege('service_role',oid,'execute') and not prosecdef and proconfig @> array['search_path=""'], 'service-only invoker RPC: ' || proname)
  from pg_proc where pronamespace = 'public'::regnamespace and proname like 'reaper_gateway_operations_%';
select ok((select prosecdef and proconfig @> array['search_path=""'] and not has_function_privilege('service_role', oid, 'execute')
  and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute')
  from pg_proc where oid = 'private.reaper_gateway_operations_dispatch_maintenance()'::regprocedure), 'only owner can dispatch fixed-origin hosted maintenance');
select is((select count(*) from cron.job where jobname = 'reaper-gateway-recovery-maintenance' and schedule = '*/15 * * * *'
  and command = 'select private.reaper_gateway_operations_dispatch_maintenance();'), 1::bigint, 'one dormant hosted cron uses owner dispatcher');
select is(private.reaper_gateway_operations_dispatch_maintenance(), null::bigint, 'disabled cron creates no provider request');
select ok((select not public and file_size_limit = 16777216 and allowed_mime_types = array['application/octet-stream']
  from storage.buckets where id = 'reaper-gateway-recovery'), 'fixed recovery bucket is private and bounded');

set local role service_role;
select is(public.reaper_gateway_operations_status(), false, 'disabled public status is unavailable');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('a',64),64,clock_timestamp()-interval '1 minute'), 'disabled', 'disabled admission creates no identity');
select is(public.reaper_gateway_operations_receipt('11111111-1111-4111-8111-111111111111'),
  '{"version":1,"request_id":"11111111-1111-4111-8111-111111111111","state":"missing","captured_at":null,"ciphertext_sha256":null,"ciphertext_bytes":null}'::jsonb, 'missing receipt exact fields are read-only');
select is(public.reaper_gateway_operations_auth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',floor(extract(epoch from clock_timestamp()))::bigint), true, 'fresh nonce admitted once');
select is(public.reaper_gateway_operations_auth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',floor(extract(epoch from clock_timestamp()))::bigint), false, 'nonce replay refused');
select is(public.reaper_gateway_operations_auth('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',floor(extract(epoch from clock_timestamp()))::bigint-121), false, 'old signed timestamp refused');
select is(public.reaper_gateway_operations_auth('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',floor(extract(epoch from clock_timestamp()))::bigint+121), false, 'future signed timestamp refused');
select is(public.reaper_gateway_operations_auth('bbbbbbbb-bbbb-1bbb-8bbb-bbbbbbbbbbbb',floor(extract(epoch from clock_timestamp()))::bigint), false, 'nonce must be UUIDv4');
update private.reaper_gateway_operations_policy set enabled = true;
select is(public.reaper_gateway_operations_heartbeat('11111111-1111-4111-8111-111111111111',clock_timestamp(),true,null,null,null), true, 'explicitly enabled heartbeat accepted');
select is(public.reaper_gateway_operations_status(), true, 'fresh server heartbeat healthy when backup requirement disabled');
update private.reaper_gateway_operations_heartbeat set received_at = clock_timestamp()-interval '181 seconds';
select is(public.reaper_gateway_operations_status(), false, 'heartbeat expires using server receipt time');
select is(public.reaper_gateway_operations_heartbeat('11111111-1111-4111-8111-111111111111',clock_timestamp()-interval '121 seconds',true,null,null,null), false, 'stale observation cannot refresh receipt time');
select is(public.reaper_gateway_operations_heartbeat('11111111-1111-4111-8111-111111111111',clock_timestamp(),true,'22222222-2222-4222-8222-222222222222',null,null), false, 'partial checkpoint fields refused');
select is(public.reaper_gateway_operations_heartbeat('11111111-1111-4111-8111-111111111111',clock_timestamp(),true,'22222222-2222-4222-8222-222222222222',clock_timestamp()-interval '1 minute',clock_timestamp()), false, 'unaccepted checkpoint cannot claim recovery');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('a',64),63,clock_timestamp()-interval '1 minute'), 'invalid', 'ciphertext lower byte bound enforced');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('a',64),16777217,clock_timestamp()-interval '1 minute'), 'invalid', 'ciphertext upper byte bound enforced');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('x',64),64,clock_timestamp()-interval '1 minute'), 'invalid', 'hash must be lowercase hex');
select is(public.reaper_gateway_operations_reserve('11111111-1111-1111-8111-111111111111',repeat('a',64),64,clock_timestamp()-interval '1 minute'), 'invalid', 'checkpoint UUIDv4 required');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('a',64),64,clock_timestamp()+interval '1 second'), 'invalid', 'future capture refused');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('a',64),64,'2026-10-10T00:00:00.000Z'), 'acquired', 'one create-only upload reservation');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('a',64),64,'2026-10-10T00:00:00.000Z'), 'duplicate', 'same UUID and exact ciphertext is permanent duplicate');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('b',64),64,'2026-10-10T00:00:00.000Z'), 'identity_conflict', 'UUID immutable hash enforced');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('a',64),65,'2026-10-10T00:00:00.000Z'), 'identity_conflict', 'UUID immutable length enforced');
select is(public.reaper_gateway_operations_reserve('11111111-1111-4111-8111-111111111111',repeat('a',64),64,'2026-10-10T00:00:00.001Z'), 'identity_conflict', 'UUID immutable capture time enforced');
select is(public.reaper_gateway_operations_complete('11111111-1111-4111-8111-111111111111',repeat('a',64),64), false, 'cannot accept nonexistent Storage object');
select is(public.reaper_gateway_operations_prune_claim(), null::jsonb, 'pending write cannot be pruned');
select throws_ok($$insert into private.reaper_gateway_operations_receipts (request_id,ciphertext_sha256,ciphertext_bytes,captured_at)
  values ('22222222-2222-4222-8222-222222222222',repeat('b',64),64,clock_timestamp())$$,
  '23505','duplicate key value violates unique constraint "reaper_gateway_operations_one_writer_idx"','independent index blocks a second active row');
update private.reaper_gateway_operations_receipts set created_at = '1900-01-01' where request_id = '11111111-1111-4111-8111-111111111111';
select is(public.reaper_gateway_operations_reserve('22222222-2222-4222-8222-222222222222',repeat('b',64),64,clock_timestamp()-interval '1 minute'), 'busy', 'uncertain upload never expires or permits takeover');
select is(public.reaper_gateway_operations_status(), false, 'uncertain reservation fails public health closed');
select is(public.reaper_gateway_operations_block('11111111-1111-4111-8111-111111111111'), true, 'mismatch creates blocked fence');
select ok((select incident_hold from private.reaper_gateway_operations_policy), 'mismatch records persistent incident hold');
select is(public.reaper_gateway_operations_complete('11111111-1111-4111-8111-111111111111',repeat('a',64),64), false, 'completion cannot clear blocked receipt');
select is(public.reaper_gateway_operations_receipt('11111111-1111-4111-8111-111111111111')->>'state', 'blocked', 'blocked receipt retained');

-- Test-only fixtures: no Storage objects or provider requests are fabricated.
-- Owner clears its synthetic private rows inside this rolled-back transaction.
reset role;
delete from private.reaper_gateway_operations_receipts;
delete from private.reaper_gateway_operations_heartbeat;
update private.reaper_gateway_operations_policy set incident_hold = false, backup_required = true;
insert into private.reaper_gateway_operations_receipts (request_id,ciphertext_sha256,ciphertext_bytes,captured_at,state)
  values ('11111111-1111-4111-8111-111111111111',repeat('a',64),64,'2026-10-01T00:00:00.000Z','accepted');
set local role service_role;
select is(public.reaper_gateway_operations_heartbeat('22222222-2222-4222-8222-222222222222',clock_timestamp(),true,
  '11111111-1111-4111-8111-111111111111','2026-10-01T00:00:00.000Z',clock_timestamp()-interval '1 second'), true, 'unchanged old checkpoint accepts fresh independent live validation time');
select is(public.reaper_gateway_operations_heartbeat('22222222-2222-4222-8222-222222222222',clock_timestamp(),true,
  '11111111-1111-4111-8111-111111111111','2026-10-01T00:00:00.001Z',clock_timestamp()-interval '1 second'), false, 'heartbeat capture must match permanent accepted receipt');
select is(public.reaper_gateway_operations_heartbeat('22222222-2222-4222-8222-222222222222',clock_timestamp(),true,
  '11111111-1111-4111-8111-111111111111','2026-10-01T00:00:00.000Z',clock_timestamp()+interval '1 second'), false, 'future live validation refused');
select is(public.reaper_gateway_operations_status(), false, 'receipt alone cannot prove a missing Storage object recoverable');

reset role;
delete from private.reaper_gateway_operations_receipts;
update private.reaper_gateway_operations_policy set backup_required = false, retention_enabled = false;
insert into private.reaper_gateway_operations_receipts (request_id,ciphertext_sha256,ciphertext_bytes,captured_at,state)
  select ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,repeat('a',64),16777216,clock_timestamp()-make_interval(mins=>i),'accepted'
    from generate_series(1,15) i;
set local role service_role;
select is((select sum(ciphertext_bytes) from private.reaper_gateway_operations_receipts), 251658240::numeric, 'fifteen maximum ciphertexts equal 240MiB hard bound');
select is(public.reaper_gateway_operations_reserve('22222222-2222-4222-8222-222222222222',repeat('b',64),64,clock_timestamp()-interval '1 minute'), 'full', 'sixteenth admission refused before reservation');
select is((select count(*) from private.reaper_gateway_operations_receipts), 15::bigint, 'refusal consumes no extra object slot or UUID');
select is(public.reaper_gateway_operations_prune_claim(), null::jsonb, 'disabled retention never removes data to make room');
update private.reaper_gateway_operations_policy set retention_enabled = true;
select is(public.reaper_gateway_operations_prune_claim()->>'request_id', '00000000-0000-4000-8000-000000000015', 'oldest eligible receipt durably claimed before cleanup');
select is(public.reaper_gateway_operations_prune_claim(), null::jsonb, 'second cleanup cannot cross durable deleting fence');
select is(public.reaper_gateway_operations_receipt('00000000-0000-4000-8000-000000000015')->>'state', 'blocked', 'deleting is exposed conservatively as blocked');
select is(public.reaper_gateway_operations_reserve('22222222-2222-4222-8222-222222222222',repeat('b',64),64,clock_timestamp()-interval '1 minute'), 'busy', 'deleting still counts and fences admission');
select is(public.reaper_gateway_operations_prune_complete('00000000-0000-4000-8000-000000000014'), false, 'unclaimed UUID cannot be retired');
select is(public.reaper_gateway_operations_prune_complete('00000000-0000-4000-8000-000000000015'), true, 'absent synthetic object permits completion of only claimed deletion');
select is(public.reaper_gateway_operations_reserve('00000000-0000-4000-8000-000000000015',repeat('a',64),16777216,
  (select captured_at from private.reaper_gateway_operations_receipts where request_id='00000000-0000-4000-8000-000000000015')), 'duplicate', 'retired UUID never becomes a create permission');
select is(public.reaper_gateway_operations_reserve('22222222-2222-4222-8222-222222222222',repeat('b',64),64,clock_timestamp()-interval '1 minute'), 'acquired', 'new admission occurs only after old slot retired');
select is((select count(*) from private.reaper_gateway_operations_receipts where state<>'retired'), 15::bigint, 'pending reservations remain inside global fifteen bound');

reset role;
delete from private.reaper_gateway_operations_receipts;
-- Eight recent snapshots today, six daily snapshots, then one just outside the
-- Singapore seven-day boundary. The oldest retained daily and obsolete record
-- share a UTC date, making accidental UTC calendar retention detectable.
insert into private.reaper_gateway_operations_receipts (request_id,ciphertext_sha256,ciphertext_bytes,captured_at,state)
  select ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,repeat('a',64),64,clock_timestamp()-make_interval(secs=>i),'accepted'
    from generate_series(1,8) i;
insert into private.reaper_gateway_operations_receipts (request_id,ciphertext_sha256,ciphertext_bytes,captured_at,state)
  select ('00000000-0000-4000-8000-' || lpad((i+8)::text,12,'0'))::uuid,repeat('a',64),64,
    (((statement_timestamp() at time zone 'Asia/Singapore')::date-i)::timestamp+interval '1 second') at time zone 'Asia/Singapore','accepted'
    from generate_series(1,6) i;
insert into private.reaper_gateway_operations_receipts (request_id,ciphertext_sha256,ciphertext_bytes,captured_at,state)
  values ('00000000-0000-4000-8000-000000000015',repeat('a',64),64,
    (((statement_timestamp() at time zone 'Asia/Singapore')::date-6)::timestamp-interval '1 second') at time zone 'Asia/Singapore','accepted');
set local role service_role;
select is(public.reaper_gateway_operations_prune_claim()->>'request_id', '00000000-0000-4000-8000-000000000015', 'Singapore seven-day boundary excludes exactly the older snapshot');
select is(public.reaper_gateway_operations_prune_complete('00000000-0000-4000-8000-000000000015'), true, 'test-only obsolete fixture finalized');
select is(public.reaper_gateway_operations_prune_claim(), null::jsonb, 'latest eight plus six other daily snapshots all remain protected');
update private.reaper_gateway_operations_policy set incident_hold=true;
select is(public.reaper_gateway_operations_prune_claim(), null::jsonb, 'incident hold blocks automatic retention');
select is(public.reaper_gateway_operations_reserve('22222222-2222-4222-8222-222222222222',repeat('b',64),64,clock_timestamp()-interval '1 minute'), 'disabled', 'incident hold blocks new upload');
select is(public.reaper_gateway_operations_status(), false, 'incident hold fails public status closed');

reset role;
delete from private.reaper_gateway_operations_nonces;
insert into private.reaper_gateway_operations_nonces (nonce)
  select ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid from generate_series(1,1000) i;
set local role service_role;
select is(public.reaper_gateway_operations_auth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',floor(extract(epoch from clock_timestamp()))::bigint), false, 'nonce cache fails closed at bounded capacity');
reset role;
update private.reaper_gateway_operations_nonces set received_at=clock_timestamp()-interval '601 seconds';
set local role service_role;
select is(public.reaper_gateway_operations_auth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',floor(extract(epoch from clock_timestamp()))::bigint), true, 'expired nonce metadata pruned without touching permanent receipts');
select is((select count(*) from private.reaper_gateway_operations_nonces),1::bigint,'nonce metadata remains bounded after TTL cleanup');
reset role;
select * from finish();
rollback;
