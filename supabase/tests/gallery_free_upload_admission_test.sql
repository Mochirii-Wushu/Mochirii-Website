begin;
select no_plan();

select ok(not has_column_privilege('authenticated','public.gallery_submissions','id','insert')
  and not has_column_privilege('authenticated','public.gallery_submissions','storage_path','insert'),
  'members cannot bypass reservation finalization with a direct row insert');
select ok(has_function_privilege('authenticated','public.gallery_reserve_upload(uuid,bigint,text)','execute')
  and not has_function_privilege('anon','public.gallery_reserve_upload(uuid,bigint,text)','execute'),
  'member reservation RPC is signed-in only');
select ok(not has_function_privilege('authenticated','public.gallery_reserve_discord_upload(uuid,text,bigint,text,text,text)','execute')
  and has_function_privilege('service_role','public.gallery_reserve_discord_upload(uuid,text,bigint,text,text,text)','execute'),
  'Discord reservation is service-only');
select ok(not has_function_privilege('authenticated','public.gallery_processing_admission(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.gallery_processing_admission(uuid,uuid,uuid,text)','execute')
  and has_function_privilege('service_role','public.gallery_processing_admission(uuid,uuid,uuid,text)','execute'),
  'processing admission is service-only');
select ok(not has_table_privilege('authenticated','private.gallery_upload_reservations','insert')
  and not has_table_privilege('service_role','private.gallery_processing_slot','update'),
  'private accounting and lease rows have no direct client grants');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
select ('12000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'admission-' || n || '@example.invalid','',now(),now(),now() from generate_series(1,6) n;
insert into public.member_profiles(id,member_status,has_required_discord_roles,discord_verified_at,discord_user_id)
select ('12000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'active',true,now(),
  '13000000000000000' || n from generate_series(1,6) n
on conflict(id) do update set member_status='active',has_required_discord_roles=true,
  discord_verified_at=now(),discord_user_id=excluded.discord_user_id;

set local "request.jwt.claim.role"='authenticated';
set local "request.jwt.claim.sub"='12000000-0000-4000-8000-000000000001';
select is(public.gallery_reserve_upload(null,10,'image/png')->>'code','upload_conflict','null upload ID fails closed');
select is(public.gallery_reserve_upload('13000000-0000-4000-8000-000000000001',52428801,'image/png')->>'code',
  'upload_conflict','50 MiB plus one byte cannot reserve');
select is(public.gallery_reserve_upload('13000000-0000-4000-8000-000000000001',0,'image/png')->>'code',
  'upload_conflict','empty original cannot reserve');
select is(public.gallery_reserve_upload('13000000-0000-4000-8000-000000000001',10,'image/gif')->>'code',
  'upload_conflict','unsupported original cannot reserve');
select is(public.gallery_reserve_upload('13000000-0000-4000-8000-000000000001',10,'image/png')->>'state',
  'reserved','valid original gets a committed reservation before Storage');
select is(public.gallery_reserve_upload('13000000-0000-4000-8000-000000000001',10,'image/png')->>'state',
  'reserved','same upload reservation retry is idempotent');
select is((select count(*) from private.gallery_upload_reservations
  where user_id='12000000-0000-4000-8000-000000000001'),1::bigint,'retry consumes no second quota slot');
select is(private.gallery_reserve_upload('12000000-0000-4000-8000-000000000002',
  '13000000-0000-4000-8000-000000000002',
  '12000000-0000-4000-8000-000000000002/13000000-0000-4000-8000-000000000002.png',
  10,'image/png','website',null,null)->>'code','upload_access_denied',
  'even a direct private helper call cannot reserve for another member');
select ok(private.gallery_storage_insert_allowed(
  '12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png',
  '{"contentLength":10,"mimetype":"image/png"}'),'TUS declared-length preflight uses the same reservation');
select ok(not private.gallery_storage_insert_allowed(
  '12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png',
  '{"contentLength":11,"mimetype":"image/png"}'),'TUS preflight cannot change the reserved length');
select ok(not private.gallery_storage_insert_allowed(
  '12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png',
  '{"contentLength":11,"size":10,"mimetype":"image/png"}'),'contradictory preflight/final sizes fail closed');
select ok(not private.gallery_storage_insert_allowed(
  '12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png',
  '{"mimetype":"image/png"}'),'missing Storage length authority fails closed');
select is((select state from private.gallery_upload_reservations where id='13000000-0000-4000-8000-000000000001'),
  'reserved','repeated Storage permission probes do not consume or finalize a reservation');
select is(public.gallery_reserve_upload('13000000-0000-4000-8000-000000000001',11,'image/png')->>'code',
  'upload_conflict','same ID cannot change original bytes');
select is(public.gallery_complete_upload('13000000-0000-4000-8000-000000000001','{}')->>'code',
  'upload_conflict','submission cannot precede its completed original');
select is(public.gallery_complete_upload('13000000-0000-4000-8000-000000000001','null')->>'code',
  'upload_conflict','null metadata is categorical');
select is(public.gallery_complete_upload('13000000-0000-4000-8000-000000000001','[]')->>'code',
  'upload_conflict','array metadata is categorical');
select is(public.gallery_complete_upload('13000000-0000-4000-8000-000000000001','{"user_id":"sentinel"}')->>'code',
  'upload_conflict','caller cannot supply an authoritative owner');
select is(public.gallery_complete_upload('13000000-0000-4000-8000-000000000001','{"instagram_opt_in":"true"}')->>'code',
  'upload_conflict','consent requires a real JSON boolean');
select is(public.gallery_complete_upload('13000000-0000-4000-8000-000000000001',
  '{"instagram_opt_in":true,"instagram_opt_in_copy_version":"old"}')->>'code',
  'upload_conflict','consent copy must match the exact source contract');

set local role authenticated;
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('member-gallery',
  '12000000-0000-4000-8000-000000000001/unreserved.png','{"size":10,"mimetype":"image/png"}')$$,
  '42501',null,'direct Storage API cannot create an unreserved path');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('member-gallery',
  '12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png',
  '{"size":11,"mimetype":"image/png"}')$$,'42501',null,'reserved path cannot change completed size');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('member-gallery',
  '12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png',
  '{"size":10,"mimetype":"image/png"}')$$,'reserved exact original passes actual Storage RLS');
