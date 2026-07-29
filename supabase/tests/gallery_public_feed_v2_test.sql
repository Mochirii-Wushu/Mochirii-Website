begin;
select plan(68);

select has_table(
  'private',
  'gallery_publication_revisions',
  'immutable Gallery publication revisions exist'
);

select has_table(
  'private',
  'gallery_public_delivery_windows',
  'global Gallery public-delivery usage ledger exists'
);

select has_table(
  'private',
  'gallery_moderation_preview_windows',
  'isolated Gallery moderator-preview usage ledger exists'
);

select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.gallery_publication_revisions'::regclass
  ),
  true,
  'publication revisions have row-level security enabled'
);

select ok(
  not has_table_privilege('anon', 'private.gallery_publication_revisions', 'SELECT')
  and not has_table_privilege('authenticated', 'private.gallery_publication_revisions', 'SELECT')
  and not has_table_privilege('service_role', 'private.gallery_publication_revisions', 'SELECT')
  and not has_table_privilege('service_role', 'private.gallery_publication_revisions', 'INSERT')
  and not has_table_privilege('service_role', 'private.gallery_publication_revisions', 'UPDATE')
  and not has_table_privilege('service_role', 'private.gallery_publication_revisions', 'DELETE'),
  'publication revisions have no direct client or service-role table grants'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.gallery_public_delivery_windows'::regclass
  )
  and not has_table_privilege('anon', 'private.gallery_public_delivery_windows', 'SELECT')
  and not has_table_privilege('authenticated', 'private.gallery_public_delivery_windows', 'SELECT')
  and not has_table_privilege('service_role', 'private.gallery_public_delivery_windows', 'SELECT'),
  'delivery usage rows have RLS and no direct API grants'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.gallery_moderation_preview_windows'::regclass
  )
  and not has_table_privilege('anon', 'private.gallery_moderation_preview_windows', 'SELECT')
  and not has_table_privilege('authenticated', 'private.gallery_moderation_preview_windows', 'SELECT')
  and not has_table_privilege('service_role', 'private.gallery_moderation_preview_windows', 'SELECT'),
  'moderator-preview usage rows have RLS and no direct API grants'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.gallery_public_feed_page_v2(integer,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.gallery_public_feed_page_v2(integer,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.gallery_public_feed_page_v2(integer,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,text,text,text)',
    'execute'
  ),
  'public feed page is callable only through the service role'
);

select ok(
  not has_function_privilege('anon', 'public.gallery_reserve_public_media_v2(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_reserve_public_media_v2(uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_reserve_public_media_v2(uuid,text)', 'execute'),
  'atomic one-publication media reservation is callable only through the service role'
);

select ok(
  not has_function_privilege('anon', 'public.gallery_reserve_public_delivery(text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_reserve_public_delivery(text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_reserve_public_delivery(text,bigint)', 'execute'),
  'global delivery reservations are service-role only'
);

select ok(
  not has_function_privilege('anon', 'public.gallery_reserve_moderation_preview(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_reserve_moderation_preview(bigint)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_reserve_moderation_preview(bigint)', 'execute'),
  'isolated moderator-preview reservations are service-role only'
);

select ok(
  not has_function_privilege('anon', 'public.gallery_publishable_submissions(integer,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_publishable_submissions(integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_publishable_submissions(integer,integer)', 'execute'),
  'legacy rollback compatibility is callable only through the service role'
);

select ok(
  to_regprocedure(
    'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamp with time zone)'
  ) is not null,
  'atomic moderation requires complete display and thumbnail evidence'
);

select ok(
  to_regprocedure(
    'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,uuid)'
  ) is null,
  'the thumbnail-only moderation signature is removed'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'gallery_publication_revisions'
      and indexname = 'gallery_publication_one_active_per_submission_idx'
  ),
  'only one active publication revision is allowed per submission'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'gallery_publication_revisions'
      and indexname = 'gallery_publication_newest_idx'
  ),
  'immutable revisions have a newest-first keyset index'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.gallery_publication_revisions'::regclass
      and tgname = 'enforce_gallery_publication_immutability'
      and not tgisinternal
  ),
  'publication immutability is enforced by a trigger'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.gallery_submissions'::regclass
      and tgname = 'retire_gallery_publication_on_status_change'
      and not tgisinternal
  ),
  'leaving approved status retires the active public revision'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'authenticated',
  'authenticated',
  'gallery-feed-owner@example.invalid',
  '',
  now(),
  now(),
  now()
);

update public.member_profiles
set display_name = 'Mōchī Member',
    discord_global_name = 'Mōchī Member',
    member_status = 'active',
    has_required_discord_roles = true,
    discord_verified_at = now()
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

