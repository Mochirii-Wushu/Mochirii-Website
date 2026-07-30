-- Public Gallery delivery is driven by immutable, service-only publication
-- revisions. The member-owned upload row remains the moderation source of
-- truth, while every public revision freezes the reviewed content and opaque
-- service-owned media references used by one cursor snapshot.

alter table public.gallery_submissions
  add column if not exists gallery_publication_id uuid,
  drop constraint if exists gallery_submissions_thumbnail_service_path_check;

alter table public.gallery_submissions
  add constraint gallery_submissions_gallery_publication_id_key
  unique (gallery_publication_id),
  add constraint gallery_submissions_id_gallery_publication_id_key
  unique (id, gallery_publication_id);

alter table public.gallery_submissions
  add constraint gallery_submissions_thumbnail_service_path_check
  check (
    thumbnail_storage_path is null
    or (
      thumbnail_revision_id is not null
      and (
        (
          gallery_publication_id is null
          and thumbnail_storage_path = (
            '_approved/thumbs/' || id::text || '/' || thumbnail_revision_id::text || '.webp'
          )
        )
        or (
          gallery_publication_id is not null
          and thumbnail_storage_path = (
            '_approved/publications/' || gallery_publication_id::text ||
            '/revisions/' || thumbnail_revision_id::text || '/thumbnail.webp'
          )
        )
      )
    )
  ) not valid;

alter table public.gallery_submissions
  drop constraint if exists gallery_submissions_size_bytes_check;

alter table public.gallery_submissions
  add constraint gallery_submissions_size_bytes_check
  check (size_bytes between 1 and 8388608) not valid;

update storage.buckets
set file_size_limit = 8388608
where id = 'member-gallery';

create table private.gallery_source_validations (
  submission_id uuid primary key
    references public.gallery_submissions(id) on delete cascade,
  storage_object_id uuid not null unique,
  storage_bucket text not null,
  storage_path text not null,
  storage_object_version text,
  storage_object_updated_at timestamptz not null,
  source_mime_type text not null,
  source_size_bytes bigint not null,
  source_width integer not null,
  source_height integer not null,
  source_sha256 text not null,
  validator_version text not null,
  validated_at timestamptz not null default statement_timestamp(),
  constraint gallery_source_validation_bucket_check
    check (storage_bucket = 'member-gallery'),
  constraint gallery_source_validation_mime_check
    check (source_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint gallery_source_validation_size_check
    check (source_size_bytes between 1 and 8388608),
  constraint gallery_source_validation_width_check
    check (source_width between 1 and 4096),
  constraint gallery_source_validation_height_check
    check (source_height between 1 and 4096),
  constraint gallery_source_validation_pixels_check
    check (source_width::bigint * source_height::bigint <= 12600000),
  constraint gallery_source_validation_sha256_check
    check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint gallery_source_validation_version_check
    check (validator_version = 'gallery-source-v1')
);

alter table private.gallery_source_validations enable row level security;
revoke all on table private.gallery_source_validations
from public, anon, authenticated, service_role;
create policy service_only_default_deny on private.gallery_source_validations
  as restrictive for all to anon, authenticated using (false) with check (false);

create table private.gallery_publication_revisions (
  id uuid primary key,
  publication_id uuid not null,
  submission_id uuid not null,
  visible_from timestamptz not null,
  visible_until timestamptz,
  title text,
  caption text,
  public_category text not null,
  uploader_display_name text not null,
  source_created_at timestamptz not null,
  source_reviewed_at timestamptz not null,
  storage_bucket text not null,
  original_storage_path text not null,
  original_mime_type text not null,
  original_size_bytes bigint not null,
  original_width integer not null,
  original_height integer not null,
  original_storage_object_id uuid not null,
  original_storage_object_version text,
  original_storage_object_updated_at timestamptz not null,
  original_sha256 text not null,
  thumbnail_storage_path text not null,
  thumbnail_mime_type text not null,
  thumbnail_size_bytes bigint not null,
  thumbnail_width integer not null,
  thumbnail_height integer not null,
  thumbnail_storage_object_id uuid not null,
  thumbnail_storage_object_version text,
  thumbnail_storage_object_updated_at timestamptz not null,
  thumbnail_sha256 text not null,
  constraint gallery_publication_visibility_check
    check (visible_until is null or visible_until >= visible_from),
  constraint gallery_publication_title_length_check
    check (title is null or char_length(title) between 1 and 80),
  constraint gallery_publication_caption_length_check
    check (caption is null or char_length(caption) between 1 and 300),
  constraint gallery_publication_category_check
    check (public_category in ('portraits', 'gatherings', 'action', 'scenery', 'companions')),
  constraint gallery_publication_display_name_check
    check (char_length(uploader_display_name) between 1 and 100),
  constraint gallery_publication_bucket_check
    check (storage_bucket = 'member-gallery'),
  constraint gallery_publication_original_path_check
    check (original_storage_path = '_approved/publications/' || publication_id::text || '/display.webp'),
  constraint gallery_publication_thumbnail_path_check
    check (
      thumbnail_storage_path = '_approved/publications/' || publication_id::text ||
        '/revisions/' || id::text || '/thumbnail.webp'
    ),
  constraint gallery_publication_original_mime_check
    check (original_mime_type = 'image/webp'),
  constraint gallery_publication_original_size_check
    check (original_size_bytes between 1 and 2097152),
  constraint gallery_publication_original_width_check
    check (original_width between 1 and 2560),
  constraint gallery_publication_original_height_check
    check (original_height between 1 and 2560),
  constraint gallery_publication_original_sha256_check
    check (original_sha256 ~ '^[0-9a-f]{64}$'),
  constraint gallery_publication_thumbnail_mime_check
    check (thumbnail_mime_type = 'image/webp'),
  constraint gallery_publication_thumbnail_size_check
    check (thumbnail_size_bytes between 1 and 81920),
  constraint gallery_publication_thumbnail_width_check
    check (thumbnail_width between 1 and 720),
  constraint gallery_publication_thumbnail_height_check
    check (thumbnail_height between 1 and 720),
  constraint gallery_publication_thumbnail_sha256_check
    check (thumbnail_sha256 ~ '^[0-9a-f]{64}$'),
  constraint gallery_publication_submission_fk
    foreign key (submission_id, publication_id)
    references public.gallery_submissions(id, gallery_publication_id)
    on delete restrict
);

alter table private.gallery_publication_revisions enable row level security;
revoke all on table private.gallery_publication_revisions
from public, anon, authenticated, service_role;
create policy service_only_default_deny on private.gallery_publication_revisions
  as restrictive for all to anon, authenticated using (false) with check (false);

create table private.gallery_public_delivery_windows (
  window_started_at timestamptz not null,
  delivery_kind text not null,
  request_count bigint not null default 0,
  reserved_bytes bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (window_started_at, delivery_kind),
  constraint gallery_public_delivery_kind_check
    check (delivery_kind in ('list', 'thumbnail', 'full')),
  constraint gallery_public_delivery_request_count_check
    check (request_count between 0 and 1000000),
  constraint gallery_public_delivery_reserved_bytes_check
    check (reserved_bytes between 0 and 1073741824)
);

alter table private.gallery_public_delivery_windows enable row level security;
revoke all on table private.gallery_public_delivery_windows
from public, anon, authenticated, service_role;
create policy service_only_default_deny on private.gallery_public_delivery_windows
  as restrictive for all to anon, authenticated using (false) with check (false);

create index gallery_public_delivery_window_cleanup_idx
on private.gallery_public_delivery_windows (window_started_at);

-- Moderator source previews have an independent capacity pool. Anonymous
-- Gallery traffic must never be able to consume the quota needed for a
-- moderator to review a private submission.
create table private.gallery_moderation_preview_windows (
  window_started_at timestamptz primary key,
  request_count bigint not null default 0,
  reserved_bytes bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  constraint gallery_moderation_preview_request_count_check
    check (request_count between 0 and 1000000),
  constraint gallery_moderation_preview_reserved_bytes_check
    check (reserved_bytes between 0 and 1073741824)
);

alter table private.gallery_moderation_preview_windows enable row level security;
revoke all on table private.gallery_moderation_preview_windows
from public, anon, authenticated, service_role;
create policy service_only_default_deny on private.gallery_moderation_preview_windows
  as restrictive for all to anon, authenticated using (false) with check (false);

create index gallery_moderation_preview_window_cleanup_idx
on private.gallery_moderation_preview_windows (window_started_at);

create or replace function public.gallery_reserve_public_delivery(
  p_delivery_kind text,
  p_reserved_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_kind text := lower(nullif(btrim(p_delivery_kind), ''));
  requested_bytes bigint := p_reserved_bytes;
  minute_start timestamptz := date_trunc('minute', statement_timestamp());
  day_start timestamptz := date_trunc('day', statement_timestamp(), 'UTC');
  minute_requests bigint := 0;
  day_requests bigint := 0;
  day_reserved_bytes bigint := 0;
  minute_request_limit bigint;
  day_request_limit bigint;
  daily_byte_limit constant bigint := 67108864;
  minute_limit_reached boolean;
  daily_limit_reached boolean;
  retry_after_seconds bigint;
begin
  if requested_kind is null
    or requested_kind not in ('list', 'thumbnail', 'full')
    or requested_bytes is null
    or requested_bytes < 1
    or requested_bytes > 2097152
  then
    raise exception 'Invalid Gallery delivery reservation.' using errcode = '22023';
  end if;

  minute_request_limit := case requested_kind
    when 'list' then 120
    when 'thumbnail' then 240
    else 30
  end;
  day_request_limit := case requested_kind
    when 'list' then 10000
    when 'thumbnail' then 10000
    else 500
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mochirii.gallery-public-delivery', 0)
  );

  delete from private.gallery_public_delivery_windows
  where window_started_at < day_start - interval '2 days';

  select coalesce(sum(delivery_window.request_count), 0)
  into minute_requests
  from private.gallery_public_delivery_windows as delivery_window
  where delivery_window.window_started_at = minute_start
    and delivery_window.delivery_kind = requested_kind;

  select
    coalesce(sum(delivery_window.request_count) filter (
      where delivery_window.delivery_kind = requested_kind
    ), 0),
    coalesce(sum(delivery_window.reserved_bytes), 0)
  into day_requests, day_reserved_bytes
  from private.gallery_public_delivery_windows as delivery_window
  where delivery_window.window_started_at >= day_start;

  minute_limit_reached := minute_requests + 1 > minute_request_limit;
  daily_limit_reached := day_requests + 1 > day_request_limit
    or day_reserved_bytes + requested_bytes > daily_byte_limit;

  if minute_limit_reached or daily_limit_reached then
    retry_after_seconds := case
      when daily_limit_reached then greatest(
        1,
        ceil(extract(epoch from (day_start + interval '1 day' - statement_timestamp())))::bigint
      )
      else greatest(
        1,
        ceil(extract(epoch from (minute_start + interval '1 minute' - statement_timestamp())))::bigint
      )
    end;

    return jsonb_build_object(
      'allowed', false,
      'retryAfterSeconds', retry_after_seconds,
      'dailyReservedBytes', day_reserved_bytes,
      'dailyLimitBytes', daily_byte_limit
    );
  end if;

  insert into private.gallery_public_delivery_windows (
    window_started_at,
    delivery_kind,
    request_count,
    reserved_bytes,
    updated_at
  ) values (
    minute_start,
    requested_kind,
    1,
    requested_bytes,
    statement_timestamp()
  )
  on conflict (window_started_at, delivery_kind) do update
  set
    request_count = private.gallery_public_delivery_windows.request_count + 1,
    reserved_bytes = private.gallery_public_delivery_windows.reserved_bytes + excluded.reserved_bytes,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'allowed', true,
    'retryAfterSeconds', 0,
    'dailyReservedBytes', day_reserved_bytes + requested_bytes,
    'dailyLimitBytes', daily_byte_limit
  );
