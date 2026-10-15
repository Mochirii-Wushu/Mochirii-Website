begin;
select plan(32);
select has_column('public','gallery_submissions','viewer_revision_id','viewer revision exists');
select has_column('public','gallery_submissions','source_sha256','private source digest exists');
select ok(
  not has_function_privilege('anon','public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid,jsonb)','execute')
  and not has_function_privilege('authenticated','public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid,jsonb)','execute')
  and has_function_privilege('service_role','public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid,jsonb)','execute'),
  'only service role can select processed media');
select ok(
  not has_function_privilege('service_role','private.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid)','execute'),
  'legacy thumbnail-only approval cannot bypass the wrapper');
select ok(to_regprocedure('public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid)') is null,
  'old public overload is absent');
select ok((select public=false and file_size_limit=52428800 from storage.buckets where id='member-gallery'),
  'bucket remains private with the existing 50 MiB storage cap');
select ok(not has_column_privilege('authenticated','public.gallery_submissions','id','insert'),
  'member retries use one stable ID through atomic reservation finalization only');
select ok(not has_column_privilege('authenticated','public.gallery_submissions','viewer_storage_path','insert'),
  'members cannot choose their own public derivative');
select ok(position('52428800' in pg_get_constraintdef((select oid from pg_constraint
  where conrelid='public.gallery_submissions'::regclass and conname='gallery_submissions_size_bytes_check')))>0,
  'database original limit is independently bounded');
select ok(position('gallery-media-v1' in pg_get_constraintdef((select oid from pg_constraint
  where conrelid='public.gallery_submissions'::regclass and conname='gallery_viewer_complete_check')))>0,
  'source version and all-or-none same-revision media tuple are constrained');
-- Execute the actual service transaction, not only schema/source assertions.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
  ('11000000-0000-4000-8000-000000000001','authenticated','authenticated','media-owner@example.invalid','',now(),now(),now()),
  ('11000000-0000-4000-8000-000000000002','authenticated','authenticated','media-moderator@example.invalid','',now(),now(),now());
insert into public.gallery_submissions(id,user_id,storage_path,mime_type,size_bytes,title,
  instagram_opt_in,instagram_opt_in_at,instagram_opt_in_source,instagram_opt_in_copy_version) values
  ('11000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000001/source.jpg','image/jpeg',1000,'Processed fixture',
   true,now(),'website_upload','fixture-v1');
insert into storage.objects(bucket_id,name,metadata) values
  ('member-gallery','11000000-0000-4000-8000-000000000001/source.jpg',
   jsonb_build_object('size',1000,'mimetype','image/jpeg','eTag',repeat('a',32)));
create function pg_temp.media_fixture() returns jsonb language sql as $$
  select jsonb_build_object('storage_bucket','member-gallery',
    'storage_path','11000000-0000-4000-8000-000000000001/source.jpg','mime_type','image/jpeg',
    'size_bytes',1000,'etag',repeat('a',32),'sha256',repeat('b',64),
    'viewer_storage_path','_approved/full/11000000-0000-4000-8000-000000000003/11000000-0000-4000-8000-000000000004.webp',
    'viewer_size_bytes',900,'viewer_width',1280,'viewer_height',720,'processing_version','gallery-media-v1');
$$;
create function pg_temp.publish_fixture(media jsonb) returns jsonb language sql as $$
  select public.gallery_commit_moderation('11000000-0000-4000-8000-000000000003',
    '11000000-0000-4000-8000-000000000002','approved',null,
    '11000000-0000-4000-8000-000000000004',
    '_approved/thumbs/11000000-0000-4000-8000-000000000003/11000000-0000-4000-8000-000000000004.webp',
    'image/webp',800,null,media);
$$;
set local "request.jwt.claim.role"='authenticated';
select throws_ok($$select pg_temp.publish_fixture(pg_temp.media_fixture())$$,'42501','Service role required.',
  'actual transaction rejects non-service claims');
set local "request.jwt.claim.role"='service_role';
select throws_ok($$select pg_temp.publish_fixture(null)$$,'22023','Complete processed gallery media required.',
  'missing proof is rejected');
select throws_ok($$select pg_temp.publish_fixture('null'::jsonb)$$,'22023','Complete processed gallery media required.',
  'JSON null is rejected categorically');
select throws_ok($$select pg_temp.publish_fixture('[]'::jsonb)$$,'22023','Complete processed gallery media required.',
  'array proof is rejected without object-key evaluation');
select throws_ok($$select pg_temp.publish_fixture('1'::jsonb)$$,'22023','Complete processed gallery media required.',
  'scalar proof is rejected categorically');
select throws_ok($$select pg_temp.publish_fixture(pg_temp.media_fixture()-'etag')$$,'22023','Complete processed gallery media required.',
  'incomplete source binding is rejected');
