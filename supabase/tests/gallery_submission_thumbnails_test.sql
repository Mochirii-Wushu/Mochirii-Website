begin;
select plan(60);

select has_column('public', 'gallery_submissions', 'thumbnail_width', 'thumbnail width exists');
select has_column('public', 'gallery_submissions', 'thumbnail_height', 'thumbnail height exists');
select has_table('private', 'gallery_publication_revisions', 'publication revision ledger exists');
select has_table('private', 'gallery_source_validations', 'trusted source validation ledger exists');

select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and conname = 'gallery_submissions_thumbnail_dimensions_check'),
  'thumbnail dimensions remain bounded'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and conname = 'gallery_submissions_thumbnail_service_path_check'),
  'legacy and publication thumbnail paths are constrained'
);
select ok(
  not exists (select 1 from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and conname in ('gallery_submissions_thumbnail_complete_check', 'gallery_submissions_approved_thumbnail_check', 'gallery_submissions_public_category_check')),
  'strict historical closeout constraints stay deferred until reconciliation'
);
select ok(
  not (select convalidated from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and conname = 'gallery_submissions_thumbnail_service_path_check'),
  'legacy path transition remains not validated'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'private.gallery_publication_revisions'::regclass),
  'publication ledger has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'private.gallery_publication_revisions', 'select')
  and not has_table_privilege('authenticated', 'private.gallery_publication_revisions', 'select')
  and not has_table_privilege('service_role', 'private.gallery_publication_revisions', 'select'),
  'publication rows have no direct API grants'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.gallery_source_validations'::regclass)
  and not has_table_privilege('anon', 'private.gallery_source_validations', 'select')
  and not has_table_privilege('authenticated', 'private.gallery_source_validations', 'select')
  and not has_table_privilege('service_role', 'private.gallery_source_validations', 'select'),
  'source validation evidence has RLS and no direct API grants'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'private' and tablename = 'gallery_publication_revisions' and indexname = 'gallery_publication_one_active_per_submission_idx'),
  'one active publication per submission is indexed'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'private' and tablename = 'gallery_publication_revisions' and indexname = 'gallery_publication_submission_fk_idx'),
  'publication revision foreign-key columns are indexed'
);
select ok(
  exists (select 1 from pg_trigger where tgrelid = 'private.gallery_publication_revisions'::regclass and tgname = 'enforce_gallery_publication_immutability' and tgenabled <> 'D'),
  'publication immutability trigger is enabled'
);
select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.gallery_submissions'::regclass and tgname = 'retire_gallery_publication_on_status_change' and tgenabled <> 'D'),
  'status changes retire active publications'
);

select ok(
  not has_function_privilege('anon', 'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz)', 'execute'),
  'atomic publication commit is service-role only'
);
select ok(
  not has_function_privilege('anon', 'public.gallery_source_validation_candidate(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_source_validation_candidate(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_source_validation_candidate(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.gallery_commit_source_validation(uuid,timestamptz,uuid,text,timestamptz,text,bigint,integer,integer,text)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_commit_source_validation(uuid,timestamptz,uuid,text,timestamptz,text,bigint,integer,integer,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_source_validation_states(uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.gallery_source_validation_states(uuid[])', 'execute'),
  'source validation RPCs are service-role only'
);
select ok(
  to_regprocedure('public.gallery_publishable_submissions(integer,integer)') is null,
  'fixed-limit v1 feed function is retired'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'gallery-owner@example.invalid', '', now(), now(), now()),
  ('99999999-9999-4999-8999-999999999999', 'authenticated', 'authenticated', 'gallery-moderator@example.invalid', '', now(), now(), now());

update public.member_profiles
set member_status = 'active',
    has_required_discord_roles = true,
    discord_verified_at = now(),
    display_name = 'Gallery Member'
where id = '11111111-1111-4111-8111-111111111111';