end;
$$;

revoke all on function public.gallery_reserve_public_delivery(text, bigint)
from public, anon, authenticated;
grant execute on function public.gallery_reserve_public_delivery(text, bigint)
to service_role;

create or replace function public.gallery_reserve_moderation_preview(
  p_reserved_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_bytes bigint := p_reserved_bytes;
  minute_start timestamptz := date_trunc('minute', statement_timestamp());
  day_start timestamptz := date_trunc('day', statement_timestamp(), 'UTC');
  minute_requests bigint := 0;
  day_requests bigint := 0;
  day_reserved_bytes bigint := 0;
  daily_byte_limit constant bigint := 67108864;
  minute_limit_reached boolean;
  daily_limit_reached boolean;
  retry_after_seconds bigint;
begin
  if requested_bytes is null
    or requested_bytes < 1
    or requested_bytes > 8388608
  then
    raise exception 'Invalid Gallery moderation preview reservation.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mochirii.gallery-moderation-preview', 0)
  );

  delete from private.gallery_moderation_preview_windows
  where window_started_at < day_start - interval '2 days';

  select coalesce(sum(preview_window.request_count), 0)
  into minute_requests
  from private.gallery_moderation_preview_windows as preview_window
  where preview_window.window_started_at = minute_start;

  select
    coalesce(sum(preview_window.request_count), 0),
    coalesce(sum(preview_window.reserved_bytes), 0)
  into day_requests, day_reserved_bytes
  from private.gallery_moderation_preview_windows as preview_window
  where preview_window.window_started_at >= day_start;

  minute_limit_reached := minute_requests + 1 > 12;
  daily_limit_reached := day_requests + 1 > 100
    or day_reserved_bytes + requested_bytes > daily_byte_limit;

  if minute_limit_reached or daily_limit_reached then
    retry_after_seconds := case
      when daily_limit_reached then greatest(
        1,
        ceil(extract(epoch from (day_start + interval '1 day' - statement_timestamp())))::bigint
      )
      else greatest(
        1,
        ceil(extract(epoch from (minute_start + interval '1 minute' - statement_timestamp())))::bigint
      )
    end;

    return jsonb_build_object(
      'allowed', false,
      'retryAfterSeconds', retry_after_seconds,
      'dailyReservedBytes', day_reserved_bytes,
      'dailyLimitBytes', daily_byte_limit
    );
  end if;

  insert into private.gallery_moderation_preview_windows (
    window_started_at,
    request_count,
    reserved_bytes,
    updated_at
  ) values (
    minute_start,
    1,
    requested_bytes,
    statement_timestamp()
  )
  on conflict (window_started_at) do update
  set
    request_count = private.gallery_moderation_preview_windows.request_count + 1,
    reserved_bytes = private.gallery_moderation_preview_windows.reserved_bytes + excluded.reserved_bytes,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'allowed', true,
    'retryAfterSeconds', 0,
    'dailyReservedBytes', day_reserved_bytes + requested_bytes,
    'dailyLimitBytes', daily_byte_limit
  );