with fixtures as (
  select
    series,
    ('00000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as submission_id,
    ('10000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as publication_id,
    ('50000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as revision_id,
    ('20000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as source_object_id,
    ('30000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as display_object_id,
    ('40000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as thumbnail_object_id,
    case
      when series % 5 = 0 then 'gatherings'
      when series % 5 = 1 then 'portraits'
      when series % 5 = 2 then 'action'
      when series % 5 = 3 then 'scenery'
      else 'companions'
    end as category,
    case
      when series in (66, 67) then timestamptz '2026-07-01 01:07:00+00'
      else timestamptz '2026-07-01 00:00:00+00' + (series || ' minutes')::interval
    end as item_time
  from generate_series(1, 90) as series
)
insert into storage.objects (id, bucket_id, name, owner, metadata)
select
  source_object_id,
  'member-gallery',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/feed-' || series || '.webp',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '{"size":1000,"mimetype":"image/webp"}'::jsonb
from fixtures
union all
select
  display_object_id,
  'member-gallery',
  '_approved/publications/' || publication_id || '/display.webp',
  null::uuid,
  '{"size":1000,"mimetype":"image/webp"}'::jsonb
from fixtures
union all
select
  thumbnail_object_id,
  'member-gallery',
  '_approved/publications/' || publication_id || '/revisions/' || revision_id || '/thumbnail.webp',
  null::uuid,
  '{"size":100,"mimetype":"image/webp"}'::jsonb
from fixtures;

with fixtures as (
  select
    series,
    ('00000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as submission_id,
    ('10000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as publication_id,
    ('50000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as revision_id,
    ('30000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as display_object_id,
    ('40000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as thumbnail_object_id,
    case
      when series % 5 = 0 then 'gatherings'
      when series % 5 = 1 then 'portraits'
      when series % 5 = 2 then 'action'
      when series % 5 = 3 then 'scenery'
      else 'companions'
    end as category,
    case
      when series in (66, 67) then timestamptz '2026-07-01 01:07:00+00'
      else timestamptz '2026-07-01 00:00:00+00' + (series || ' minutes')::interval
    end as item_time
  from generate_series(1, 90) as series
)
insert into public.gallery_submissions (
  id,
  user_id,
  storage_bucket,
  storage_path,
  mime_type,
  size_bytes,
  title,
  caption,
  category,
  status,
  reviewed_by,
  reviewed_at,
  created_at,
  gallery_publication_id,
  thumbnail_revision_id,
  thumbnail_storage_path,
  thumbnail_mime_type,
  thumbnail_size_bytes,
  thumbnail_width,
  thumbnail_height
)
select
  submission_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'member-gallery',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/feed-' || series || '.webp',
  'image/webp',
  1000,
  case when series = 88 then 'Unicode Mōchī moment' else 'Gallery item ' || series end,
  'Approved guild image ' || series,
  category,
  'approved',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  item_time,
  item_time,
  publication_id,
  revision_id,
  '_approved/publications/' || publication_id || '/revisions/' || revision_id || '/thumbnail.webp',
  'image/webp',
  100,
  640,
  400
from fixtures;

with fixtures as (
  select
    series,
    ('00000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as submission_id,
    ('10000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as publication_id,
    ('50000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as revision_id,
    ('30000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as display_object_id,
    ('40000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as thumbnail_object_id,
    case
      when series % 5 = 0 then 'gatherings'
      when series % 5 = 1 then 'portraits'
      when series % 5 = 2 then 'action'
      when series % 5 = 3 then 'scenery'
      else 'companions'
    end as category,
    case
      when series in (66, 67) then timestamptz '2026-07-01 01:07:00+00'
      else timestamptz '2026-07-01 00:00:00+00' + (series || ' minutes')::interval
    end as item_time
  from generate_series(1, 90) as series
)
insert into private.gallery_publication_revisions (
  id,
  publication_id,
  submission_id,
  visible_from,
  title,
  caption,
  public_category,
  uploader_display_name,
  source_created_at,
  source_reviewed_at,
  storage_bucket,
  original_storage_path,
  original_mime_type,
  original_size_bytes,
  original_width,
  original_height,
  original_storage_object_id,
  original_storage_object_version,
  original_storage_object_updated_at,
  original_sha256,
  thumbnail_storage_path,
  thumbnail_mime_type,
  thumbnail_size_bytes,
  thumbnail_width,
  thumbnail_height,
  thumbnail_storage_object_id,
  thumbnail_storage_object_version,
  thumbnail_storage_object_updated_at,
  thumbnail_sha256
)
select
  revision_id,
  publication_id,
  submission_id,
  timestamptz '2026-07-01 00:00:00+00',
  case when series = 88 then 'Unicode Mōchī moment' else 'Gallery item ' || series end,
  'Approved guild image ' || series,
  category,
  'Mōchī Member',
  item_time,
  item_time,
  'member-gallery',
  '_approved/publications/' || publication_id || '/display.webp',
  'image/webp',
  1000,
  1200,
  800,
  display_object_id,
  (select object.version from storage.objects as object where object.id = display_object_id),
  (select object.updated_at from storage.objects as object where object.id = display_object_id),
  repeat('a', 64),
  '_approved/publications/' || publication_id || '/revisions/' || revision_id || '/thumbnail.webp',
  'image/webp',
  100,
  640,
  400,
  thumbnail_object_id,
  (select object.version from storage.objects as object where object.id = thumbnail_object_id),
  (select object.updated_at from storage.objects as object where object.id = thumbnail_object_id),
  repeat('b', 64)
from fixtures;

-- A structurally valid revision with mismatched object metadata must never be
-- listed or resolved.
insert into storage.objects (id, bucket_id, name, owner, metadata)
values
  (
    '20000000-0000-4000-8000-000000000092',
    'member-gallery',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/feed-92.webp',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '{"size":1000,"mimetype":"image/webp"}'::jsonb
  ),
  (
    '30000000-0000-4000-8000-000000000092',
    'member-gallery',
    '_approved/publications/10000000-0000-4000-8000-000000000092/display.webp',
    null::uuid,
    '{"size":999,"mimetype":"image/webp"}'::jsonb
  ),
  (
    '40000000-0000-4000-8000-000000000092',
    'member-gallery',
    '_approved/publications/10000000-0000-4000-8000-000000000092/revisions/50000000-0000-4000-8000-000000000092/thumbnail.webp',
    null::uuid,
    '{"size":100,"mimetype":"image/webp"}'::jsonb
  );

insert into public.gallery_submissions (
  id,
  user_id,
  storage_bucket,
  storage_path,
  mime_type,
  size_bytes,
  title,
  caption,
  category,
  status,
  reviewed_by,
  reviewed_at,
  created_at,
  gallery_publication_id,
  thumbnail_revision_id,
  thumbnail_storage_path,
  thumbnail_mime_type,
  thumbnail_size_bytes,
  thumbnail_width,
  thumbnail_height
) values (
  '00000000-0000-4000-8000-000000000092',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'member-gallery',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/feed-92.webp',
  'image/webp',
  1000,
  'Mismatched display metadata',
  'This item must fail closed.',
  'action',
  'approved',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '2026-07-01 03:02:00+00',
  '2026-07-01 03:02:00+00',
  '10000000-0000-4000-8000-000000000092',
  '50000000-0000-4000-8000-000000000092',
  '_approved/publications/10000000-0000-4000-8000-000000000092/revisions/50000000-0000-4000-8000-000000000092/thumbnail.webp',
  'image/webp',
  100,
  640,
  400
);

insert into private.gallery_publication_revisions (
  id,
  publication_id,
  submission_id,
  visible_from,
  title,
  caption,
  public_category,
  uploader_display_name,
  source_created_at,
  source_reviewed_at,
  storage_bucket,
  original_storage_path,
  original_mime_type,
  original_size_bytes,
  original_width,
  original_height,
  original_storage_object_id,
  original_storage_object_version,
  original_storage_object_updated_at,
  original_sha256,
  thumbnail_storage_path,
  thumbnail_mime_type,
  thumbnail_size_bytes,
  thumbnail_width,
  thumbnail_height,
  thumbnail_storage_object_id,
  thumbnail_storage_object_version,
  thumbnail_storage_object_updated_at,
  thumbnail_sha256
) values (
  '50000000-0000-4000-8000-000000000092',
  '10000000-0000-4000-8000-000000000092',
  '00000000-0000-4000-8000-000000000092',
  timestamptz '2026-07-01 00:00:00+00',
  'Mismatched display metadata',
  'This item must fail closed.',
  'action',
  'Mōchī Member',
  '2026-07-01 03:02:00+00',
  '2026-07-01 03:02:00+00',
  'member-gallery',
  '_approved/publications/10000000-0000-4000-8000-000000000092/display.webp',
  'image/webp',
  1000,
  1200,
  800,
  '30000000-0000-4000-8000-000000000092',
  (select version from storage.objects where id = '30000000-0000-4000-8000-000000000092'),
  (select updated_at from storage.objects where id = '30000000-0000-4000-8000-000000000092'),
  repeat('a', 64),
  '_approved/publications/10000000-0000-4000-8000-000000000092/revisions/50000000-0000-4000-8000-000000000092/thumbnail.webp',
  'image/webp',
  100,
  640,
  400,
  '40000000-0000-4000-8000-000000000092',
  (select version from storage.objects where id = '40000000-0000-4000-8000-000000000092'),
  (select updated_at from storage.objects where id = '40000000-0000-4000-8000-000000000092'),
  repeat('b', 64)
);

set local "request.jwt.claim.role" = 'service_role';

create temporary table gallery_v1_compatibility on commit drop as
select * from public.gallery_publishable_submissions(80, 0);

select is(
  (select count(*)::integer from gallery_v1_compatibility),
  0,
  'retired Edge compatibility always returns an empty Gallery feed'
);

select is(
  (select sum(reserved_bytes)::bigint from private.gallery_public_delivery_windows),
  65536::bigint,
  'retired Edge compatibility calls remain list-budgeted even though no media is returned'
);

create temporary table gallery_v1_compatibility_repeat on commit drop as
select * from public.gallery_publishable_submissions(80, 0);

select is(
  (select count(*)::integer from gallery_v1_compatibility_repeat),
  0,
  'repeated retired Edge compatibility calls cannot recover media paths'
);

select is(
  (select sum(reserved_bytes)::bigint from private.gallery_public_delivery_windows),
  131072::bigint,
  'each repeated retired Edge compatibility call consumes the shared list budget'
);

select throws_ok(
  $$select public.gallery_reserve_public_delivery('unknown', 1)$$,
  '22023',
  'Invalid Gallery delivery reservation.',
  'unknown delivery kinds fail closed'
);

select throws_ok(
  $$select public.gallery_reserve_public_delivery('thumbnail', 0)$$,
  '22023',
  'Invalid Gallery delivery reservation.',
  'non-positive delivery byte reservations fail closed'
);

delete from private.gallery_moderation_preview_windows;
create temporary table gallery_moderation_preview_reservation (payload jsonb) on commit drop;
insert into gallery_moderation_preview_reservation
values (public.gallery_reserve_moderation_preview(8388608));

select ok(
  (select (payload ->> 'allowed')::boolean from gallery_moderation_preview_reservation)
  and (
    select reserved_bytes = 8388608 and request_count = 1
    from private.gallery_moderation_preview_windows
    where window_started_at = date_trunc('minute', statement_timestamp())
  ),
  'moderation preview reserves its exact maximum source bytes once'
);

select throws_ok(
  $$select public.gallery_reserve_moderation_preview(8388609)$$,
  '22023',
  'Invalid Gallery moderation preview reservation.',
  'moderation preview rejects sources over eight mebibytes'
);

delete from private.gallery_moderation_preview_windows;
insert into private.gallery_moderation_preview_windows (
  window_started_at, request_count, reserved_bytes
) values (
  date_trunc('minute', statement_timestamp()), 12, 12
);

select ok(
  (public.gallery_reserve_moderation_preview(1) ->> 'allowed')::boolean is false
  and (public.gallery_reserve_moderation_preview(1) ->> 'retryAfterSeconds')::bigint between 1 and 60,
  'moderation preview minute saturation fails closed at twelve requests'
);

delete from private.gallery_moderation_preview_windows;
insert into private.gallery_moderation_preview_windows (
  window_started_at, request_count, reserved_bytes
) values (
  date_trunc('day', statement_timestamp(), 'UTC'), 100, 100
);

select ok(
  (public.gallery_reserve_moderation_preview(1) ->> 'allowed')::boolean is false,
  'moderation preview daily saturation fails closed at one hundred requests'
);

delete from private.gallery_moderation_preview_windows;
delete from private.gallery_public_delivery_windows;
insert into private.gallery_public_delivery_windows (
  window_started_at, delivery_kind, request_count, reserved_bytes
) values (
  date_trunc('minute', statement_timestamp()), 'list', 1, 67108864
);
truncate gallery_moderation_preview_reservation;
insert into gallery_moderation_preview_reservation
values (public.gallery_reserve_moderation_preview(8388608));

select ok(
  (select (payload ->> 'allowed')::boolean from gallery_moderation_preview_reservation)
  and (select sum(reserved_bytes)::bigint from private.gallery_moderation_preview_windows) = 8388608,
  'anonymous public saturation cannot consume isolated moderator-preview capacity'
);

delete from private.gallery_public_delivery_windows;
delete from private.gallery_moderation_preview_windows;
insert into private.gallery_moderation_preview_windows (
  window_started_at, request_count, reserved_bytes
) values (
  date_trunc('minute', statement_timestamp()), 8, 67108864
);
create temporary table gallery_isolated_public_reservation (payload jsonb) on commit drop;
insert into gallery_isolated_public_reservation
values (public.gallery_reserve_public_delivery('list', 1));

select ok(
  (select (payload ->> 'allowed')::boolean from gallery_isolated_public_reservation)
  and (select sum(reserved_bytes)::bigint from private.gallery_public_delivery_windows) = 1,
  'moderator-preview saturation cannot consume anonymous public capacity'
);

delete from private.gallery_public_delivery_windows;
insert into private.gallery_public_delivery_windows (
  window_started_at, delivery_kind, request_count, reserved_bytes
) values (
  date_trunc('minute', statement_timestamp()), 'list', 120, 120
);

select ok(
  (public.gallery_reserve_public_delivery('list', 1) ->> 'allowed')::boolean is false
  and (public.gallery_reserve_public_delivery('list', 1) ->> 'retryAfterSeconds')::bigint between 1 and 60,
  'minute saturation denies without advertising a retry beyond the next minute'
);

delete from private.gallery_public_delivery_windows;
create temporary table gallery_delivery_results (payload jsonb) on commit drop;

do $delivery$
begin
  for index_value in 1..31 loop
    insert into gallery_delivery_results
    values (public.gallery_reserve_public_delivery('thumbnail', 2097152));
  end loop;
  insert into gallery_delivery_results
  values (public.gallery_reserve_public_delivery('full', 2097152));
end
$delivery$;

select is(
  (select count(*)::integer from gallery_delivery_results where (payload ->> 'allowed')::boolean),
  32,
  'thirty-two two-mebibyte reservations reach the shared 64 MiB daily ceiling'
);

select is(
  (select count(distinct delivery_kind)::integer from private.gallery_public_delivery_windows),
  2,
  'the daily byte ceiling is shared across delivery kinds'
);

create temporary table gallery_delivery_denial (payload jsonb) on commit drop;
insert into gallery_delivery_denial
values (public.gallery_reserve_public_delivery('list', 1));

select ok(
  (select (payload ->> 'allowed')::boolean is false from gallery_delivery_denial)
  and (
    select (payload ->> 'retryAfterSeconds')::bigint
      between greatest(
        1,
        floor(extract(epoch from (date_trunc('day', statement_timestamp(), 'UTC') + interval '1 day' - statement_timestamp())))::bigint
      )
      and greatest(
        1,
        ceil(extract(epoch from (date_trunc('day', statement_timestamp(), 'UTC') + interval '1 day' - statement_timestamp())))::bigint + 1
      )
    from gallery_delivery_denial
  ),
  'daily saturation denies with a retry aligned to the next UTC day'
);

select is(
  (select sum(reserved_bytes)::bigint from private.gallery_public_delivery_windows),
  67108864::bigint,
  'a denied delivery does not increment the shared byte ledger'
);

select throws_ok(
  $$select public.gallery_public_feed_page_v2(24, now() + interval '1 day', null, null, null, 'newest', null, null)$$,
  '22023',
  'Gallery snapshot cannot be in the future.',
  'future snapshots are rejected'
);

select throws_ok(
  $$select public.gallery_public_feed_page_v2(24, now() - interval '11 minutes', null, null, null, 'newest', null, null)$$,
  '22023',
  'Gallery snapshot expired.',
  'snapshots older than the ten-minute traversal window are rejected'
);

select throws_ok(
  $$select public.gallery_public_feed_page_v2(24, null, now(), null, null, 'newest', null, null)$$,
  '22023',
  'Incomplete gallery cursor.',
  'partial cursor tuples are rejected'
);

create temporary table gallery_page_one (payload jsonb) on commit drop;
insert into gallery_page_one
select public.gallery_public_feed_page_v2(24, null, null, null, null, 'newest', null, null);

select is(
  (select jsonb_array_length(payload -> 'items') from gallery_page_one),
  24,
  'the first page is bounded to 24 items'
);

select is(
  (select (payload ->> 'totalEligible')::integer from gallery_page_one),
  90,
  'only complete object-backed revisions are eligible'
);

select is(
  (select (payload ->> 'hasMore')::boolean from gallery_page_one),
  true,
  'the first page reports another keyset page'
);

select ok(
  (select payload -> 'nextCursor' from gallery_page_one)
    ?& array['snapshotAt', 'reviewedAt', 'createdAt', 'id'],
  'the continuation cursor contains the stable snapshot and complete keyset tuple'
);

select ok(
  (
    select payload -> 'facets'
    from gallery_page_one
  ) = '{"member-submissions":90,"portraits":18,"gatherings":18,"action":18,"scenery":18,"companions":18}'::jsonb,
  'all category facets describe the complete stable snapshot'
);

select is(
  jsonb_array_length(
    public.gallery_public_feed_page_v2(24, null, null, null, null, 'newest', 'portraits', null) -> 'items'
  ),
  18,
  'canonical category filtering spans the complete snapshot'
);

select is(
  jsonb_array_length(
    public.gallery_public_feed_page_v2(24, null, null, null, null, 'newest', null, 'Unicode Mōchī moment') -> 'items'
  ),
  1,
  'search matches Unicode-normalized frozen publication text'
);

select is(
  (
    select item -> 'categories'
    from jsonb_array_elements(
      public.gallery_public_feed_page_v2(24, null, null, null, null, 'newest', null, 'Unicode Mōchī') -> 'items'
    ) as item
    limit 1
  ),
  '["member-submissions", "scenery"]'::jsonb,
  'a runtime publication belongs to member submissions and one canonical visual category'
);

select ok(
  (
    select not (item ?| array[
      'uploader', 'uploaderDisplayName', 'uploader_display_name',
      'storagePath', 'thumbnailStoragePath'
    ])
    from jsonb_array_elements(
      public.gallery_public_feed_page_v2(1, null, null, null, null, 'newest', null, null) -> 'items'
    ) as item
    limit 1
  ),
  'anonymous feed rows expose neither member attribution nor private Storage paths'
);

delete from private.gallery_public_delivery_windows;

insert into private.gallery_public_delivery_windows (
  window_started_at, delivery_kind, request_count, reserved_bytes
) values (
  date_trunc('minute', statement_timestamp()), 'list', 1, 67108864
);
create temporary table gallery_quota_first_media_reservation (payload jsonb) on commit drop;
insert into gallery_quota_first_media_reservation
values (public.gallery_reserve_public_media_v2(
  '10000000-0000-4000-8000-000000000092',
  'full'
));

select ok(
  (select (payload ->> 'allowed')::boolean is false from gallery_quota_first_media_reservation)
  and (select not (payload ? 'storagePath') from gallery_quota_first_media_reservation)
  and (
    select count(*) = 4
    from gallery_quota_first_media_reservation
    cross join lateral jsonb_object_keys(payload)
  ),
  'exhausted quota returns path-free denial before mismatched Storage evidence is joined'
);

delete from private.gallery_public_delivery_windows;

select is(
  public.gallery_reserve_public_media_v2(
    '10000000-0000-4000-8000-000000000092',
    'full'
  ),
  null::jsonb,
  'mismatched service-owned object metadata fails closed after quota-first reservation'
);

delete from private.gallery_public_delivery_windows;
create temporary table gallery_exact_media_reservation (payload jsonb) on commit drop;
insert into gallery_exact_media_reservation
values (public.gallery_reserve_public_media_v2(
  '10000000-0000-4000-8000-000000000090',
  'full'
));

select ok(
  (select payload ->> 'storagePath' =
    '_approved/publications/10000000-0000-4000-8000-000000000090/display.webp'
    from gallery_exact_media_reservation)
  and (select sum(reserved_bytes)::bigint from private.gallery_public_delivery_windows) = 1000,
  'a current publication reserves its exact selected bytes before resolving its display derivative'
);

select is(
  public.gallery_reserve_public_media_v2(
    '10000000-0000-4000-8000-000000000090',
    'thumbnail'
  ) ->> 'storagePath',
  '_approved/publications/10000000-0000-4000-8000-000000000090/revisions/50000000-0000-4000-8000-000000000090/thumbnail.webp',
  'a current publication atomically reserves and resolves its matching thumbnail'
);

select ok(
  public.gallery_reserve_public_media_v2(
    '10000000-0000-4000-8000-000000000090',
    'full'
  ) ->> 'sha256' = repeat('a', 64)
  and public.gallery_reserve_public_media_v2(
    '10000000-0000-4000-8000-000000000090',
    'thumbnail'
  ) ->> 'sha256' = repeat('b', 64),
  'atomic media reservations return the immutable content hashes'
);

-- Publish an old-dated backfill after page one and refresh publication 90.
-- Both mutations occur after the captured snapshot even though their source
-- review order can be older than existing rows.
select pg_sleep(0.01);

insert into storage.objects (id, bucket_id, name, owner, metadata)
values
  (
    '20000000-0000-4000-8000-000000000091',
    'member-gallery',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/feed-91.webp',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '{"size":1000,"mimetype":"image/webp"}'::jsonb
  ),
  (
    '30000000-0000-4000-8000-000000000091',
    'member-gallery',
    '_approved/publications/10000000-0000-4000-8000-000000000091/display.webp',
    null::uuid,
    '{"size":1000,"mimetype":"image/webp"}'::jsonb
  ),
  (
    '40000000-0000-4000-8000-000000000091',
    'member-gallery',
    '_approved/publications/10000000-0000-4000-8000-000000000091/revisions/50000000-0000-4000-8000-000000000091/thumbnail.webp',
    null::uuid,
    '{"size":100,"mimetype":"image/webp"}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000090',
    'member-gallery',
    '_approved/publications/10000000-0000-4000-8000-000000000090/revisions/51000000-0000-4000-8000-000000000090/thumbnail.webp',
    null::uuid,
    '{"size":110,"mimetype":"image/webp"}'::jsonb
  );

insert into public.gallery_submissions (
  id,
  user_id,
  storage_bucket,
  storage_path,
  mime_type,
  size_bytes,
  title,
  caption,
  category,
  status,
  reviewed_by,
  reviewed_at,
  created_at,
  gallery_publication_id,
  thumbnail_revision_id,
  thumbnail_storage_path,
  thumbnail_mime_type,
  thumbnail_size_bytes,
  thumbnail_width,
  thumbnail_height
) values (
  '00000000-0000-4000-8000-000000000091',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'member-gallery',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/feed-91.webp',
  'image/webp',
  1000,
  'Late backfill',
  'Published after the first page snapshot.',
  'action',
  'approved',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '2026-06-01 00:00:00+00',
  '2026-06-01 00:00:00+00',
  '10000000-0000-4000-8000-000000000091',
  '50000000-0000-4000-8000-000000000091',
  '_approved/publications/10000000-0000-4000-8000-000000000091/revisions/50000000-0000-4000-8000-000000000091/thumbnail.webp',
  'image/webp',
  100,
  640,
  400
);

insert into private.gallery_publication_revisions (
  id,
  publication_id,
  submission_id,
  visible_from,
  title,
  caption,
  public_category,
  uploader_display_name,
  source_created_at,
  source_reviewed_at,
  storage_bucket,
  original_storage_path,
  original_mime_type,
  original_size_bytes,
  original_width,
  original_height,
  original_storage_object_id,
  original_storage_object_version,
  original_storage_object_updated_at,
  original_sha256,
  thumbnail_storage_path,
  thumbnail_mime_type,
  thumbnail_size_bytes,
  thumbnail_width,
  thumbnail_height,
  thumbnail_storage_object_id,
  thumbnail_storage_object_version,
  thumbnail_storage_object_updated_at,
  thumbnail_sha256
) values (
  '50000000-0000-4000-8000-000000000091',
  '10000000-0000-4000-8000-000000000091',
  '00000000-0000-4000-8000-000000000091',
  clock_timestamp(),
  'Late backfill',
  'Published after the first page snapshot.',
  'action',
  'Mōchī Member',
  '2026-06-01 00:00:00+00',
  '2026-06-01 00:00:00+00',
  'member-gallery',
  '_approved/publications/10000000-0000-4000-8000-000000000091/display.webp',
  'image/webp',
  1000,
  1200,
  800,
  '30000000-0000-4000-8000-000000000091',
  (select version from storage.objects where id = '30000000-0000-4000-8000-000000000091'),
  (select updated_at from storage.objects where id = '30000000-0000-4000-8000-000000000091'),
  repeat('a', 64),
  '_approved/publications/10000000-0000-4000-8000-000000000091/revisions/50000000-0000-4000-8000-000000000091/thumbnail.webp',
  'image/webp',
  100,
  640,
  400,
  '40000000-0000-4000-8000-000000000091',
  (select version from storage.objects where id = '40000000-0000-4000-8000-000000000091'),
  (select updated_at from storage.objects where id = '40000000-0000-4000-8000-000000000091'),
  repeat('b', 64)
);

update private.gallery_publication_revisions
set visible_until = clock_timestamp()
where id = '50000000-0000-4000-8000-000000000090';

insert into private.gallery_publication_revisions (
  id,
  publication_id,
  submission_id,
  visible_from,
  title,
  caption,
  public_category,
  uploader_display_name,
  source_created_at,
  source_reviewed_at,
  storage_bucket,
  original_storage_path,
  original_mime_type,
  original_size_bytes,
  original_width,
  original_height,
  original_storage_object_id,
  original_storage_object_version,
  original_storage_object_updated_at,
  original_sha256,
  thumbnail_storage_path,
  thumbnail_mime_type,
  thumbnail_size_bytes,
  thumbnail_width,
  thumbnail_height,
  thumbnail_storage_object_id,
  thumbnail_storage_object_version,
  thumbnail_storage_object_updated_at,
  thumbnail_sha256
) values (
  '51000000-0000-4000-8000-000000000090',
  '10000000-0000-4000-8000-000000000090',
  '00000000-0000-4000-8000-000000000090',
  clock_timestamp(),
  'Gallery item 90 refreshed',
  'A newer immutable derivative revision.',
  'gatherings',
  'Mōchī Member',
  '2026-07-01 01:30:00+00',
  '2026-07-01 01:30:00+00',
  'member-gallery',
  '_approved/publications/10000000-0000-4000-8000-000000000090/display.webp',
  'image/webp',
  1000,
  1200,
  800,
  '30000000-0000-4000-8000-000000000090',
  (select version from storage.objects where id = '30000000-0000-4000-8000-000000000090'),
  (select updated_at from storage.objects where id = '30000000-0000-4000-8000-000000000090'),
  repeat('a', 64),
  '_approved/publications/10000000-0000-4000-8000-000000000090/revisions/51000000-0000-4000-8000-000000000090/thumbnail.webp',
  'image/webp',
  110,
  640,
  360,
  '41000000-0000-4000-8000-000000000090',
  (select version from storage.objects where id = '41000000-0000-4000-8000-000000000090'),
  (select updated_at from storage.objects where id = '41000000-0000-4000-8000-000000000090'),
  repeat('c', 64)
);

update public.gallery_submissions
set thumbnail_revision_id = '51000000-0000-4000-8000-000000000090',
    thumbnail_storage_path = '_approved/publications/10000000-0000-4000-8000-000000000090/revisions/51000000-0000-4000-8000-000000000090/thumbnail.webp',
    thumbnail_size_bytes = 110,
    thumbnail_width = 640,
    thumbnail_height = 360
where id = '00000000-0000-4000-8000-000000000090';

create temporary table gallery_traversed (
  id uuid primary key,
  thumbnail_height integer not null
) on commit drop;

do $test$
declare
  current_page jsonb := (select payload from gallery_page_one);
  cursor_value jsonb;
begin
  loop
    insert into gallery_traversed (id, thumbnail_height)
    select (item ->> 'id')::uuid, (item ->> 'thumbnailHeight')::integer
    from jsonb_array_elements(current_page -> 'items') as item
    on conflict do nothing;

    exit when not coalesce((current_page ->> 'hasMore')::boolean, false);
    cursor_value := current_page -> 'nextCursor';
    current_page := public.gallery_public_feed_page_v2(
      24,
      (cursor_value ->> 'snapshotAt')::timestamptz,
      (cursor_value ->> 'reviewedAt')::timestamptz,
      (cursor_value ->> 'createdAt')::timestamptz,
      (cursor_value ->> 'id')::uuid,
      'newest',
      null,
      null
    );
  end loop;
end
$test$;

select is(
  (select count(*)::integer from gallery_traversed),
  90,
  'the original snapshot traverses every initial revision without gaps or duplicates'
);

select ok(
  not exists (
    select 1
    from gallery_traversed
    where id in (
      '10000000-0000-4000-8000-000000000091'
    )
  ),
  'concurrent backfill and refreshed revision do not shift the captured snapshot'
);

select ok(
  exists (
    select 1
    from gallery_traversed
    where id = '10000000-0000-4000-8000-000000000090'
      and thumbnail_height = 400
  ),
  'the captured snapshot retains the revision visible when page one was created'
);

select is(
  (
    public.gallery_public_feed_page_v2(24, null, null, null, null, 'newest', null, null)
      ->> 'totalEligible'
  )::integer,
  91,
  'a fresh snapshot sees the backfill and one refreshed revision'
);

select is(
  (
    select item ->> 'id'
    from jsonb_array_elements(
      public.gallery_public_feed_page_v2(24, null, null, null, null, 'newest', null, 'Late backfill') -> 'items'
    ) as item
  ),
  '10000000-0000-4000-8000-000000000091',
  'a fresh snapshot includes a late-published item with an older source date'
);

select is(
  (
    select item ->> 'id'
    from jsonb_array_elements(
      public.gallery_public_feed_page_v2(24, null, null, null, null, 'newest', null, 'Gallery item 90 refreshed') -> 'items'
    ) as item
  ),
  '10000000-0000-4000-8000-000000000090',
  'a fresh snapshot returns only the current refreshed revision'
);

select ok(
  (
    select count(*) = 2 and count(distinct publication_id) = 1
    from private.gallery_publication_revisions
    where submission_id = '00000000-0000-4000-8000-000000000090'
  ),
  'a derivative refresh creates a new revision while retaining one stable opaque publication identity'
);

select is(
  public.gallery_reserve_public_media_v2(
    '10000000-0000-4000-8000-000000000090',
    'full'
  ) ->> 'id',
  '10000000-0000-4000-8000-000000000090',
  'the stable publication identity reserves and resolves after a derivative refresh'
);

select is(
  public.gallery_reserve_public_media_v2(
    '10000000-0000-4000-8000-000000000090',
    'thumbnail'
  ) ->> 'storagePath',
  '_approved/publications/10000000-0000-4000-8000-000000000090/revisions/51000000-0000-4000-8000-000000000090/thumbnail.webp',
  'the stable publication identity resolves the current derivative revision'
);

select throws_ok(
  $$
    update private.gallery_publication_revisions
    set caption = 'Mutation attempt'
    where id = '51000000-0000-4000-8000-000000000090'
  $$,
  '23514',
  'Gallery publication revisions are immutable.',
  'frozen publication content cannot be edited'
);

select throws_ok(
  $$
    update private.gallery_publication_revisions
    set visible_until = clock_timestamp()
    where id = '50000000-0000-4000-8000-000000000090'
  $$,
  '23514',
  'Gallery publication revisions are immutable.',
  'a retired revision cannot be retired or reopened again'
);

select throws_ok(
  $$
    delete from private.gallery_publication_revisions
    where id = '50000000-0000-4000-8000-000000000090'
  $$,
  '23514',
  'Gallery publication revisions cannot be deleted.',
  'publication evidence cannot be deleted'
);

update public.gallery_submissions
set status = 'archived'
where id = '00000000-0000-4000-8000-000000000090';

select ok(
  (
    select visible_until is not null
    from private.gallery_publication_revisions
    where id = '51000000-0000-4000-8000-000000000090'
  ),
  'archiving the source immediately retires its active revision'
);

select is(
  public.gallery_reserve_public_media_v2(
    '10000000-0000-4000-8000-000000000090',
    'full'
  ),
  null::jsonb,
  'archiving immediately revokes retained-revision media reservation and resolution'
);

select is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'member-gallery'
      and name like '_approved/publications/10000000-0000-4000-8000-000000000090/%'
  ),
  3,
  'archiving revokes delivery without deleting retained immutable media evidence'
);

select is(
  jsonb_array_length(
    public.gallery_public_feed_page_v2(24, null, null, null, null, 'newest', null, 'Gallery item 90 refreshed') -> 'items'
  ),
  0,
  'a fresh snapshot removes an archived publication from the list feed'
);

select * from finish();
rollback;