insert into storage.objects (id, bucket_id, name, owner, metadata) values
  ('10000000-0000-4000-8000-000000000001', 'member-gallery', '11111111-1111-4111-8111-111111111111/original-one.webp', '11111111-1111-4111-8111-111111111111', '{"size":1000,"mimetype":"image/webp"}'),
  ('10000000-0000-4000-8000-000000000002', 'member-gallery', '11111111-1111-4111-8111-111111111111/pending.webp', '11111111-1111-4111-8111-111111111111', '{"size":1100,"mimetype":"image/webp"}'),
  ('10000000-0000-4000-8000-000000000003', 'member-gallery', '11111111-1111-4111-8111-111111111111/unclassified.webp', '11111111-1111-4111-8111-111111111111', '{"size":1200,"mimetype":"image/webp"}'),
  ('20000000-0000-4000-8000-000000000001', 'member-gallery', '_approved/publications/30000000-0000-4000-8000-000000000001/display.webp', null, '{"size":900000,"mimetype":"image/webp"}'),
  ('20000000-0000-4000-8000-000000000002', 'member-gallery', '_approved/publications/30000000-0000-4000-8000-000000000001/revisions/31000000-0000-4000-8000-000000000001/thumbnail.webp', null, '{"size":70000,"mimetype":"image/webp"}'),
  ('20000000-0000-4000-8000-000000000004', 'member-gallery', '_approved/publications/30000000-0000-4000-8000-000000000001/revisions/31000000-0000-4000-8000-000000000002/thumbnail.webp', null, '{"size":71000,"mimetype":"image/webp"}'),
  ('20000000-0000-4000-8000-000000000005', 'member-gallery', '_approved/publications/30000000-0000-4000-8000-000000000003/display.webp', null, '{"size":800000,"mimetype":"image/webp"}'),
  ('20000000-0000-4000-8000-000000000006', 'member-gallery', '_approved/publications/30000000-0000-4000-8000-000000000003/revisions/31000000-0000-4000-8000-000000000003/thumbnail.webp', null, '{"size":72000,"mimetype":"image/webp"}');

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, category,
  instagram_opt_in, instagram_opt_in_at, instagram_opt_in_source,
  instagram_opt_in_copy_version
) values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/original-one.webp', 'image/webp', 1000, 'Approval fixture', 'scenery', true, now(), 'website_upload', 'gallery-instagram-opt-in-v1'),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/pending.webp', 'image/webp', 1100, 'Pending fixture', 'action', false, null, null, null),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/unclassified.webp', 'image/webp', 1200, 'Unclassified fixture', null, false, null, null, null);

set local "request.jwt.claim.role" = 'service_role';

select is(
  (public.gallery_commit_moderation(
    '22222222-2222-4222-8222-222222222221',
    '99999999-9999-4999-8999-999999999999',
    'approved', null,
    '30000000-0000-4000-8000-000000000001',
    '_approved/publications/30000000-0000-4000-8000-000000000001/display.webp',
    'image/webp', 900000, 1920, 1080, repeat('c', 64),
    '31000000-0000-4000-8000-000000000001',
    '_approved/publications/30000000-0000-4000-8000-000000000001/revisions/31000000-0000-4000-8000-000000000001/thumbnail.webp',
    'image/webp', 70000, 640, 360, repeat('d', 64), null,
    '2000-01-01T00:00:00Z'::timestamptz
  ) ->> 'reason'),
  'stale_submission_revision',
  'a stale reviewed row snapshot cannot be published'
);
select is(
  (select count(*)::bigint from private.gallery_publication_revisions where submission_id = '22222222-2222-4222-8222-222222222221'),
  0::bigint,
  'a stale reviewed row snapshot creates no publication evidence'
);
select is(
  (select count(*)::bigint from public.gallery_instagram_publish_jobs where submission_id = '22222222-2222-4222-8222-222222222221'),
  0::bigint,
  'a failed approval creates no social publishing outbox record'
);