end;
$$;

revoke all on function public.gallery_reserve_moderation_preview(bigint)
from public, anon, authenticated;
grant execute on function public.gallery_reserve_moderation_preview(bigint)
to service_role;

create unique index gallery_publication_one_active_per_submission_idx
on private.gallery_publication_revisions (submission_id)
where visible_until is null;

create index gallery_publication_identity_idx
on private.gallery_publication_revisions (publication_id, visible_from desc);

create index gallery_publication_submission_fk_idx
on private.gallery_publication_revisions (submission_id, publication_id);

create index gallery_publication_newest_idx
on private.gallery_publication_revisions (
  source_reviewed_at desc,
  source_created_at desc,
  id desc
);

create index gallery_publication_oldest_idx
on private.gallery_publication_revisions (
  source_reviewed_at asc,
  source_created_at asc,
  id asc
);

create index gallery_publication_category_newest_idx
on private.gallery_publication_revisions (
  public_category,
  source_reviewed_at desc,
  source_created_at desc,
  id desc
);

-- Keep the exact v1 RPC signature during the bounded application rollback
-- window, but fail closed with an empty, list-budgeted result. The retired Edge
-- source minted replayable Storage bearer URLs and must never remain a media
-- rollback after this migration. The current Edge serves the old browser's
-- exact empty-object request shape with quota-enforced Edge media URLs instead.
create or replace function public.gallery_publishable_submissions(
  p_limit integer default 24,
  p_offset integer default 0
)
returns setof public.gallery_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_reservation jsonb;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.jwt() ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  perform p_limit, p_offset;
  delivery_reservation := public.gallery_reserve_public_delivery('list', 65536);
  if coalesce((delivery_reservation ->> 'allowed')::boolean, false) is not true then
    raise exception 'Gallery public delivery temporarily unavailable.' using errcode = 'P0001';
  end if;

  return;
end;
$$;

revoke all on function public.gallery_publishable_submissions(integer, integer)
from public, anon, authenticated;
grant execute on function public.gallery_publishable_submissions(integer, integer)
to service_role;

comment on function public.gallery_publishable_submissions(integer, integer) is
  'Temporary service-only rollback guard: meters legacy calls and always returns an empty set so retired Edge source cannot mint replayable media URLs.';

create or replace function private.enforce_gallery_publication_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Gallery publication revisions cannot be deleted.' using errcode = '23514';
  end if;

  if (to_jsonb(new) - 'visible_until') is distinct from (to_jsonb(old) - 'visible_until')
    or old.visible_until is not null
    or new.visible_until is null
    or new.visible_until < old.visible_from
  then
    raise exception 'Gallery publication revisions are immutable.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_gallery_publication_immutability()
from public, anon, authenticated, service_role;

create trigger enforce_gallery_publication_immutability
before update or delete on private.gallery_publication_revisions
for each row execute function private.enforce_gallery_publication_immutability();

create or replace function private.retire_gallery_publication_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'approved' and new.status <> 'approved' then
    update private.gallery_publication_revisions
    set visible_until = statement_timestamp()
    where submission_id = new.id
      and visible_until is null;
  end if;
  return new;
end;
$$;

revoke all on function private.retire_gallery_publication_on_status_change()
from public, anon, authenticated, service_role;

create trigger retire_gallery_publication_on_status_change
after update of status on public.gallery_submissions
for each row execute function private.retire_gallery_publication_on_status_change();

-- A source object becomes immutable as soon as a submission references it.
-- Members may still edit pending descriptive fields, but the exact row snapshot
-- reviewed by a moderator is enforced separately by the commit CAS below.
create or replace function public.enforce_gallery_original_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.user_id, old.storage_bucket, old.storage_path, old.mime_type, old.size_bytes)
    is distinct from
    row(new.user_id, new.storage_bucket, new.storage_path, new.mime_type, new.size_bytes)
  then
    raise exception 'A referenced gallery original is immutable.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_gallery_original_immutability()
from public, anon, authenticated, service_role;

create or replace function private.member_gallery_original_mutation_allowed(
  p_user_id uuid,
  p_bucket_id text,
  p_object_name text,
  p_allow_orphan boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id = auth.uid()
    and p_bucket_id = 'member-gallery'
    and (storage.foldername(p_object_name))[1] = p_user_id::text
    and p_allow_orphan
    and not exists (
      select 1
      from public.gallery_submissions as submission
      where submission.user_id = p_user_id
        and submission.storage_bucket = p_bucket_id
        and submission.storage_path = p_object_name
    );
$$;

revoke all on function private.member_gallery_original_mutation_allowed(uuid, text, text, boolean)
from public, anon, authenticated;
grant execute on function private.member_gallery_original_mutation_allowed(uuid, text, text, boolean)
to authenticated;

drop policy if exists "Members update own pending gallery originals" on storage.objects;

create or replace function public.gallery_source_validation_candidate(
  p_submission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_submission public.gallery_submissions%rowtype;
  source_object storage.objects%rowtype;
  object_size bigint;
  object_mime text;
begin
  select *
  into current_submission
  from public.gallery_submissions
  where id = p_submission_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'submission_not_found');
  end if;

  if current_submission.status not in ('pending', 'approved') then
    return jsonb_build_object('ok', false, 'reason', 'submission_not_reviewable');
  end if;

  if current_submission.storage_bucket <> 'member-gallery'
    or current_submission.size_bytes not between 1 and 8388608
    or current_submission.mime_type not in ('image/jpeg', 'image/png', 'image/webp')
  then
    return jsonb_build_object('ok', false, 'reason', 'source_outside_validation_limits');
  end if;

  select *
  into source_object
  from storage.objects
  where bucket_id = current_submission.storage_bucket
    and name = current_submission.storage_path;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'source_object_missing');
  end if;

  object_size := case
    when coalesce(source_object.metadata ->> 'size', '') ~ '^[0-9]+$'
      then (source_object.metadata ->> 'size')::bigint
    else null
  end;
  object_mime := lower(coalesce(source_object.metadata ->> 'mimetype', ''));

  if object_size is distinct from current_submission.size_bytes
    or object_mime <> current_submission.mime_type
  then
    return jsonb_build_object('ok', false, 'reason', 'source_object_mismatch');
  end if;

  return jsonb_build_object(
    'ok', true,
    'submission_id', current_submission.id,
    'submission_updated_at', current_submission.updated_at,
    'storage_bucket', current_submission.storage_bucket,
    'storage_path', current_submission.storage_path,
    'source_mime_type', current_submission.mime_type,
    'source_size_bytes', current_submission.size_bytes,
    'storage_object_id', source_object.id,
    'storage_object_version', source_object.version,
    'storage_object_updated_at', source_object.updated_at
  );
