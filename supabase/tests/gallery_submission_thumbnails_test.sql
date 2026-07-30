begin;
select plan(40);

select has_column('public', 'gallery_submissions', 'thumbnail_revision_id', 'thumbnail revision exists');
select has_column('public', 'gallery_submissions', 'thumbnail_storage_path', 'thumbnail storage path exists');
select has_column('public', 'gallery_submissions', 'thumbnail_mime_type', 'thumbnail MIME type exists');
select has_column('public', 'gallery_submissions', 'thumbnail_size_bytes', 'thumbnail byte size exists');

select col_type_is('public', 'gallery_submissions', 'thumbnail_revision_id', 'uuid', 'thumbnail revision uses uuid');
select col_type_is('public', 'gallery_submissions', 'thumbnail_storage_path', 'text', 'thumbnail path uses text');
select col_type_is('public', 'gallery_submissions', 'thumbnail_mime_type', 'text', 'thumbnail MIME uses text');
select col_type_is('public', 'gallery_submissions', 'thumbnail_size_bytes', 'bigint', 'thumbnail size uses bigint');

select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and contype = 'c' and conname = 'gallery_submissions_thumbnail_path_length'),
  'thumbnail path length is constrained'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and contype = 'c' and conname = 'gallery_submissions_thumbnail_service_path_check'),
  'thumbnail stays under its service-owned revision path'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and contype = 'c' and conname = 'gallery_submissions_thumbnail_mime_type_check'),
  'thumbnail MIME is constrained'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and contype = 'c' and conname = 'gallery_submissions_thumbnail_size_bytes_check'),
  'thumbnail bytes are bounded'
);
select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_thumbnail_complete_check'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_thumbnail_dimensions_check'
  ),
  'legacy row-level thumbnail completeness is replaced by bounded publication evidence'
);
select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_approved_thumbnail_check'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'private.gallery_publication_revisions'::regclass
      and conname = 'gallery_publication_thumbnail_sha256_check'
  ),
  'approvals use an immutable publication revision instead of mutable row completeness'
);

select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'private.gallery_publication_revisions'::regclass)
  and exists (
    select 1 from pg_trigger
    where tgrelid = 'private.gallery_publication_revisions'::regclass
      and tgname = 'enforce_gallery_publication_immutability'
      and tgenabled <> 'D'
  ),
  'publication revisions are private, RLS-protected, and immutable'
);

select ok(
  position('thumbnail_refreshed' in pg_get_constraintdef(
    (select oid from pg_constraint
      where conrelid = 'public.gallery_moderation_events'::regclass
        and conname = 'gallery_moderation_events_action_check')
  )) > 0,
  'moderation audit accepts thumbnail refresh events'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'gallery_submissions'
      and indexname = 'gallery_submissions_thumbnail_backfill_idx'
  ),
  'missing approved thumbnails have a deterministic backfill index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private'
      and tablename = 'gallery_publication_revisions'
      and indexname = 'gallery_publication_submission_fk_idx'
  ),
  'gallery_publication_submission_fk_idx covers the composite publication foreign key'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.gallery_submissions'::regclass
      and tgname = 'enforce_gallery_original_immutability'
      and tgenabled <> 'D'
  ),
  'moderated original immutability trigger is enabled'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Members update own pending gallery originals'
  ),
  'referenced originals have no member update policy'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Members delete own pending or orphaned gallery originals'
  ),
  'members have a pending-or-orphaned-original-only delete policy'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in ('Members update own gallery objects', 'Members delete own gallery objects')
  ),
  'superseded mutable-object policies are absent'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamp with time zone)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamp with time zone)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamp with time zone)',
    'execute'
  ),
  'atomic moderation is service-role only'
);

select ok(
  not has_function_privilege('anon', 'public.gallery_publishable_submissions(integer,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_publishable_submissions(integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_publishable_submissions(integer,integer)', 'execute'),
  'publishable feed selection is service-role only'
);