select throws_ok(
  $$update public.gallery_submissions set storage_path = '11111111-1111-4111-8111-111111111111/replaced.webp' where id = '22222222-2222-4222-8222-222222222222'$$,
  '23514',
  'A referenced gallery original is immutable.',
  'a pending submission cannot change its reviewed source identity'
);

select is(
  (public.gallery_source_validation_candidate('22222222-2222-4222-8222-222222222221') ->> 'ok')::boolean,
  true,
  'the trusted validator can resolve the exact review source candidate'
);
select is(
  (public.gallery_commit_source_validation(
    '22222222-2222-4222-8222-222222222221',
    (select updated_at from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222221'),
    '10000000-0000-4000-8000-000000000002',
    (select version from storage.objects where id = '10000000-0000-4000-8000-000000000002'),
    (select updated_at from storage.objects where id = '10000000-0000-4000-8000-000000000002'),
    'image/webp', 1000, 1920, 1080,
    repeat('a', 64)
  ) ->> 'reason'),
  'stale_source_object',
  'validation cannot bind a different Storage object'
);
select is(
  (public.gallery_commit_source_validation(
    '22222222-2222-4222-8222-222222222221',
    (select updated_at from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222221'),
    '10000000-0000-4000-8000-000000000001',
    (select version from storage.objects where id = '10000000-0000-4000-8000-000000000001'),
    (select updated_at from storage.objects where id = '10000000-0000-4000-8000-000000000001'),
    'image/webp', 1000, 1920, 1080,
    repeat('a', 64)
  ) ->> 'committed')::boolean,
  true,
  'trusted source dimensions and object identity commit once'
);
select is(
  (public.gallery_commit_source_validation(
    '22222222-2222-4222-8222-222222222221',
    (select updated_at from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222221'),
    '10000000-0000-4000-8000-000000000001',
    (select version from storage.objects where id = '10000000-0000-4000-8000-000000000001'),
    (select updated_at from storage.objects where id = '10000000-0000-4000-8000-000000000001'),
    'image/webp', 1000, 1920, 1080,
    repeat('b', 64)
  ) ->> 'reason'),
  'source_validation_conflict',
  'trusted source evidence cannot be rewritten after validation'
);
select is(
  jsonb_array_length(public.gallery_source_validation_states(array['22222222-2222-4222-8222-222222222221'::uuid])),
  1,
  'only a current object-bound source validation resolves for preview signing'
);

select is(
  (public.gallery_commit_moderation(
    '22222222-2222-4222-8222-222222222222',
    '99999999-9999-4999-8999-999999999999',
    'approved', null,
    '30000000-0000-4000-8000-000000000002',
    '_approved/publications/30000000-0000-4000-8000-000000000002/display.webp',
    'image/webp', 900000, 1920, 1080, repeat('c', 64),
    '31000000-0000-4000-8000-000000000004',
    '_approved/publications/30000000-0000-4000-8000-000000000002/revisions/31000000-0000-4000-8000-000000000004/thumbnail.webp',
    'image/webp', 70000, 640, 360, repeat('d', 64), null,
    (select updated_at from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222222')
  ) ->> 'reason'),
  'source_not_validated',
  'an unvalidated source can never enter the publication transaction'
);

select is(
  (public.gallery_commit_moderation(
    '22222222-2222-4222-8222-222222222221',
    '99999999-9999-4999-8999-999999999999',
    'approved', null,
    '30000000-0000-4000-8000-000000000001',
    '_approved/publications/30000000-0000-4000-8000-000000000001/display.webp',
    'image/webp', 900000, 1920, 1080, repeat('c', 64),
    '31000000-0000-4000-8000-000000000001',
    '_approved/publications/30000000-0000-4000-8000-000000000001/revisions/31000000-0000-4000-8000-000000000001/thumbnail.webp',
    'image/webp', 70000, 640, 360, repeat('d', 64), null,
    (select updated_at from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222221')
  ) ->> 'committed')::boolean,
  true,
  'approval and first public revision commit atomically'
);
select is(
  (select status from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222221'),
  'approved',
  'approval updates the moderation source row'
);
select is(
  (select count(*)::bigint from private.gallery_publication_revisions where submission_id = '22222222-2222-4222-8222-222222222221' and visible_until is null),
  1::bigint,
  'approval creates exactly one active public revision'
);
select ok(
  (select original_width = 1920 and original_height = 1080 and thumbnail_width = 640 and thumbnail_height = 360 from private.gallery_publication_revisions where id = '31000000-0000-4000-8000-000000000001'),
  'decoded display and thumbnail geometry is frozen'
);
select ok(
  (
    select original_storage_object_id = '20000000-0000-4000-8000-000000000001'::uuid
      and thumbnail_storage_object_id = '20000000-0000-4000-8000-000000000002'::uuid
      and original_sha256 = repeat('c', 64)
      and thumbnail_sha256 = repeat('d', 64)
    from private.gallery_publication_revisions
    where id = '31000000-0000-4000-8000-000000000001'
  ),
  'publication evidence freezes exact Storage object identities and content hashes'
);
select is(
  (select public_category from private.gallery_publication_revisions where id = '31000000-0000-4000-8000-000000000001'),
  'scenery',
  'canonical category is frozen in the publication'
);
select is(
  (select uploader_display_name from private.gallery_publication_revisions where id = '31000000-0000-4000-8000-000000000001'),
  'Gallery Member',
  'public display identity is frozen'
);
select is(
  (select count(*)::bigint from public.gallery_moderation_events where submission_id = '22222222-2222-4222-8222-222222222221' and action = 'approved'),
  1::bigint,
  'approval records one moderation event'
);
select is(
  (select count(*)::bigint from public.gallery_instagram_publish_jobs where submission_id = '22222222-2222-4222-8222-222222222221'),
  1::bigint,
  'opted-in approval atomically creates one social publishing outbox job'
);
select is(
  (select status from public.gallery_instagram_publish_jobs where submission_id = '22222222-2222-4222-8222-222222222221'),
  'ineligible',
  'unsupported source media is recorded as ineligible without an external publish attempt'
);
select is(
  (
    select count(*)::bigint
    from public.gallery_instagram_publish_events as event
    join public.gallery_instagram_publish_jobs as job on job.id = event.job_id
    where job.submission_id = '22222222-2222-4222-8222-222222222221'
      and event.action = 'ineligible'
  ),
  1::bigint,
  'outbox job and its audit event commit with the approval transaction'
);

select throws_ok(
  $$update private.gallery_publication_revisions set title = 'Changed' where id = '31000000-0000-4000-8000-000000000001'$$,
  '23514',
  'Gallery publication revisions are immutable.',
  'frozen publication fields cannot change'
);
select throws_ok(
  $$delete from private.gallery_publication_revisions where id = '31000000-0000-4000-8000-000000000001'$$,
  '23514',
  'Gallery publication revisions cannot be deleted.',
  'publication evidence cannot be deleted'
);

select is(
  (public.gallery_commit_moderation(
    '22222222-2222-4222-8222-222222222221',
    '99999999-9999-4999-8999-999999999999',
    'thumbnail', null,
    '30000000-0000-4000-8000-000000000001',
    null, null, null, null, null, null,
    '31000000-0000-4000-8000-000000000002',
    '_approved/publications/30000000-0000-4000-8000-000000000001/revisions/31000000-0000-4000-8000-000000000002/thumbnail.webp',
    'image/webp', 71000, 640, 360, repeat('e', 64),
    '31000000-0000-4000-8000-000000000001',
    (select updated_at from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222221')
  ) ->> 'committed')::boolean,
  true,
  'refresh atomically publishes a new immutable revision'
);
select is(
  (select count(*)::bigint from private.gallery_publication_revisions where submission_id = '22222222-2222-4222-8222-222222222221'),
  2::bigint,
  'refresh retains the prior revision for snapshot continuity'
);
select ok(
  (select visible_until is not null from private.gallery_publication_revisions where id = '31000000-0000-4000-8000-000000000001')
  and (select visible_until is null from private.gallery_publication_revisions where id = '31000000-0000-4000-8000-000000000002'),
  'refresh retires only the prior revision'
);
select is(
  (select count(distinct original_storage_path)::bigint from private.gallery_publication_revisions where submission_id = '22222222-2222-4222-8222-222222222221'),
  1::bigint,
  'thumbnail refresh reuses the immutable display derivative'
);
select ok(
  (
    select count(distinct original_storage_object_id) = 1
      and count(distinct original_sha256) = 1
      and max(thumbnail_sha256) filter (where id = '31000000-0000-4000-8000-000000000002') = repeat('e', 64)
    from private.gallery_publication_revisions
    where submission_id = '22222222-2222-4222-8222-222222222221'
  ),
  'thumbnail refresh retains the display object binding and records the new derivative hash'
);
select is(
  (select gallery_publication_id from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222221'),
  '30000000-0000-4000-8000-000000000001'::uuid,
  'the source row retains one opaque publication identity across revisions'
);
select is(
  (public.gallery_commit_moderation(
    '22222222-2222-4222-8222-222222222221',
    '99999999-9999-4999-8999-999999999999',
    'thumbnail', null,
    '30000000-0000-4000-8000-000000000001',
    null, null, null, null, null, null,
    '31000000-0000-4000-8000-000000000003',
    '_approved/publications/30000000-0000-4000-8000-000000000001/revisions/31000000-0000-4000-8000-000000000003/thumbnail.webp',
    'image/webp', 72000, 640, 360, repeat('f', 64),
    '31000000-0000-4000-8000-000000000001',
    (select updated_at from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222221')
  ) ->> 'reason'),
  'stale_thumbnail_revision',
  'losing compare-and-swap refresh is rejected'
);
select is(
  (select count(*)::bigint from private.gallery_publication_revisions where id = '31000000-0000-4000-8000-000000000003'),
  0::bigint,
  'stale refresh cannot create a publication row'
);

select is(
  (public.gallery_commit_moderation(
    '22222222-2222-4222-8222-222222222223',
    '99999999-9999-4999-8999-999999999999',
    'approved', null,
    '30000000-0000-4000-8000-000000000003',
    '_approved/publications/30000000-0000-4000-8000-000000000003/display.webp',
    'image/webp', 800000, 1440, 810, repeat('c', 64),
    '31000000-0000-4000-8000-000000000003',
    '_approved/publications/30000000-0000-4000-8000-000000000003/revisions/31000000-0000-4000-8000-000000000003/thumbnail.webp',
    'image/webp', 72000, 640, 360, repeat('f', 64), null,
    (select updated_at from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222223')
  ) ->> 'reason'),
  'category_unclassified',
  'unclassified submissions fail closed before publication'
);
select is(
  (select status from public.gallery_submissions where id = '22222222-2222-4222-8222-222222222223'),
  'pending',
  'failed publication leaves moderation state unchanged'
);

update public.gallery_submissions
set status = 'archived'
where id = '22222222-2222-4222-8222-222222222221';

select ok(
  (select visible_until is not null from private.gallery_publication_revisions where id = '31000000-0000-4000-8000-000000000002'),
  'archiving immediately retires the active publication'
);
select is(
  public.gallery_public_original_v2('30000000-0000-4000-8000-000000000001'),
  null::jsonb,
  'archiving immediately blocks display resolution'
);

insert into storage.objects (id, bucket_id, name, owner, metadata) values
  ('10000000-0000-4000-8000-000000000004', 'member-gallery', '11111111-1111-4111-8111-111111111111/legacy-null.webp', '11111111-1111-4111-8111-111111111111', '{"size":1300,"mimetype":"image/webp"}'),
  ('10000000-0000-4000-8000-000000000005', 'member-gallery', '11111111-1111-4111-8111-111111111111/legacy-four.webp', '11111111-1111-4111-8111-111111111111', '{"size":1400,"mimetype":"image/webp"}'),
  ('20000000-0000-4000-8000-000000000007', 'member-gallery', '_approved/thumbs/22222222-2222-4222-8222-222222222225/40000000-0000-4000-8000-000000000001.webp', null, '{"size":70000,"mimetype":"image/webp"}');

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, status, reviewed_at
) values (
  '22222222-2222-4222-8222-222222222224',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111/legacy-null.webp',
  'image/webp', 1300, 'Legacy null shape', 'approved', now()
);

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, status, reviewed_at,
  thumbnail_revision_id, thumbnail_storage_path, thumbnail_mime_type, thumbnail_size_bytes
) values (
  '22222222-2222-4222-8222-222222222225',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111/legacy-four.webp',
  'image/webp', 1400, 'Legacy four-field shape', 'approved', now(),
  '40000000-0000-4000-8000-000000000001',
  '_approved/thumbs/22222222-2222-4222-8222-222222222225/40000000-0000-4000-8000-000000000001.webp',
  'image/webp', 70000
);

update public.gallery_submissions set category = 'portraits'
where id in (
  '22222222-2222-4222-8222-222222222224',
  '22222222-2222-4222-8222-222222222225'
);

select is(
  (select count(*)::bigint from public.gallery_submissions where id in ('22222222-2222-4222-8222-222222222224', '22222222-2222-4222-8222-222222222225') and category = 'portraits'),
  2::bigint,
  'fully-null and four-field legacy rows can be classified without constraint deadlock'
);
select is(
  (select count(*)::bigint from private.gallery_publication_revisions where submission_id in ('22222222-2222-4222-8222-222222222224', '22222222-2222-4222-8222-222222222225')),
  0::bigint,
  'legacy rows remain private until explicitly republished'
);

select throws_ok(
  $$update public.gallery_submissions
    set thumbnail_revision_id = '40000000-0000-4000-8000-000000000002',
        thumbnail_storage_path = '_approved/not-a-valid-publication-path.webp'
    where id = '22222222-2222-4222-8222-222222222224'$$,
  '23514',
  'new row for relation "gallery_submissions" violates check constraint "gallery_submissions_thumbnail_service_path_check"',
  'a null publication id cannot bypass the thumbnail path constraint'
);

insert into storage.objects (id, bucket_id, name, owner, metadata) values
  ('10000000-0000-4000-8000-000000000006', 'member-gallery', '11111111-1111-4111-8111-111111111111/orphan.webp', '11111111-1111-4111-8111-111111111111', '{"size":900,"mimetype":"image/webp"}');

set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';
set local role authenticated;
with changed as (
  update storage.objects
  set metadata = metadata || '{"attempted":true}'::jsonb
  where id = '10000000-0000-4000-8000-000000000002'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'members cannot replace or mutate a referenced pending source object'
);
select is(
  private.member_gallery_original_mutation_allowed(
    '11111111-1111-4111-8111-111111111111',
    'member-gallery',
    '11111111-1111-4111-8111-111111111111/pending.webp',
    true
  ),
  false,
  'members cannot delete a referenced pending source object'
);
select is(
  private.member_gallery_original_mutation_allowed(
    '11111111-1111-4111-8111-111111111111',
    'member-gallery',
    '11111111-1111-4111-8111-111111111111/orphan.webp',
    true
  ),
  true,
  'members may remove only their own unreferenced source object'
);
select is(
  (select count(*)::bigint from storage.objects where bucket_id = 'member-gallery' and name like '_approved/publications/%'),
  0::bigint,
  'member sessions cannot read service-owned publication objects'
);
reset role;

select * from finish();
rollback;