end;
$$;

revoke all on function public.gallery_source_validation_candidate(uuid)
from public, anon, authenticated;
grant execute on function public.gallery_source_validation_candidate(uuid)
to service_role;

create or replace function public.gallery_commit_source_validation(
  p_submission_id uuid,
  p_expected_submission_updated_at timestamptz,
  p_expected_storage_object_id uuid,
  p_expected_storage_object_version text,
  p_expected_storage_object_updated_at timestamptz,
  p_source_mime_type text,
  p_source_size_bytes bigint,
  p_source_width integer,
  p_source_height integer,
  p_source_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_submission public.gallery_submissions%rowtype;
  source_object storage.objects%rowtype;
  existing_validation private.gallery_source_validations%rowtype;
  object_size bigint;
  object_mime text;
begin
  select *
  into current_submission
  from public.gallery_submissions
  where id = p_submission_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'submission_not_found');
  end if;

  if p_expected_submission_updated_at is null
    or current_submission.updated_at is distinct from p_expected_submission_updated_at
  then
    return jsonb_build_object('committed', false, 'reason', 'stale_submission_revision');
  end if;

  if current_submission.status not in ('pending', 'approved') then
    return jsonb_build_object('committed', false, 'reason', 'submission_not_reviewable');
  end if;

  select *
  into source_object
  from storage.objects
  where id = p_expected_storage_object_id
    and bucket_id = current_submission.storage_bucket
    and name = current_submission.storage_path
  for key share;

  if not found
    or source_object.version is distinct from p_expected_storage_object_version
    or source_object.updated_at is distinct from p_expected_storage_object_updated_at
  then
    return jsonb_build_object('committed', false, 'reason', 'stale_source_object');
  end if;

  object_size := case
    when coalesce(source_object.metadata ->> 'size', '') ~ '^[0-9]+$'
      then (source_object.metadata ->> 'size')::bigint
    else null
  end;
  object_mime := lower(coalesce(source_object.metadata ->> 'mimetype', ''));

  if p_source_size_bytes is distinct from current_submission.size_bytes
    or p_source_size_bytes is distinct from object_size
    or p_source_mime_type is distinct from current_submission.mime_type
    or p_source_mime_type is distinct from object_mime
    or p_source_size_bytes not between 1 and 8388608
    or p_source_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_source_width not between 1 and 4096
    or p_source_height not between 1 and 4096
    or p_source_width::bigint * p_source_height::bigint > 12600000
    or p_source_sha256 !~ '^[0-9a-f]{64}$'
  then
    return jsonb_build_object('committed', false, 'reason', 'invalid_source_validation');
  end if;

  select *
  into existing_validation
  from private.gallery_source_validations
  where submission_id = current_submission.id;

  if found then
    if row(
      existing_validation.storage_object_id,
      existing_validation.storage_bucket,
      existing_validation.storage_path,
      existing_validation.storage_object_version,
      existing_validation.storage_object_updated_at,
      existing_validation.source_mime_type,
      existing_validation.source_size_bytes,
      existing_validation.source_width,
      existing_validation.source_height,
      existing_validation.source_sha256
    ) is distinct from row(
      source_object.id,
      current_submission.storage_bucket,
      current_submission.storage_path,
      source_object.version,
      source_object.updated_at,
      p_source_mime_type,
      p_source_size_bytes,
      p_source_width,
      p_source_height,
      p_source_sha256
    ) then
      return jsonb_build_object('committed', false, 'reason', 'source_validation_conflict');
    end if;

    return jsonb_build_object(
      'committed', true,
      'already_validated', true,
      'width', existing_validation.source_width,
      'height', existing_validation.source_height,
      'validated_at', existing_validation.validated_at
    );
  end if;

  insert into private.gallery_source_validations (
    submission_id,
    storage_object_id,
    storage_bucket,
    storage_path,
    storage_object_version,
    storage_object_updated_at,
    source_mime_type,
    source_size_bytes,
    source_width,
    source_height,
    source_sha256,
    validator_version
  ) values (
    current_submission.id,
    source_object.id,
    current_submission.storage_bucket,
    current_submission.storage_path,
    source_object.version,
    source_object.updated_at,
    p_source_mime_type,
    p_source_size_bytes,
    p_source_width,
    p_source_height,
    p_source_sha256,
    'gallery-source-v1'
  )
  returning * into existing_validation;

  return jsonb_build_object(
    'committed', true,
    'already_validated', false,
    'width', existing_validation.source_width,
    'height', existing_validation.source_height,
    'validated_at', existing_validation.validated_at
  );
end;
$$;

revoke all on function public.gallery_commit_source_validation(
  uuid, timestamptz, uuid, text, timestamptz, text, bigint, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.gallery_commit_source_validation(
  uuid, timestamptz, uuid, text, timestamptz, text, bigint, integer, integer, text
) to service_role;

create or replace function public.gallery_source_validation_states(
  p_submission_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'submission_id', validation.submission_id,
        'width', validation.source_width,
        'height', validation.source_height,
        'validator_version', validation.validator_version,
        'validated_at', validation.validated_at
      ) order by validation.submission_id
    ),
    '[]'::jsonb
  )
  from private.gallery_source_validations as validation
  join public.gallery_submissions as submission
    on submission.id = validation.submission_id
   and submission.storage_bucket = validation.storage_bucket
   and submission.storage_path = validation.storage_path
   and submission.mime_type = validation.source_mime_type
   and submission.size_bytes = validation.source_size_bytes
  join storage.objects as object
    on object.id = validation.storage_object_id
   and object.bucket_id = validation.storage_bucket
   and object.name = validation.storage_path
   and object.version is not distinct from validation.storage_object_version
   and object.updated_at = validation.storage_object_updated_at
   and coalesce(object.metadata ->> 'size', '') ~ '^[0-9]+$'
   and (object.metadata ->> 'size')::bigint = validation.source_size_bytes
   and lower(coalesce(object.metadata ->> 'mimetype', '')) = validation.source_mime_type
  where validation.submission_id = any(coalesce(p_submission_ids, '{}'::uuid[]));
$$;

revoke all on function public.gallery_source_validation_states(uuid[])
from public, anon, authenticated;
grant execute on function public.gallery_source_validation_states(uuid[])
to service_role;

drop function if exists public.gallery_commit_moderation(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, uuid
);