select ok(
  pg_get_constraintdef((select oid from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_thumbnail_service_path_check'))
    like '%_approved/thumbs/%thumbnail_revision_id%',
  'selected derivatives use immutable revision paths'
);

select ok(
  pg_get_constraintdef((select oid from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_thumbnail_size_bytes_check'))
    like '%81920%',
  'database thumbnail ceiling is 80 KiB'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'gallery-owner@example.invalid', '', now(), now(), now()),
  ('99999999-9999-4999-8999-999999999999', 'authenticated', 'authenticated', 'gallery-moderator@example.invalid', '', now(), now(), now());

update public.member_profiles
set member_status = 'active',
    has_required_discord_roles = true,
    discord_verified_at = now()
where id = '11111111-1111-4111-8111-111111111111';

insert into storage.objects (id, bucket_id, name, owner, metadata) values
  ('10000000-0000-4000-8000-000000000001', 'member-gallery', '11111111-1111-4111-8111-111111111111/original-one.webp', '11111111-1111-4111-8111-111111111111', '{"size":1000,"mimetype":"image/webp"}'),
  ('10000000-0000-4000-8000-000000000002', 'member-gallery', '11111111-1111-4111-8111-111111111111/pending.webp', '11111111-1111-4111-8111-111111111111', '{"size":1100,"mimetype":"image/webp"}'),
  ('10000000-0000-4000-8000-000000000003', 'member-gallery', '11111111-1111-4111-8111-111111111111/atomic.webp', '11111111-1111-4111-8111-111111111111', '{"size":1200,"mimetype":"image/webp"}'),
  ('10000000-0000-4000-8000-000000000004', 'member-gallery', '11111111-1111-4111-8111-111111111111/mismatch.webp', '11111111-1111-4111-8111-111111111111', '{"size":"invalid","mimetype":"image/webp"}'),
  ('30000000-0000-4000-8000-000000000001', 'member-gallery', '_approved/thumbs/22222222-2222-4222-8222-222222222221/33333333-3333-4333-8333-333333333331.webp', null, '{"size":70000,"mimetype":"image/webp"}'),
  ('30000000-0000-4000-8000-000000000002', 'member-gallery', '_approved/thumbs/22222222-2222-4222-8222-222222222221/44444444-4444-4444-8444-444444444441.webp', null, '{"size":71000,"mimetype":"image/webp"}'),
  ('30000000-0000-4000-8000-000000000003', 'member-gallery', '_approved/thumbs/22222222-2222-4222-8222-222222222221/55555555-5555-4555-8555-555555555551.webp', null, '{"size":72000,"mimetype":"image/webp"}'),
  ('30000000-0000-4000-8000-000000000004', 'member-gallery', '_approved/thumbs/22222222-2222-4222-8222-222222222223/33333333-3333-4333-8333-333333333333.webp', null, '{"size":73000,"mimetype":"image/webp"}');

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title
) values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/original-one.webp', 'image/webp', 1000, 'Approval fixture'),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/pending.webp', 'image/webp', 1100, 'Pending policy fixture'),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/atomic.webp', 'image/webp', 1200, 'Atomic failure fixture'),
  ('22222222-2222-4222-8222-222222222224', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/mismatch.webp', 'image/webp', 1300, 'Object mismatch fixture');

set local "request.jwt.claim.role" = 'service_role';

create temporary table gallery_source_validation_first_result (
  result jsonb not null
) on commit drop;

insert into gallery_source_validation_first_result (result)
select public.gallery_commit_source_validation(
  '22222222-2222-4222-8222-222222222221',
  (select updated_at from public.gallery_submissions
   where id = '22222222-2222-4222-8222-222222222221'),
  '10000000-0000-4000-8000-000000000001',
  (select version from storage.objects
   where id = '10000000-0000-4000-8000-000000000001'),
  (select updated_at from storage.objects
   where id = '10000000-0000-4000-8000-000000000001'),
  'image/webp',
  1000,
  100,
  10,
  repeat('a', 64)
);

select ok(
  coalesce((select (result ->> 'committed')::boolean
            from gallery_source_validation_first_result), false)
  and not coalesce((select (result ->> 'already_validated')::boolean
                    from gallery_source_validation_first_result), true)
  and (select result ->> 'validated_at'
       from gallery_source_validation_first_result) is not null
  and (
    public.gallery_commit_source_validation(
      '22222222-2222-4222-8222-222222222221',
      (select updated_at from public.gallery_submissions
       where id = '22222222-2222-4222-8222-222222222221'),
      '10000000-0000-4000-8000-000000000001',
      (select version from storage.objects
       where id = '10000000-0000-4000-8000-000000000001'),
      (select updated_at from storage.objects
       where id = '10000000-0000-4000-8000-000000000001'),
      'image/webp',
      1000,
      100,
      10,
      repeat('a', 64)
    ) ->> 'validated_at'
  ) = (
    select result ->> 'validated_at'
    from gallery_source_validation_first_result
  ),
  'repeat validation returns the exact durable evidence timestamp'
);

select is(
  jsonb_array_length(public.gallery_source_validation_states(array[
    '22222222-2222-4222-8222-222222222221'::uuid
  ])),
  1,
  'source validation state exposes the one durable server-verified record'
);

select is(
  (select count(*)::bigint from public.gallery_publishable_submissions(80, 0)
  ),
  0::bigint,
  'retired v1 feed compatibility cannot return media rows'
);

set local "request.jwt.claim.role" = 'authenticated';
select throws_ok(
  $$select public.gallery_publishable_submissions(1, 0)$$,
  '42501',
  'Service role required.',
  'non-service claims cannot use publishable feed selection'
);

set local "request.jwt.claim.role" = 'service_role';
select throws_ok(
  $$update public.gallery_submissions
    set storage_path = '11111111-1111-4111-8111-111111111111/replaced.webp'
    where id = '22222222-2222-4222-8222-222222222221'$$,
  '23514',
  'A referenced gallery original is immutable.',
  'referenced originals cannot be rebound in the database'
);

set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';
set local role authenticated;

with changed as (
  update storage.objects set metadata = '{"size":999,"mimetype":"image/webp"}'
  where bucket_id = 'member-gallery'
    and name = '11111111-1111-4111-8111-111111111111/original-one.webp'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'member sessions cannot overwrite a referenced original'
);

select is(
  private.member_gallery_original_mutation_allowed(
    auth.uid(),
    'member-gallery',
    '11111111-1111-4111-8111-111111111111/original-one.webp',
    true
  ),
  false,
  'member sessions cannot delete a referenced original'
);

select is(
  (select count(*)::bigint from storage.objects
    where bucket_id = 'member-gallery'
      and name like '_approved/thumbs/%'),
  0::bigint,
  'service-owned derivatives are not readable to member sessions'
);

with changed as (
  update storage.objects set metadata = '{"size":1100,"mimetype":"image/webp","tested":true}'
  where bucket_id = 'member-gallery'
    and name = '11111111-1111-4111-8111-111111111111/pending.webp'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'member sessions cannot overwrite a pending referenced original'
);

select is(
  private.member_gallery_original_mutation_allowed(
    auth.uid(),
    'member-gallery',
    '11111111-1111-4111-8111-111111111111/pending.webp',
    true
  ),
  false,
  'member deletion is limited to owned orphaned originals'
);

with changed as (
  update public.gallery_submissions
  set title = 'Updated pending title'
  where id = '22222222-2222-4222-8222-222222222222'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  1::bigint,
  'members may still update descriptive fields on their pending submission'
);

reset role;
set local "request.jwt.claim.role" = 'service_role';

select is(
  public.gallery_source_validation_candidate(
    '22222222-2222-4222-8222-222222222224'
  ) ->> 'reason',
  'source_object_mismatch',
  'invalid original object metadata fails closed without a cast error'
);

select ok(
  not has_table_privilege(
    'service_role', 'private.gallery_publication_revisions', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'private.gallery_publication_revisions', 'insert'
  ),
  'publication revisions are writable only through reviewed security-definer RPCs'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'private.gallery_publication_revisions'::regclass
      and tgname = 'enforce_gallery_publication_immutability'
      and tgenabled <> 'D'
  ),
  'immutable publication revision enforcement remains active'
);

select * from finish();
rollback;