set local storage.allow_delete_query='false';
select throws_ok($$delete from storage.objects where bucket_id='member-gallery'
  and name='12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png'$$,
  '42501','Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'platform guard rejects direct SQL deletion before row policies');
-- Storage API uses this exact session flag. Emulate it only in this rolled-back
-- SQL fixture so the platform guard cannot mask the original DELETE RLS proof.
set local storage.allow_delete_query='true';
select lives_ok($$delete from storage.objects where bucket_id='member-gallery'
  and name='12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png'$$,
  'unauthorized member deletion exposes no object');
set local storage.allow_delete_query='false';
reset role;
select ok(exists(select 1 from storage.objects where bucket_id='member-gallery'
  and name='12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png'),
  'original remains present: there is no orphan DELETE versus finalization race');
select is(public.gallery_complete_upload('13000000-0000-4000-8000-000000000001','{"title":"Admission fixture"}')->>'ok',
  'true','actual completed original finalizes atomically');
select is(public.gallery_complete_upload('13000000-0000-4000-8000-000000000001','{}')->'submission'->>'id',
  '13000000-0000-4000-8000-000000000001','uncertain completion replays the same submission');
select is(public.gallery_reserve_upload('13000000-0000-4000-8000-000000000001',10,'image/png')->>'state',
  'submitted','reserved identity acknowledges an already-submitted original');
select is((select count(*) from public.gallery_submissions where id='13000000-0000-4000-8000-000000000001'),
  1::bigint,'completion replay creates exactly one row');
select ok(not private.gallery_storage_insert_allowed(
  '12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png',
  '{"size":10,"mimetype":"image/png"}'),'submitted originals cannot be overwritten');

set local "request.jwt.claim.sub"='12000000-0000-4000-8000-000000000002';
select is(public.gallery_complete_upload('13000000-0000-4000-8000-000000000001','{}')->>'code',
  'upload_access_denied','account switching cannot finalize another member reservation');
select ok(not private.gallery_storage_insert_allowed(
  '12000000-0000-4000-8000-000000000001/13000000-0000-4000-8000-000000000001.png',
  '{"size":10,"mimetype":"image/png"}'),'account switching cannot upload another member original');

-- Legacy rows count even though they predate the reservation architecture.
insert into public.gallery_submissions(id,user_id,storage_path,mime_type,size_bytes,status,created_at)
select ('14000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  '12000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000003/legacy-' || n || '.png',
  'image/png',10,'rejected',clock_timestamp() from generate_series(1,19) n;
set local "request.jwt.claim.sub"='12000000-0000-4000-8000-000000000003';
select is(public.gallery_reserve_upload('14000000-0000-4000-8000-000000000020',10,'image/png')->>'ok',
  'true','twentieth new upload in the Singapore day is admitted');
select is(public.gallery_reserve_upload('14000000-0000-4000-8000-000000000021',10,'image/png')->>'code',
  'upload_daily_limit','twenty-first new upload in the Singapore day is denied');
select is(public.gallery_reserve_upload('14000000-0000-4000-8000-000000000020',10,'image/png')->>'ok',
  'true','retry remains possible after reaching daily quota');

insert into public.gallery_submissions(id,user_id,storage_path,mime_type,size_bytes,status)
select ('15000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  '12000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000004/legacy-' || n || '.png',
  'image/png',52428800,'pending' from generate_series(1,4) n;
set local "request.jwt.claim.sub"='12000000-0000-4000-8000-000000000004';
select is(public.gallery_reserve_upload('15000000-0000-4000-8000-000000000005',52428800,'image/png')->>'ok',
  'true','fifth 50 MiB original reaches exactly 250 MiB unreviewed capacity');
select is(public.gallery_reserve_upload('15000000-0000-4000-8000-000000000006',1,'image/png')->>'code',
  'upload_pending_limit','sixth unreviewed upload cannot reserve even a single-byte original');
select is((select sum(size_bytes) from public.gallery_submissions
  where user_id='12000000-0000-4000-8000-000000000004' and status='pending')
  +(select count(*)*52428800 from private.gallery_upload_reservations
    where user_id='12000000-0000-4000-8000-000000000004' and state='reserved'),
  262144000::numeric,'unfinished originals are charged 50 MiB, not their declared size');

set local "request.jwt.claim.role"='service_role';
create function pg_temp.discord_reserve() returns jsonb language sql as $$
  select public.gallery_reserve_discord_upload('12000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000002/discord/source.png',10,'image/png','160000000000000001','160000000000000002');
$$;
select is(pg_temp.discord_reserve()->>'ok','true','Discord uses the same persisted admission budget');
select is(pg_temp.discord_reserve()->>'upload_id',pg_temp.discord_reserve()->>'upload_id',
  'Discord source identity reuses one database-generated UUID');
select is(public.gallery_reserve_discord_upload('12000000-0000-4000-8000-000000000002',
  '12000000-0000-4000-8000-000000000002/discord/source.png',11,'image/png','160000000000000001','160000000000000002')->>'code',
  'upload_conflict','Discord source replay cannot change the reserved original');
insert into storage.objects(bucket_id,name,metadata) values('member-gallery',
  '12000000-0000-4000-8000-000000000002/discord/source.png','{"size":10,"mimetype":"image/png"}');
select is(public.gallery_complete_discord_upload((pg_temp.discord_reserve()->>'upload_id')::uuid,
  '{"discord_guild_id":"1078630751077142608","discord_channel_id":"160000000000000003","discord_user_id":"130000000000000002"}')->>'ok',
  'true','Discord completion binds stored source identity and verified member mapping');
select is(public.gallery_complete_discord_upload((pg_temp.discord_reserve()->>'upload_id')::uuid,'{}')->>'ok',
  'true','Discord lost completion acknowledgement reconciles without another object');

insert into storage.buckets(id,name,public) values('admission-other-bucket','admission-other-bucket',false);
insert into storage.objects(bucket_id,name,metadata) values('admission-other-bucket','history.bin',
  jsonb_build_object('size',786432000-private.gallery_admission_bytes()-55656448,'mimetype','application/octet-stream'));
set local "request.jwt.claim.role"='authenticated';
set local "request.jwt.claim.sub"='12000000-0000-4000-8000-000000000005';
select is(public.gallery_reserve_upload('17000000-0000-4000-8000-000000000001',10,'image/png')->>'ok',
  'true','all-bucket completed bytes plus original and derivative holds admit exactly 750 MiB');
select is(private.gallery_admission_bytes(),786432000::numeric,'project admission total reaches exactly 750 MiB');
select is(public.gallery_reserve_upload('17000000-0000-4000-8000-000000000002',10,'image/png')->>'code',
  'upload_project_limit','next original fails before Storage when project admission capacity is full');
update storage.objects set metadata='{"size":"invalid"}' where bucket_id='admission-other-bucket';
select is(public.gallery_reserve_upload('17000000-0000-4000-8000-000000000003',10,'image/png')->>'code',
  'upload_project_limit','unaccountable metadata in any bucket fails admission closed');
update storage.objects set metadata=jsonb_build_object('size',0,'mimetype','application/octet-stream')
  where bucket_id='admission-other-bucket';
select ok(exists(select 1 from storage.objects where bucket_id='admission-other-bucket' and name='history.bin'),
  'quota rejection never deletes historical objects');

set local "request.jwt.claim.role"='service_role';
create function pg_temp.lease(token uuid,operation text) returns jsonb language sql as $$
  select public.gallery_processing_admission('12000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',token,operation);
$$;
select is(pg_temp.lease('18000000-0000-4000-8000-000000000001','acquire')->>'code','acquired',
  'first project-wide processing attempt acquires the singleton');
select is(pg_temp.lease('18000000-0000-4000-8000-000000000001','acquire')->>'code','acquired',
  'same active owner token acquire is idempotent');
select is(pg_temp.lease('18000000-0000-4000-8000-000000000002','acquire')->>'code','busy',
  'another function instance cannot decode concurrently');
select is(public.gallery_processing_admission('12000000-0000-4000-8000-000000000002',
  '13000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000001','release')->>'code',
  'not_owner','different actor cannot release the active decode');
update private.gallery_processing_slot set acquired_at=clock_timestamp()-interval '121 seconds' where singleton;
select is(pg_temp.lease('18000000-0000-4000-8000-000000000001','acquire')->>'code','stale',
  'expired owner token cannot resume decode');
select is(pg_temp.lease('18000000-0000-4000-8000-000000000002','acquire')->>'code','stale',
  'expired slot has no automatic takeover');
select is(pg_temp.lease('18000000-0000-4000-8000-000000000001','release')->>'code','released',
  'matching owner can release only after its native work settles, even after expiry');
select is(pg_temp.lease('18000000-0000-4000-8000-000000000001','acquire')->>'code','not_owner',
  'released-token tombstone prevents acquire-envelope replay');
select is(pg_temp.lease('18000000-0000-4000-8000-000000000002','acquire')->>'code','acquired',
  'a fresh owner token can acquire after real release');
select is(pg_temp.lease('18000000-0000-4000-8000-000000000001','release')->>'code','released',
  'old release retry is harmless while a newer lease is active');
select is((select lease_id::text from private.gallery_processing_slot where singleton),
  '18000000-0000-4000-8000-000000000002','old release never clears another active token');
select is(pg_temp.lease('18000000-0000-4000-8000-000000000002','release')->>'code','released',
  'current owner release clears the singleton');
select is((select count(*) from private.gallery_processing_tokens where released_at is not null),2::bigint,
  'retired tokens remain permanent replay tombstones');
select * from finish();
rollback;
