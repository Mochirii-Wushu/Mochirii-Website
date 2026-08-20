begin;
select plan(45);

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
  exists (select 1 from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and contype = 'c' and conname = 'gallery_submissions_thumbnail_complete_check'),
  'thumbnail metadata is all-or-none'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.gallery_submissions'::regclass and contype = 'c' and conname = 'gallery_submissions_approved_thumbnail_check'),
  'new approvals require a thumbnail'
);

select ok(
  not (select convalidated from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_approved_thumbnail_check'),
  'historical approved rows remain available for explicit thumbnail backfill'
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
    select 1 from pg_trigger
    where tgrelid = 'public.gallery_submissions'::regclass
      and tgname = 'enforce_gallery_original_immutability'
      and tgenabled <> 'D'
  ),
  'moderated original immutability trigger is enabled'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Members update own pending gallery originals'
  ),
  'members have a pending-original-only update policy'
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
  not has_function_privilege('anon', 'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_commit_moderation_checked(uuid,uuid,text,text,uuid,text,text,bigint,uuid,text)', 'execute'),
  'source-CAS moderation is service-role only and the unchecked RPC is revoked'
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

select is(
  (public.gallery_commit_moderation_checked(
    '22222222-2222-4222-8222-222222222221',
    '99999999-9999-4999-8999-999999999999',
    'approved', null,
    '33333333-3333-4333-8333-333333333331',
    '_approved/thumbs/22222222-2222-4222-8222-222222222221/33333333-3333-4333-8333-333333333331.webp',
    'image/webp', 70000, null, null
  ) ->> 'committed')::boolean,
  true,
  'approval and derivative selection commit together'
);

select ok(
  (select status = 'approved'
    and thumbnail_revision_id = '33333333-3333-4333-8333-333333333331'
    and thumbnail_size_bytes = 70000
    from public.gallery_submissions
    where id = '22222222-2222-4222-8222-222222222221'),
  'approval stores the selected immutable derivative metadata'
);

select is(
  (select count(*)::bigint from public.gallery_moderation_events
    where submission_id = '22222222-2222-4222-8222-222222222221'
      and action = 'approved'),
  1::bigint,
  'approval writes exactly one audit event'
);

select is(
  (select count(*)::bigint from public.gallery_publishable_submissions(80, 0)
    where id = '22222222-2222-4222-8222-222222222221'),
  1::bigint,
  'complete rows with matching original and derivative objects are publishable'
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
  'A moderated gallery original is immutable.',
  'moderated originals cannot be rebound in the database'
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
  'member sessions cannot overwrite an approved original'
);

select is(
  private.member_gallery_original_mutation_allowed(
    auth.uid(),
    'member-gallery',
    '11111111-1111-4111-8111-111111111111/original-one.webp',
    true
  ),
  false,
  'member sessions cannot delete an approved original'
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
  1::bigint,
  'member sessions may update their own pending original'
);

select ok(
  private.member_gallery_original_mutation_allowed(
    auth.uid(),
    'member-gallery',
    '11111111-1111-4111-8111-111111111111/pending.webp',
    true
  ),
  'member deletion policy is limited to owned pending or orphaned originals'
);

reset role;
set local "request.jwt.claim.role" = 'service_role';

select is(
  (public.gallery_commit_moderation_checked(
    '22222222-2222-4222-8222-222222222221',
    '99999999-9999-4999-8999-999999999999',
    'thumbnail', null,
    '44444444-4444-4444-8444-444444444441',
    '_approved/thumbs/22222222-2222-4222-8222-222222222221/44444444-4444-4444-8444-444444444441.webp',
    'image/webp', 71000,
    '33333333-3333-4333-8333-333333333331', null
  ) ->> 'committed')::boolean,
  true,
  'thumbnail refresh accepts the current compare-and-swap revision'
);

select is(
  public.gallery_commit_moderation_checked(
    '22222222-2222-4222-8222-222222222221',
    '99999999-9999-4999-8999-999999999999',
    'thumbnail', null,
    '55555555-5555-4555-8555-555555555551',
    '_approved/thumbs/22222222-2222-4222-8222-222222222221/55555555-5555-4555-8555-555555555551.webp',
    'image/webp', 72000,
    '33333333-3333-4333-8333-333333333331', null
  ) ->> 'reason',
  'stale_thumbnail_revision',
  'a losing concurrent refresh is rejected by compare-and-swap'
);

select is(
  (select thumbnail_revision_id from public.gallery_submissions
    where id = '22222222-2222-4222-8222-222222222221'),
  '44444444-4444-4444-8444-444444444441'::uuid,
  'a losing refresh cannot replace the winning revision'
);

select throws_ok(
  $$select public.gallery_commit_moderation_checked(
    '22222222-2222-4222-8222-222222222223',
    '99999999-9999-4999-8999-999999999999',
    'rejected', repeat('x', 501), null, null, null, null, null, null
  )$$,
  '23514',
  'new row for relation "gallery_moderation_events" violates check constraint "gallery_moderation_events_reason_length"',
  'audit constraint failure aborts the atomic moderation statement'
);

select is(
  (select status from public.gallery_submissions
    where id = '22222222-2222-4222-8222-222222222223'),
  'pending',
  'an audit failure rolls back the submission update'
);

select is(
  public.gallery_commit_moderation_checked(
    '22222222-2222-4222-8222-222222222224',
    '99999999-9999-4999-8999-999999999999',
    'approved', null,
    '33333333-3333-4333-8333-333333333334',
    '_approved/thumbs/22222222-2222-4222-8222-222222222224/33333333-3333-4333-8333-333333333334.webp',
    'image/webp', 74000, null, null
  ) ->> 'reason',
  'original_object_mismatch',
  'invalid original object metadata fails closed without a cast error'
);

select throws_ok(
  $$update public.gallery_submissions
    set status = 'approved'
    where id = '22222222-2222-4222-8222-222222222223'$$,
  '23514',
  'new row for relation "gallery_submissions" violates check constraint "gallery_submissions_approved_thumbnail_check"',
  'new approved rows cannot omit derivative metadata'
);

alter table public.gallery_submissions
  drop constraint gallery_submissions_approved_thumbnail_check;

insert into storage.objects (id, bucket_id, name, owner, metadata)
values (
  '10000000-0000-4000-8000-000000000005',
  'member-gallery',
  '11111111-1111-4111-8111-111111111111/historical.webp',
  '11111111-1111-4111-8111-111111111111',
  '{"size":1400,"mimetype":"image/webp"}'
);

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, status, reviewed_at
) values (
  '22222222-2222-4222-8222-222222222225',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111/historical.webp',
  'image/webp', 1400, 'Historical incomplete fixture', 'approved', now() + interval '1 day'
);

alter table public.gallery_submissions
  add constraint gallery_submissions_approved_thumbnail_check
  check (
    status <> 'approved'
    or (
      thumbnail_revision_id is not null
      and thumbnail_storage_path is not null
      and thumbnail_mime_type = 'image/webp'
      and thumbnail_size_bytes between 1 and 81920
    )
  ) not valid;

select is(
  (select count(*)::bigint from public.gallery_publishable_submissions(1, 0)),
  1::bigint,
  'incomplete historical rows are filtered before the public limit'
);

select is(
  (select id from public.gallery_publishable_submissions(1, 0)),
  '22222222-2222-4222-8222-222222222221'::uuid,
  'the bounded public result contains the complete row behind an incomplete newer row'
);

select * from finish();
rollback;