create function public.gallery_commit_moderation(
  p_submission_id uuid,
  p_moderator_id uuid,
  p_action text,
  p_reason text,
  p_publication_id uuid,
  p_public_original_storage_path text,
  p_public_original_mime_type text,
  p_public_original_size_bytes bigint,
  p_public_original_width integer,
  p_public_original_height integer,
  p_public_original_sha256 text,
  p_thumbnail_revision_id uuid,
  p_thumbnail_storage_path text,
  p_thumbnail_mime_type text,
  p_thumbnail_size_bytes bigint,
  p_thumbnail_width integer,
  p_thumbnail_height integer,
  p_thumbnail_sha256 text,
  p_expected_thumbnail_revision_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_submission public.gallery_submissions%rowtype;
  current_publication private.gallery_publication_revisions%rowtype;
  updated_submission public.gallery_submissions%rowtype;
  original_metadata jsonb;
  public_original_object storage.objects%rowtype;
  thumbnail_object storage.objects%rowtype;
  expected_public_original_path text;
  expected_thumbnail_path text;
  audit_action text;
  audit_reason text;
  transition_at timestamptz := clock_timestamp();
  uploader_display_name text;
  requires_display_upload boolean := false;
  instagram_job public.gallery_instagram_publish_jobs%rowtype;
  instagram_status text;
  instagram_eligibility_reason text;
begin
  if p_action not in ('approved', 'rejected', 'thumbnail') then
    raise exception 'Invalid gallery moderation action.' using errcode = '22023';
  end if;

  select *
  into current_submission
  from public.gallery_submissions
  where id = p_submission_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'submission_not_found');
  end if;

  if p_action in ('approved', 'rejected') and current_submission.status <> 'pending' then
    return jsonb_build_object('committed', false, 'reason', 'submission_not_pending');
  end if;

  if p_expected_updated_at is null
    or current_submission.updated_at is distinct from p_expected_updated_at
  then
    return jsonb_build_object('committed', false, 'reason', 'stale_submission_revision');
  end if;

  if p_action = 'thumbnail' then
    if current_submission.status <> 'approved' then
      return jsonb_build_object('committed', false, 'reason', 'submission_not_approved');
    end if;
    if current_submission.thumbnail_revision_id is distinct from p_expected_thumbnail_revision_id then
      return jsonb_build_object('committed', false, 'reason', 'stale_thumbnail_revision');
    end if;
  end if;

  select object.metadata
  into original_metadata
  from storage.objects as object
  where object.bucket_id = current_submission.storage_bucket
    and object.name = current_submission.storage_path
  for key share;

  if not found
    or (case
      when coalesce(original_metadata ->> 'size', '') ~ '^[0-9]+$'
        then (original_metadata ->> 'size')::bigint
      else null
    end) is distinct from current_submission.size_bytes
    or lower(coalesce(original_metadata ->> 'mimetype', '')) <> current_submission.mime_type
  then
    return jsonb_build_object('committed', false, 'reason', 'original_object_mismatch');
  end if;

  if p_action in ('approved', 'thumbnail') then
    if current_submission.category is null
      or current_submission.category not in ('portraits', 'gatherings', 'action', 'scenery', 'companions')
    then
      return jsonb_build_object('committed', false, 'reason', 'category_unclassified');
    end if;

    perform 1
    from private.gallery_source_validations as validation
    join storage.objects as object
      on object.id = validation.storage_object_id
     and object.bucket_id = validation.storage_bucket
     and object.name = validation.storage_path
     and object.version is not distinct from validation.storage_object_version
     and object.updated_at = validation.storage_object_updated_at
    where validation.submission_id = current_submission.id
      and validation.storage_bucket = current_submission.storage_bucket
      and validation.storage_path = current_submission.storage_path
      and validation.source_mime_type = current_submission.mime_type
      and validation.source_size_bytes = current_submission.size_bytes
      and validation.validator_version = 'gallery-source-v1';

    if not found then
      return jsonb_build_object('committed', false, 'reason', 'source_not_validated');
    end if;
  end if;

  if p_action in ('approved', 'thumbnail') then
    if p_publication_id is null
      or p_thumbnail_revision_id is null
      or p_thumbnail_revision_id = p_publication_id
      or p_thumbnail_mime_type <> 'image/webp'
      or p_thumbnail_size_bytes not between 1 and 81920
      or p_thumbnail_width not between 1 and 720
      or p_thumbnail_height not between 1 and 720
    then
      raise exception 'A complete bounded Gallery publication is required.' using errcode = '22023';
    end if;

    expected_thumbnail_path := '_approved/publications/' || p_publication_id::text ||
      '/revisions/' || p_thumbnail_revision_id::text || '/thumbnail.webp';
    if p_thumbnail_storage_path <> expected_thumbnail_path
    then
      raise exception 'Gallery publication paths are invalid.' using errcode = '22023';
    end if;

    if current_submission.gallery_publication_id is null then
      requires_display_upload := true;
    elsif p_action = 'thumbnail'
      and p_publication_id = current_submission.gallery_publication_id
    then
      select *
      into current_publication
      from private.gallery_publication_revisions
      where submission_id = p_submission_id
        and publication_id = p_publication_id
        and id = current_submission.thumbnail_revision_id
        and visible_until is null
      for update;

      if not found then
        return jsonb_build_object('committed', false, 'reason', 'active_publication_missing');
      end if;
    else
      return jsonb_build_object('committed', false, 'reason', 'publication_identity_mismatch');
    end if;

    if requires_display_upload then
      if p_public_original_mime_type <> 'image/webp'
        or p_public_original_size_bytes not between 1 and 2097152
        or p_public_original_width not between 1 and 2560
        or p_public_original_height not between 1 and 2560
        or p_public_original_sha256 !~ '^[0-9a-f]{64}$'
      then
        raise exception 'A complete bounded Gallery display image is required.' using errcode = '22023';
      end if;

      expected_public_original_path := '_approved/publications/' || p_publication_id::text || '/display.webp';
      if p_public_original_storage_path <> expected_public_original_path then
        raise exception 'Gallery display path is invalid.' using errcode = '22023';
      end if;

      select object.*
      into public_original_object
      from storage.objects as object
      where object.bucket_id = 'member-gallery'
        and object.name = p_public_original_storage_path
      for key share;

      if not found
        or (case
          when coalesce(public_original_object.metadata ->> 'size', '') ~ '^[0-9]+$'
            then (public_original_object.metadata ->> 'size')::bigint
          else null
        end) is distinct from p_public_original_size_bytes
        or lower(coalesce(public_original_object.metadata ->> 'mimetype', '')) <> p_public_original_mime_type
      then
        return jsonb_build_object('committed', false, 'reason', 'public_original_object_mismatch');
      end if;
    elsif p_public_original_storage_path is not null
      or p_public_original_mime_type is not null
      or p_public_original_size_bytes is not null
      or p_public_original_width is not null
      or p_public_original_height is not null
      or p_public_original_sha256 is not null
    then
      raise exception 'Existing Gallery publications must reuse their display image.' using errcode = '22023';
    end if;

    select object.*
    into thumbnail_object
    from storage.objects as object
    where object.bucket_id = 'member-gallery'
      and object.name = p_thumbnail_storage_path
    for key share;

    if not found
      or (case
        when coalesce(thumbnail_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (thumbnail_object.metadata ->> 'size')::bigint
        else null
      end) is distinct from p_thumbnail_size_bytes
      or lower(coalesce(thumbnail_object.metadata ->> 'mimetype', '')) <> 'image/webp'
      or p_thumbnail_sha256 !~ '^[0-9a-f]{64}$'
    then
      return jsonb_build_object('committed', false, 'reason', 'thumbnail_object_mismatch');
    end if;

    select coalesce(
      nullif(btrim(profile.discord_global_name), ''),
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(profile.discord_username), ''),
      'Mōchirīī Member'
    )
    into uploader_display_name
    from public.member_profiles as profile
    where profile.id = current_submission.user_id;

    if uploader_display_name is null then
      return jsonb_build_object('committed', false, 'reason', 'uploader_profile_missing');
    end if;
  elsif p_publication_id is not null
    or p_public_original_storage_path is not null
    or p_public_original_mime_type is not null
    or p_public_original_size_bytes is not null
    or p_public_original_width is not null
    or p_public_original_height is not null
    or p_thumbnail_revision_id is not null
    or p_thumbnail_storage_path is not null
    or p_thumbnail_mime_type is not null
    or p_thumbnail_size_bytes is not null
    or p_thumbnail_width is not null
    or p_thumbnail_height is not null
    or p_thumbnail_sha256 is not null
  then
    raise exception 'Rejected submissions cannot publish media.' using errcode = '22023';
  end if;

  if p_action = 'thumbnail' then
    update public.gallery_submissions
    set
      gallery_publication_id = p_publication_id,
      thumbnail_revision_id = p_thumbnail_revision_id,
      thumbnail_storage_path = p_thumbnail_storage_path,
      thumbnail_mime_type = p_thumbnail_mime_type,
      thumbnail_size_bytes = p_thumbnail_size_bytes,
      thumbnail_width = p_thumbnail_width,
      thumbnail_height = p_thumbnail_height
    where id = p_submission_id
    returning * into updated_submission;

    audit_action := 'thumbnail_refreshed';
    audit_reason := 'Bounded Gallery publication prepared.';
  else
    update public.gallery_submissions
    set
      status = p_action,
      reviewed_by = p_moderator_id,
      reviewed_at = transition_at,
      rejection_reason = case
        when p_action = 'rejected' then coalesce(nullif(btrim(p_reason), ''), 'Rejected by moderator.')
        else null
      end,
      gallery_publication_id = case when p_action = 'approved' then p_publication_id else null end,
      thumbnail_revision_id = case when p_action = 'approved' then p_thumbnail_revision_id else null end,
      thumbnail_storage_path = case when p_action = 'approved' then p_thumbnail_storage_path else null end,
      thumbnail_mime_type = case when p_action = 'approved' then p_thumbnail_mime_type else null end,
      thumbnail_size_bytes = case when p_action = 'approved' then p_thumbnail_size_bytes else null end,
      thumbnail_width = case when p_action = 'approved' then p_thumbnail_width else null end,
      thumbnail_height = case when p_action = 'approved' then p_thumbnail_height else null end
    where id = p_submission_id
    returning * into updated_submission;

    audit_action := p_action;
    audit_reason := case when p_action = 'rejected' then updated_submission.rejection_reason else null end;
  end if;

  insert into public.gallery_moderation_events (
    submission_id,
    moderator_id,
    action,
    reason
  ) values (
    p_submission_id,
    p_moderator_id,
    audit_action,
    audit_reason
  );

  if p_action in ('approved', 'thumbnail') then
    update private.gallery_publication_revisions
    set visible_until = transition_at
    where submission_id = p_submission_id
      and visible_until is null;

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
      p_thumbnail_revision_id,
      p_publication_id,
      p_submission_id,
      transition_at,
      nullif(btrim(updated_submission.title), ''),
      nullif(btrim(updated_submission.caption), ''),
      updated_submission.category,
      left(uploader_display_name, 100),
      updated_submission.created_at,
      updated_submission.reviewed_at,
      'member-gallery',
      case when requires_display_upload then p_public_original_storage_path else current_publication.original_storage_path end,
      case when requires_display_upload then p_public_original_mime_type else current_publication.original_mime_type end,
      case when requires_display_upload then p_public_original_size_bytes else current_publication.original_size_bytes end,
      case when requires_display_upload then p_public_original_width else current_publication.original_width end,
      case when requires_display_upload then p_public_original_height else current_publication.original_height end,
      case when requires_display_upload then public_original_object.id else current_publication.original_storage_object_id end,
      case when requires_display_upload then public_original_object.version else current_publication.original_storage_object_version end,
      case when requires_display_upload then public_original_object.updated_at else current_publication.original_storage_object_updated_at end,
      case when requires_display_upload then p_public_original_sha256 else current_publication.original_sha256 end,
      p_thumbnail_storage_path,
      p_thumbnail_mime_type,
      p_thumbnail_size_bytes,
      p_thumbnail_width,
      p_thumbnail_height,
      thumbnail_object.id,
      thumbnail_object.version,
      thumbnail_object.updated_at,
      p_thumbnail_sha256
    );
  end if;

  if p_action = 'approved' and updated_submission.instagram_opt_in is true then
    instagram_status := case
      when updated_submission.mime_type = 'image/jpeg' then 'queued'
      else 'ineligible'
    end;
    instagram_eligibility_reason := case
      when instagram_status = 'queued' then null
      else 'Instagram v1 publishing supports JPEG images only.'
    end;

    insert into public.gallery_instagram_publish_jobs (
      submission_id,
      status,
      eligibility_reason,
      caption,
      alt_text,
      queued_by
    ) values (
      p_submission_id,
      instagram_status,
      instagram_eligibility_reason,
      left(concat_ws(
        E'\n\n',
        nullif(btrim(updated_submission.title), ''),
        nullif(btrim(updated_submission.caption), ''),
        'Shared from the Mōchirīī guild gallery.'
      ), 2200),
      left(
        'Mōchirīī guild gallery submission: ' ||
          coalesce(nullif(btrim(updated_submission.title), ''), 'Member gallery image'),
        1000
      ),
      p_moderator_id
    )
    returning * into instagram_job;

    insert into public.gallery_instagram_publish_events (
      job_id,
      submission_id,
      actor_id,
      action,
      details
    ) values (
      instagram_job.id,
      p_submission_id,
      p_moderator_id,
      instagram_status,
      jsonb_build_object(
        'reason', instagram_eligibility_reason,
        'mime_type', updated_submission.mime_type
      )
    );
  end if;

  return jsonb_build_object(
    'committed', true,
    'submission', to_jsonb(updated_submission),
    'action', p_action,
    'publicationId', case when p_action in ('approved', 'thumbnail') then p_publication_id else null end,
    'revisionId', case when p_action in ('approved', 'thumbnail') then p_thumbnail_revision_id else null end,
    'instagramJob', case
      when instagram_job.id is null then null
      else jsonb_build_object(
        'id', instagram_job.id,
        'status', instagram_job.status,
        'eligibility_reason', instagram_job.eligibility_reason,
        'created_at', instagram_job.created_at
      )
    end
  );