select throws_ok($$select pg_temp.publish_fixture(pg_temp.media_fixture()||'{"extra":true}')$$,'22023','Complete processed gallery media required.',
  'extra proof fields are rejected');
select throws_ok($$select pg_temp.publish_fixture(pg_temp.media_fixture()||'{"viewer_width":2561}')$$,'22023','Invalid processed gallery bounds.',
  'full-view dimension ceiling is enforced by the transaction');
select is(pg_temp.publish_fixture(pg_temp.media_fixture()||jsonb_build_object('etag',repeat('c',32)))->>'reason',
  'original_object_mismatch','source ETag drift prevents publication');
select is(pg_temp.publish_fixture(pg_temp.media_fixture())->>'reason','viewer_object_mismatch',
  'missing full object prevents publication');
insert into storage.objects(bucket_id,name,metadata) values
  ('member-gallery','_approved/full/11000000-0000-4000-8000-000000000003/11000000-0000-4000-8000-000000000004.webp',
   '{"size":900,"mimetype":"image/webp"}');
select is(pg_temp.publish_fixture(pg_temp.media_fixture())->>'reason','thumbnail_object_mismatch',
  'missing thumbnail prevents publication');
select ok((select status='pending' and viewer_revision_id is null and thumbnail_revision_id is null
  from public.gallery_submissions where id='11000000-0000-4000-8000-000000000003'),
  'all failed preparations leave the pending selection untouched');
insert into storage.objects(bucket_id,name,metadata) values
  ('member-gallery','_approved/thumbs/11000000-0000-4000-8000-000000000003/11000000-0000-4000-8000-000000000004.webp',
   '{"size":800,"mimetype":"image/webp"}');
select is(pg_temp.publish_fixture(pg_temp.media_fixture())->>'committed','true','complete preparation commits');
select ok((select status='approved' and viewer_revision_id=thumbnail_revision_id
  and viewer_size_bytes=900 and source_sha256=repeat('b',64) and mime_type='image/jpeg'
  from public.gallery_submissions where id='11000000-0000-4000-8000-000000000003'),
  'one revision selects both derivatives without converting the private JPEG original');
select is((select count(*) from public.gallery_instagram_publish_jobs
  where submission_id='11000000-0000-4000-8000-000000000003' and status='queued'),1::bigint,
  'explicit JPEG opt-in queues exactly one compatible job');
select is(pg_temp.publish_fixture(pg_temp.media_fixture())->>'committed','true','same revision replay acknowledges success');
select ok((select count(*)=1 from public.gallery_moderation_events
  where submission_id='11000000-0000-4000-8000-000000000003')
  and (select count(*)=1 from public.gallery_instagram_publish_events
  where submission_id='11000000-0000-4000-8000-000000000003'),
  'same revision replay duplicates neither moderation nor publishing audit');
select is((select count(*) from public.gallery_publishable_submissions(80,0)
  where id='11000000-0000-4000-8000-000000000003'),1::bigint,'complete object closure enters the feed');
update storage.objects set metadata='{"size":901,"mimetype":"image/webp"}'
  where name='_approved/full/11000000-0000-4000-8000-000000000003/11000000-0000-4000-8000-000000000004.webp';
select is((select count(*) from public.gallery_publishable_submissions(80,0)
  where id='11000000-0000-4000-8000-000000000003'),0::bigint,'full object drift closes the feed');
update storage.objects set metadata='{"size":900,"mimetype":"image/webp"}'
  where name='_approved/full/11000000-0000-4000-8000-000000000003/11000000-0000-4000-8000-000000000004.webp';
update storage.objects set metadata=metadata||jsonb_build_object('eTag',repeat('d',32))
  where name='11000000-0000-4000-8000-000000000001/source.jpg';
select is((select count(*) from public.gallery_publishable_submissions(80,0)
  where id='11000000-0000-4000-8000-000000000003'),0::bigint,'source ETag drift closes the feed');
select lives_ok($$insert into public.gallery_submissions(id,user_id,storage_path,mime_type,size_bytes,title)
  values('11000000-0000-4000-8000-000000000005','11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001/maximum.png','image/png',52428800,'Maximum fixture')$$,
  'exact 50 MiB original is accepted');
select throws_ok($$insert into public.gallery_submissions(id,user_id,storage_path,mime_type,size_bytes,title)
  values('11000000-0000-4000-8000-000000000006','11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001/oversized.png','image/png',52428801,'Oversized fixture')$$,
  '23514','new row for relation "gallery_submissions" violates check constraint "gallery_submissions_size_bytes_check"',
  '50 MiB plus one byte is rejected');
select * from finish();
rollback;