end;
$$;

revoke all on function public.gallery_commit_moderation(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, text, uuid, text, text, bigint, integer, integer, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.gallery_commit_moderation(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, text, uuid, text, text, bigint, integer, integer, text, uuid, timestamptz
) to service_role;

create or replace function public.gallery_public_feed_page_v2(
  p_limit integer default 24,
  p_snapshot_at timestamptz default null,
  p_after_reviewed_at timestamptz default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_sort text default 'newest',
  p_category text default null,
  p_query text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requested_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
  requested_sort text := lower(coalesce(nullif(btrim(p_sort), ''), 'newest'));
  requested_category text := lower(nullif(btrim(p_category), ''));
  requested_query text := lower(normalize(nullif(btrim(p_query), ''), NFKC));
  requested_snapshot_at timestamptz := coalesce(p_snapshot_at, statement_timestamp());
  has_cursor boolean := p_after_reviewed_at is not null
    or p_after_created_at is not null
    or p_after_id is not null;
  result jsonb;
begin
  if requested_sort not in ('newest', 'oldest') then
    raise exception 'Invalid gallery sort.' using errcode = '22023';
  end if;

  if requested_category in ('all', 'member-submissions') then
    requested_category := null;
  elsif requested_category is not null
    and requested_category not in ('portraits', 'gatherings', 'action', 'scenery', 'companions')
  then
    raise exception 'Invalid gallery category.' using errcode = '22023';
  end if;

  if requested_query is not null and char_length(requested_query) > 80 then
    raise exception 'Gallery search is too long.' using errcode = '22023';
  end if;

  if has_cursor and (
    p_after_reviewed_at is null
    or p_after_created_at is null
    or p_after_id is null
  ) then
    raise exception 'Incomplete gallery cursor.' using errcode = '22023';
  end if;

  if requested_snapshot_at > statement_timestamp() then
    raise exception 'Gallery snapshot cannot be in the future.' using errcode = '22023';
  end if;

  if requested_snapshot_at < statement_timestamp() - interval '10 minutes' then
    raise exception 'Gallery snapshot expired.' using errcode = '22023';
  end if;

  with eligible as (
    select
      publication.publication_id as id,
      publication.id as revision_id,
      publication.title,
      publication.caption,
      publication.public_category,
      publication.original_mime_type as mime_type,
      publication.original_size_bytes as size_bytes,
      publication.source_created_at as created_at,
      publication.source_reviewed_at as reviewed_at,
      publication.thumbnail_size_bytes,
      publication.thumbnail_width,
      publication.thumbnail_height
    from private.gallery_publication_revisions as publication
    join public.gallery_submissions as submission
      on submission.id = publication.submission_id
      and submission.gallery_publication_id = publication.publication_id
      and submission.status = 'approved'
      and submission.reviewed_at is not null
      and submission.reviewed_at <= requested_snapshot_at
    join storage.objects as original_object
      on original_object.id = publication.original_storage_object_id
      and original_object.bucket_id = publication.storage_bucket
      and original_object.name = publication.original_storage_path
      and original_object.version is not distinct from publication.original_storage_object_version
      and original_object.updated_at = publication.original_storage_object_updated_at
    join storage.objects as thumbnail_object
      on thumbnail_object.id = publication.thumbnail_storage_object_id
      and thumbnail_object.bucket_id = publication.storage_bucket
      and thumbnail_object.name = publication.thumbnail_storage_path
      and thumbnail_object.version is not distinct from publication.thumbnail_storage_object_version
      and thumbnail_object.updated_at = publication.thumbnail_storage_object_updated_at
    where publication.visible_from <= requested_snapshot_at
      and (publication.visible_until is null or publication.visible_until > requested_snapshot_at)
      and (case
        when coalesce(original_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (original_object.metadata ->> 'size')::bigint
        else null
      end) = publication.original_size_bytes
      and lower(coalesce(original_object.metadata ->> 'mimetype', '')) = publication.original_mime_type
      and (case
        when coalesce(thumbnail_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (thumbnail_object.metadata ->> 'size')::bigint
        else null
      end) = publication.thumbnail_size_bytes
      and lower(coalesce(thumbnail_object.metadata ->> 'mimetype', '')) = publication.thumbnail_mime_type
  ), searched as (
    select
      eligible.*,
      array['member-submissions', eligible.public_category]::text[] as categories
    from eligible
    where requested_query is null
      or position(
        requested_query in lower(normalize(concat_ws(
          ' ',
          eligible.title,
          eligible.caption,
          eligible.public_category
        ), NFKC))
      ) > 0
  ), filtered as (
    select searched.*
    from searched
    where requested_category is null
      or searched.public_category = requested_category
  ), page_candidates as (
    select
      filtered.*,
      row_number() over (
        order by
          case when requested_sort = 'newest' then filtered.reviewed_at end desc,
          case when requested_sort = 'newest' then filtered.created_at end desc,
          case when requested_sort = 'newest' then filtered.revision_id end desc,
          case when requested_sort = 'oldest' then filtered.reviewed_at end asc,
          case when requested_sort = 'oldest' then filtered.created_at end asc,
          case when requested_sort = 'oldest' then filtered.revision_id end asc
      ) as page_position
    from filtered
    where not has_cursor
      or (
        requested_sort = 'newest'
        and (filtered.reviewed_at, filtered.created_at, filtered.revision_id)
          < (p_after_reviewed_at, p_after_created_at, p_after_id)
      )
      or (
        requested_sort = 'oldest'
        and (filtered.reviewed_at, filtered.created_at, filtered.revision_id)
          > (p_after_reviewed_at, p_after_created_at, p_after_id)
      )
    order by
      case when requested_sort = 'newest' then filtered.reviewed_at end desc,
      case when requested_sort = 'newest' then filtered.created_at end desc,
      case when requested_sort = 'newest' then filtered.revision_id end desc,
      case when requested_sort = 'oldest' then filtered.reviewed_at end asc,
      case when requested_sort = 'oldest' then filtered.created_at end asc,
      case when requested_sort = 'oldest' then filtered.revision_id end asc
    limit requested_limit + 1
  ), visible as (
    select * from page_candidates
    where page_position <= requested_limit
  ), final_cursor as (
    select reviewed_at, created_at, revision_id as id
    from visible
    order by page_position desc
    limit 1
  )
  select jsonb_build_object(
    'schemaVersion', 2,
    'snapshotAt', requested_snapshot_at,
    'snapshotExpiresAt', requested_snapshot_at + interval '10 minutes',
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', visible.id,
            'title', visible.title,
            'caption', visible.caption,
            'category', visible.public_category,
            'categories', visible.categories,
            'mimeType', visible.mime_type,
            'sizeBytes', visible.size_bytes,
            'createdAt', visible.created_at,
            'reviewedAt', visible.reviewed_at,
            'thumbnailSizeBytes', visible.thumbnail_size_bytes,
            'thumbnailWidth', visible.thumbnail_width,
            'thumbnailHeight', visible.thumbnail_height
          )
          order by visible.page_position
        )
        from visible
      ),
      '[]'::jsonb
    ),
    'hasMore', (select count(*) > requested_limit from page_candidates),
    'nextCursor', case
      when (select count(*) > requested_limit from page_candidates)
      then (
        select jsonb_build_object(
          'reviewedAt', final_cursor.reviewed_at,
          'createdAt', final_cursor.created_at,
          'id', final_cursor.id,
          'snapshotAt', requested_snapshot_at
        )
        from final_cursor
      )
      else null
    end,
    'totalEligible', (select count(*) from filtered),
    'sourceApprovedCount', (
      select count(*)
      from public.gallery_submissions as submission
      where submission.status = 'approved'
        and submission.reviewed_at is not null
        and submission.reviewed_at <= requested_snapshot_at
    ),
    'publicationReadyCount', (select count(*) from eligible),
    'facets', (
      select jsonb_build_object(
        'member-submissions', count(*),
        'portraits', count(*) filter (where searched.public_category = 'portraits'),
        'gatherings', count(*) filter (where searched.public_category = 'gatherings'),
        'action', count(*) filter (where searched.public_category = 'action'),
        'scenery', count(*) filter (where searched.public_category = 'scenery'),
        'companions', count(*) filter (where searched.public_category = 'companions')
      )
      from searched
    ),
    'unknownCategoryCount', 0
  )
  into result;

  return result;
end;
$$;

revoke all on function public.gallery_public_feed_page_v2(
  integer, timestamptz, timestamptz, timestamptz, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.gallery_public_feed_page_v2(
  integer, timestamptz, timestamptz, timestamptz, uuid, text, text, text
) to service_role;

drop function if exists public.gallery_public_original_v2(uuid);
drop function if exists public.gallery_reserve_public_media_v2(uuid, text);

-- Resolve the exact immutable media evidence and reserve its byte count in one
-- database transaction. The Edge Function cannot observe a path without also
-- consuming the corresponding public-delivery budget.
create function public.gallery_reserve_public_media_v2(
  p_publication_id uuid,
  p_delivery_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_kind text := lower(nullif(btrim(p_delivery_kind), ''));
  selected_revision_id uuid;
  selected_size_bytes bigint;
  media_evidence jsonb;
  delivery_reservation jsonb;
begin
  if requested_kind is null or requested_kind not in ('thumbnail', 'full') then
    raise exception 'Invalid Gallery media reservation.' using errcode = '22023';
  end if;

  -- Select only the indexed revision identity and immutable byte count before
  -- touching Storage evidence. Known-ID traffic that has exhausted the public
  -- budget must return without paying for either Storage join.
  select
    publication.id,
    case
      when requested_kind = 'thumbnail' then publication.thumbnail_size_bytes
      else publication.original_size_bytes
    end
  into selected_revision_id, selected_size_bytes
  from private.gallery_publication_revisions as publication
  join public.gallery_submissions as submission
    on submission.id = publication.submission_id
  where publication.publication_id = p_publication_id
    and (
      publication.visible_until is null
      or publication.visible_until > statement_timestamp() - interval '1 hour'
    )
    and submission.status = 'approved'
  order by (publication.visible_until is null) desc, publication.visible_from desc
  limit 1;

  if selected_revision_id is null or selected_size_bytes is null then
    return null;
  end if;

  delivery_reservation := public.gallery_reserve_public_delivery(
    requested_kind,
    selected_size_bytes
  );

  if coalesce((delivery_reservation ->> 'allowed')::boolean, false) is not true then
    return delivery_reservation;
  end if;

  select jsonb_build_object(
    'id', publication.publication_id,
    'storageBucket', publication.storage_bucket,
    'storagePath', case
      when requested_kind = 'thumbnail' then publication.thumbnail_storage_path
      else publication.original_storage_path
    end,
    'mimeType', case
      when requested_kind = 'thumbnail' then publication.thumbnail_mime_type
      else publication.original_mime_type
    end,
    'sizeBytes', case
      when requested_kind = 'thumbnail' then publication.thumbnail_size_bytes
      else publication.original_size_bytes
    end,
    'width', case
      when requested_kind = 'thumbnail' then publication.thumbnail_width
      else publication.original_width
    end,
    'height', case
      when requested_kind = 'thumbnail' then publication.thumbnail_height
      else publication.original_height
    end,
    'sha256', case
      when requested_kind = 'thumbnail' then publication.thumbnail_sha256
      else publication.original_sha256
    end
  )
  into media_evidence
  from private.gallery_publication_revisions as publication
  join public.gallery_submissions as submission
    on submission.id = publication.submission_id
  join storage.objects as original_object
    on original_object.id = publication.original_storage_object_id
    and original_object.bucket_id = publication.storage_bucket
    and original_object.name = publication.original_storage_path
    and original_object.version is not distinct from publication.original_storage_object_version
    and original_object.updated_at = publication.original_storage_object_updated_at
  join storage.objects as thumbnail_object
    on thumbnail_object.id = publication.thumbnail_storage_object_id
    and thumbnail_object.bucket_id = publication.storage_bucket
    and thumbnail_object.name = publication.thumbnail_storage_path
    and thumbnail_object.version is not distinct from publication.thumbnail_storage_object_version
    and thumbnail_object.updated_at = publication.thumbnail_storage_object_updated_at
  where publication.id = selected_revision_id
    and publication.publication_id = p_publication_id
    and (
      publication.visible_until is null
      or publication.visible_until > statement_timestamp() - interval '1 hour'
    )
    and submission.status = 'approved'
    and (case
      when coalesce(original_object.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (original_object.metadata ->> 'size')::bigint
      else null
    end) = publication.original_size_bytes
    and lower(coalesce(original_object.metadata ->> 'mimetype', '')) = publication.original_mime_type
    and (case
      when coalesce(thumbnail_object.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (thumbnail_object.metadata ->> 'size')::bigint
      else null
    end) = publication.thumbnail_size_bytes
    and lower(coalesce(thumbnail_object.metadata ->> 'mimetype', '')) = publication.thumbnail_mime_type
  limit 1;

  if media_evidence is null then
    return null;
  end if;

  if (media_evidence ->> 'sizeBytes')::bigint <> selected_size_bytes then
    return null;
  end if;

  return delivery_reservation || media_evidence;
end;
$$;

revoke all on function public.gallery_reserve_public_media_v2(uuid, text)
from public, anon, authenticated;
grant execute on function public.gallery_reserve_public_media_v2(uuid, text)
to service_role;

comment on table private.gallery_publication_revisions is
  'Service-only immutable public Gallery revisions retained for bounded cursor snapshots.';

comment on function public.gallery_public_feed_page_v2(
  integer, timestamptz, timestamptz, timestamptz, uuid, text, text, text
) is 'Service-only ten-minute snapshot/keyset page over immutable Gallery publication revisions.';

comment on function public.gallery_reserve_public_media_v2(uuid, text) is
  'Service-only atomic current-publication lookup and exact public byte reservation for one Gallery derivative.';

comment on function public.gallery_reserve_moderation_preview(bigint) is
  'Service-only moderator preview reservation isolated from anonymous public Gallery delivery capacity.';
