begin;

set local lock_timeout = '5s';

alter table public.gallery_submissions
  add column source_sha256 text;

alter table public.gallery_submissions
  add constraint gallery_submissions_source_sha256_check
  check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$') not valid;

-- Authorization context now binds the configured guild at the signed request
-- boundary. Keep the durable row constraint canonical without embedding a
-- private provider identifier in source.
alter table public.gallery_submissions
  drop constraint gallery_submissions_discord_source_required_check;
alter table public.gallery_submissions
  add constraint gallery_submissions_discord_source_required_check
  check (
    submission_source <> 'discord'
    or (
      discord_guild_id is not null
      and discord_channel_id is not null
      and discord_message_id is not null
      and discord_attachment_id is not null
      and discord_user_id is not null
    )
  ) not valid;

alter table public.gallery_submissions
  drop constraint gallery_submissions_discord_id_format_check;
alter table public.gallery_submissions
  add constraint gallery_submissions_discord_id_format_check
  check (
    (
      discord_guild_id is null
      or (
        discord_guild_id ~ '^[1-9][0-9]{15,19}$'
        and discord_guild_id::numeric <= 18446744073709551615
      )
    )
    and (
      discord_channel_id is null
      or (
        discord_channel_id ~ '^[1-9][0-9]{15,19}$'
        and discord_channel_id::numeric <= 18446744073709551615
      )
    )
    and (
      discord_message_id is null
      or (
        discord_message_id ~ '^[1-9][0-9]{15,19}$'
        and discord_message_id::numeric <= 18446744073709551615
      )
    )
    and (
      discord_attachment_id is null
      or (
        discord_attachment_id ~ '^[1-9][0-9]{15,19}$'
        and discord_attachment_id::numeric <= 18446744073709551615
      )
    )
    and (
      discord_user_id is null
      or (
        discord_user_id ~ '^[1-9][0-9]{15,19}$'
        and discord_user_id::numeric <= 18446744073709551615
      )
    )
  ) not valid;

create or replace function private.discord_gallery_ingest_snowflake_is_canonical(
  p_value text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[1-9][0-9]{15,19}$' then
    return false;
  end if;
  return p_value::numeric <= 18446744073709551615;
end;
$$;

revoke all on function private.discord_gallery_ingest_snowflake_is_canonical(text)
from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'objects'
      and column_name = 'user_metadata'
      and data_type = 'jsonb'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'objects'
      and column_name = 'version'
      and data_type = 'text'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'objects'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    raise exception 'discord_gallery_ingest_storage_schema_incompatible'
      using errcode = '55000';
  end if;
end;
$$;

-- A private reservation gives every lease generation its own object path. A
-- writer whose lease expires can finish only against its old path; takeover
-- rotates the reservation to a new path before the successor uploads. This
-- prevents an outliving Storage request from overwriting the successor's ready
-- object without deleting an object that another invocation may still own.
create table private.discord_gallery_ingest_reservations (
  discord_message_id text not null,
  discord_attachment_id text not null,
  user_id uuid not null,
  discord_guild_id text not null,
  discord_channel_id text not null,
  discord_user_id text not null,
  storage_path text not null,
  source_sha256 text not null,
  mime_type text not null,
  size_bytes bigint not null,
  original_filename text not null,
  title text,
  caption text,
  instagram_opt_in boolean not null,
  state text not null default 'reserved',
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  storage_object_id uuid,
  storage_object_version text,
  submission_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (discord_message_id, discord_attachment_id),
  unique (storage_path),
  constraint discord_gallery_ingest_reservations_message_id_check
    check (
      discord_message_id ~ '^[1-9][0-9]{15,19}$'
      and discord_message_id::numeric <= 18446744073709551615
    ),
  constraint discord_gallery_ingest_reservations_attachment_id_check
    check (
      discord_attachment_id ~ '^[1-9][0-9]{15,19}$'
      and discord_attachment_id::numeric <= 18446744073709551615
    ),
  constraint discord_gallery_ingest_reservations_context_ids_check
    check (
      discord_guild_id ~ '^[1-9][0-9]{15,19}$'
      and discord_guild_id::numeric <= 18446744073709551615
      and discord_channel_id ~ '^[1-9][0-9]{15,19}$'
      and discord_channel_id::numeric <= 18446744073709551615
      and discord_user_id ~ '^[1-9][0-9]{15,19}$'
      and discord_user_id::numeric <= 18446744073709551615
    ),
  constraint discord_gallery_ingest_reservations_storage_path_check
    check (
      storage_path like (user_id::text || '/discord-ingest/%')
      and char_length(storage_path) <= 512
    ),
  constraint discord_gallery_ingest_reservations_sha256_check
    check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint discord_gallery_ingest_reservations_mime_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint discord_gallery_ingest_reservations_size_check
    check (size_bytes between 1 and 8388608),
  constraint discord_gallery_ingest_reservations_filename_check
    check (char_length(original_filename) between 1 and 255),
  constraint discord_gallery_ingest_reservations_title_check
    check (title is null or char_length(title) between 1 and 80),
  constraint discord_gallery_ingest_reservations_caption_check
    check (caption is null or char_length(caption) between 1 and 300),
  constraint discord_gallery_ingest_reservations_state_check
    check (state in ('reserved', 'uploaded', 'ready')),
  constraint discord_gallery_ingest_reservations_ready_check
    check (
      (
        state = 'reserved'
        and storage_object_id is null
        and storage_object_version is null
        and submission_id is null
      )
      or (
        state = 'uploaded'
        and storage_object_id is not null
        and nullif(storage_object_version, '') is not null
        and submission_id is null
      )
      or (
        state = 'ready'
        and storage_object_id is not null
        and nullif(storage_object_version, '') is not null
        and submission_id is not null
      )
    ),
  constraint discord_gallery_ingest_reservations_lease_check
    check (lease_expires_at > created_at - interval '5 seconds')
);

create index discord_gallery_ingest_reservations_lease_idx
on private.discord_gallery_ingest_reservations (state, lease_expires_at);

alter table private.discord_gallery_ingest_reservations enable row level security;
alter table private.discord_gallery_ingest_reservations force row level security;
revoke all on table private.discord_gallery_ingest_reservations
from public, anon, authenticated, service_role;

create policy discord_gallery_ingest_reservations_default_deny
on private.discord_gallery_ingest_reservations
as restrictive
for all
to public
using (false)
with check (false);

create or replace function public.acquire_discord_gallery_ingest_reservation(
  p_user_id uuid,
  p_guild_id text,
  p_channel_id text,
  p_message_id text,
  p_attachment_id text,
  p_discord_user_id text,
  p_source_sha256 text,
  p_mime_type text,
  p_size_bytes bigint,
  p_original_filename text,
  p_title text,
  p_caption text,
  p_instagram_opt_in boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  request_time timestamptz := statement_timestamp();
  new_token uuid := gen_random_uuid();
  extension text;
  new_path text;
  inserted_rows integer := 0;
  reservation private.discord_gallery_ingest_reservations%rowtype;
  existing_submission record;
  object_row record;
  storage_object_matches boolean := false;
begin
  if request_role is distinct from 'service_role'
    and not (
      session_user in ('postgres', 'supabase_admin')
      and coalesce(pg_catalog.current_setting('role', true), 'none')
        in ('none', 'postgres', 'supabase_admin')
    ) then
    raise exception 'gallery_ingest_service_role_required'
      using errcode = '42501';
  end if;

  if p_user_id is null
    or private.discord_gallery_ingest_snowflake_is_canonical(p_guild_id) is not true
    or private.discord_gallery_ingest_snowflake_is_canonical(p_channel_id) is not true
    or private.discord_gallery_ingest_snowflake_is_canonical(p_message_id) is not true
    or private.discord_gallery_ingest_snowflake_is_canonical(p_attachment_id) is not true
    or private.discord_gallery_ingest_snowflake_is_canonical(p_discord_user_id) is not true
    or coalesce(p_source_sha256, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_mime_type, '') not in ('image/jpeg', 'image/png', 'image/webp')
    or p_size_bytes is null
    or p_size_bytes not between 1 and 8388608
    or p_original_filename is null
    or char_length(p_original_filename) not between 1 and 255
    or (p_title is not null and char_length(p_title) not between 1 and 80)
    or (p_caption is not null and char_length(p_caption) not between 1 and 300)
    or p_instagram_opt_in is null then
    return pg_catalog.jsonb_build_object('outcome', 'invalid');
  end if;

  extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    else 'webp'
  end;
  new_path := p_user_id::text || '/discord-ingest/' ||
    new_token::text || '.' || extension;

  insert into private.discord_gallery_ingest_reservations (
    discord_message_id,
    discord_attachment_id,
    user_id,
    discord_guild_id,
    discord_channel_id,
    discord_user_id,
    storage_path,
    source_sha256,
    mime_type,
    size_bytes,
    original_filename,
    title,
    caption,
    instagram_opt_in,
    lease_token,
    lease_expires_at
  ) values (
    p_message_id,
    p_attachment_id,
    p_user_id,
    p_guild_id,
    p_channel_id,
    p_discord_user_id,
    new_path,
    p_source_sha256,
    p_mime_type,
    p_size_bytes,
    p_original_filename,
    p_title,
    p_caption,
    p_instagram_opt_in,
    new_token,
    request_time + interval '2 minutes'
  )
  on conflict (discord_message_id, discord_attachment_id) do nothing;
  get diagnostics inserted_rows = row_count;

  select *
  into strict reservation
  from private.discord_gallery_ingest_reservations
  where discord_message_id = p_message_id
    and discord_attachment_id = p_attachment_id
  for update;

  if reservation.user_id <> p_user_id
    or reservation.discord_guild_id <> p_guild_id
    or reservation.discord_channel_id <> p_channel_id
    or reservation.discord_user_id <> p_discord_user_id
    or reservation.source_sha256 <> p_source_sha256
    or reservation.mime_type <> p_mime_type
    or reservation.size_bytes <> p_size_bytes
    or reservation.original_filename <> p_original_filename
    or reservation.title is distinct from p_title
    or reservation.caption is distinct from p_caption
    or reservation.instagram_opt_in <> p_instagram_opt_in then
    return pg_catalog.jsonb_build_object('outcome', 'conflict');
  end if;

  -- Recheck after the reservation lock so a predecessor deployed during an
  -- approved cutover cannot race a legacy insert past the first lookup.
  select
    submission.id,
    submission.user_id,
    submission.storage_bucket,
    submission.storage_path,
    submission.original_filename,
    submission.mime_type,
    submission.size_bytes,
    submission.title,
    submission.caption,
    submission.category,
    submission.submission_source,
    submission.discord_guild_id,
    submission.discord_channel_id,
    submission.discord_message_id,
    submission.discord_attachment_id,
    submission.discord_user_id,
    submission.instagram_opt_in,
    submission.instagram_opt_in_at,
    submission.instagram_opt_in_source,
    submission.instagram_opt_in_copy_version,
    submission.source_sha256,
    submission.status,
    submission.created_at
  into existing_submission
  from public.gallery_submissions as submission
  where submission.submission_source = 'discord'
    and submission.discord_message_id = p_message_id
    and submission.discord_attachment_id = p_attachment_id
  limit 1;

  if found then
    select
      object.id,
      object.version,
      object.metadata,
      object.user_metadata
    into object_row
    from storage.objects as object
    where object.bucket_id = 'member-gallery'
      and object.name = reservation.storage_path
    for key share;

    storage_object_matches := found
      and object_row.id is not distinct from reservation.storage_object_id
      and object_row.version is not distinct from reservation.storage_object_version
      and (case
        when coalesce(object_row.metadata ->> 'size', '') ~ '^[0-9]{1,10}$'
          then (object_row.metadata ->> 'size')::bigint
        else null
      end) is not distinct from reservation.size_bytes
      and lower(coalesce(object_row.metadata ->> 'mimetype', ''))
        = reservation.mime_type
      and object_row.user_metadata ->> 'sourceSha256'
        is not distinct from reservation.source_sha256
      and object_row.user_metadata ->> 'validatorVersion'
        is not distinct from 'gallery-source-v1';

    if reservation.state in ('uploaded', 'ready')
      and reservation.storage_object_id is not null
      and nullif(reservation.storage_object_version, '') is not null
      and storage_object_matches
      and existing_submission.user_id = reservation.user_id
      and existing_submission.storage_bucket = 'member-gallery'
      and existing_submission.storage_path = reservation.storage_path
      and existing_submission.original_filename = reservation.original_filename
      and existing_submission.mime_type = reservation.mime_type
      and existing_submission.size_bytes = reservation.size_bytes
      and existing_submission.title is not distinct from reservation.title
      and existing_submission.caption is not distinct from reservation.caption
      and existing_submission.category = 'discord'
      and existing_submission.submission_source = 'discord'
      and existing_submission.discord_guild_id = reservation.discord_guild_id
      and existing_submission.discord_channel_id = reservation.discord_channel_id
      and existing_submission.discord_message_id = reservation.discord_message_id
      and existing_submission.discord_attachment_id = reservation.discord_attachment_id
      and existing_submission.discord_user_id = reservation.discord_user_id
      and existing_submission.instagram_opt_in = reservation.instagram_opt_in
      and (
        (
          reservation.instagram_opt_in
          and existing_submission.instagram_opt_in_at is not null
          and existing_submission.instagram_opt_in_source = 'discord_slash_command'
          and existing_submission.instagram_opt_in_copy_version = '2026-06-discord-submit-v1'
        )
        or (
          not reservation.instagram_opt_in
          and existing_submission.instagram_opt_in_at is null
          and existing_submission.instagram_opt_in_source is null
          and existing_submission.instagram_opt_in_copy_version is null
        )
      )
      and existing_submission.source_sha256 = reservation.source_sha256 then
      if reservation.state = 'uploaded' then
        update private.discord_gallery_ingest_reservations
        set
          state = 'ready',
          submission_id = existing_submission.id,
          updated_at = request_time
        where discord_message_id = p_message_id
          and discord_attachment_id = p_attachment_id;
      elsif reservation.submission_id is distinct from existing_submission.id then
        return pg_catalog.jsonb_build_object('outcome', 'conflict');
      end if;
      return pg_catalog.jsonb_build_object(
        'outcome', 'ready',
        'submissionId', existing_submission.id,
        'status', existing_submission.status,
        'createdAt', existing_submission.created_at
      );
    end if;
    if inserted_rows = 1 then
      delete from private.discord_gallery_ingest_reservations
      where discord_message_id = p_message_id
        and discord_attachment_id = p_attachment_id;
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'conflict');
  end if;

  if reservation.state = 'ready' then
    return pg_catalog.jsonb_build_object('outcome', 'tombstoned');
  end if;

  if inserted_rows = 1 then
    return pg_catalog.jsonb_build_object(
      'outcome', 'acquired',
      'leaseToken', reservation.lease_token,
      'leaseExpiresAt', reservation.lease_expires_at,
      'storagePath', reservation.storage_path
    );
  end if;

  if reservation.state in ('reserved', 'uploaded')
    and reservation.lease_expires_at > request_time then
    return pg_catalog.jsonb_build_object('outcome', 'busy');
  end if;

  update private.discord_gallery_ingest_reservations
  set
    state = 'reserved',
    storage_path = new_path,
    storage_object_id = null,
    storage_object_version = null,
    submission_id = null,
    lease_token = new_token,
    lease_expires_at = request_time + interval '2 minutes',
    updated_at = request_time
  where discord_message_id = p_message_id
    and discord_attachment_id = p_attachment_id
  returning * into strict reservation;

  return pg_catalog.jsonb_build_object(
    'outcome', 'acquired',
    'leaseToken', reservation.lease_token,
    'leaseExpiresAt', reservation.lease_expires_at,
    'storagePath', reservation.storage_path
  );
end;
$$;

create or replace function public.confirm_discord_gallery_ingest_upload(
  p_message_id text,
  p_attachment_id text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  request_time timestamptz := statement_timestamp();
  reservation private.discord_gallery_ingest_reservations%rowtype;
  object_row record;
begin
  if request_role is distinct from 'service_role'
    and not (
      session_user in ('postgres', 'supabase_admin')
      and coalesce(pg_catalog.current_setting('role', true), 'none')
        in ('none', 'postgres', 'supabase_admin')
    ) then
    raise exception 'gallery_ingest_service_role_required'
      using errcode = '42501';
  end if;

  if private.discord_gallery_ingest_snowflake_is_canonical(p_message_id) is not true
    or private.discord_gallery_ingest_snowflake_is_canonical(p_attachment_id) is not true
    or p_lease_token is null then
    return pg_catalog.jsonb_build_object('outcome', 'invalid');
  end if;

  select *
  into reservation
  from private.discord_gallery_ingest_reservations
  where discord_message_id = p_message_id
    and discord_attachment_id = p_attachment_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'missing');
  end if;
  if reservation.state = 'ready' then
    return pg_catalog.jsonb_build_object('outcome', 'ready');
  end if;
  if reservation.lease_token <> p_lease_token
    or reservation.lease_expires_at <= request_time then
    return pg_catalog.jsonb_build_object('outcome', 'busy');
  end if;

  select
    object.id,
    object.version,
    object.metadata,
    object.user_metadata
  into object_row
  from storage.objects as object
  where object.bucket_id = 'member-gallery'
    and object.name = reservation.storage_path
  for key share;

  if not found
    or object_row.id is null
    or nullif(object_row.version, '') is null
    or (case
      when coalesce(object_row.metadata ->> 'size', '') ~ '^[0-9]{1,10}$'
        then (object_row.metadata ->> 'size')::bigint
      else null
    end) is distinct from reservation.size_bytes
    or lower(coalesce(object_row.metadata ->> 'mimetype', ''))
      <> reservation.mime_type
    or object_row.user_metadata ->> 'sourceSha256'
      is distinct from reservation.source_sha256
    or object_row.user_metadata ->> 'validatorVersion'
      is distinct from 'gallery-source-v1' then
    return pg_catalog.jsonb_build_object('outcome', 'object_mismatch');
  end if;

  update private.discord_gallery_ingest_reservations
  set
    state = 'uploaded',
    storage_object_id = object_row.id,
    storage_object_version = object_row.version,
    updated_at = request_time
  where discord_message_id = reservation.discord_message_id
    and discord_attachment_id = reservation.discord_attachment_id;

  return pg_catalog.jsonb_build_object('outcome', 'confirmed');
end;
$$;

create or replace function public.finalize_discord_gallery_ingest_reservation(
  p_message_id text,
  p_attachment_id text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  request_time timestamptz := statement_timestamp();
  reservation private.discord_gallery_ingest_reservations%rowtype;
  object_row record;
  submission record;
  created boolean := false;
  storage_object_matches boolean := false;
begin
  if request_role is distinct from 'service_role'
    and not (
      session_user in ('postgres', 'supabase_admin')
      and coalesce(pg_catalog.current_setting('role', true), 'none')
        in ('none', 'postgres', 'supabase_admin')
    ) then
    raise exception 'gallery_ingest_service_role_required'
      using errcode = '42501';
  end if;

  if private.discord_gallery_ingest_snowflake_is_canonical(p_message_id) is not true
    or private.discord_gallery_ingest_snowflake_is_canonical(p_attachment_id) is not true
    or p_lease_token is null then
    return pg_catalog.jsonb_build_object('outcome', 'invalid');
  end if;

  select *
  into reservation
  from private.discord_gallery_ingest_reservations
  where discord_message_id = p_message_id
    and discord_attachment_id = p_attachment_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'missing');
  end if;

  if reservation.state = 'ready' then
    select
      existing.id,
      existing.user_id,
      existing.storage_bucket,
      existing.storage_path,
      existing.original_filename,
      existing.mime_type,
      existing.size_bytes,
      existing.title,
      existing.caption,
      existing.category,
      existing.submission_source,
      existing.discord_guild_id,
      existing.discord_channel_id,
      existing.discord_message_id,
      existing.discord_attachment_id,
      existing.discord_user_id,
      existing.instagram_opt_in,
      existing.instagram_opt_in_at,
      existing.instagram_opt_in_source,
      existing.instagram_opt_in_copy_version,
      existing.source_sha256,
      existing.status,
      existing.created_at
    into submission
    from public.gallery_submissions as existing
    where existing.id = reservation.submission_id
      and existing.submission_source = 'discord';

    if found then
      select
        object.id,
        object.version,
        object.metadata,
        object.user_metadata
      into object_row
      from storage.objects as object
      where object.bucket_id = 'member-gallery'
        and object.name = reservation.storage_path
      for key share;

      storage_object_matches := found
        and object_row.id is not distinct from reservation.storage_object_id
        and object_row.version is not distinct from reservation.storage_object_version
        and (case
          when coalesce(object_row.metadata ->> 'size', '') ~ '^[0-9]{1,10}$'
            then (object_row.metadata ->> 'size')::bigint
          else null
        end) is not distinct from reservation.size_bytes
        and lower(coalesce(object_row.metadata ->> 'mimetype', ''))
          = reservation.mime_type
        and object_row.user_metadata ->> 'sourceSha256'
          is not distinct from reservation.source_sha256
        and object_row.user_metadata ->> 'validatorVersion'
          is not distinct from 'gallery-source-v1';
    end if;

    if storage_object_matches
      and submission.user_id = reservation.user_id
      and submission.storage_bucket = 'member-gallery'
      and submission.storage_path = reservation.storage_path
      and submission.original_filename = reservation.original_filename
      and submission.mime_type = reservation.mime_type
      and submission.size_bytes = reservation.size_bytes
      and submission.title is not distinct from reservation.title
      and submission.caption is not distinct from reservation.caption
      and submission.category = 'discord'
      and submission.submission_source = 'discord'
      and submission.discord_guild_id = reservation.discord_guild_id
      and submission.discord_channel_id = reservation.discord_channel_id
      and submission.discord_message_id = reservation.discord_message_id
      and submission.discord_attachment_id = reservation.discord_attachment_id
      and submission.discord_user_id = reservation.discord_user_id
      and submission.instagram_opt_in = reservation.instagram_opt_in
      and (
        (
          reservation.instagram_opt_in
          and submission.instagram_opt_in_at is not null
          and submission.instagram_opt_in_source = 'discord_slash_command'
          and submission.instagram_opt_in_copy_version = '2026-06-discord-submit-v1'
        )
        or (
          not reservation.instagram_opt_in
          and submission.instagram_opt_in_at is null
          and submission.instagram_opt_in_source is null
          and submission.instagram_opt_in_copy_version is null
        )
      )
      and submission.source_sha256 = reservation.source_sha256 then
      return pg_catalog.jsonb_build_object(
        'outcome', 'ready',
        'submissionId', submission.id,
        'status', submission.status,
        'createdAt', submission.created_at
      );
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'conflict');
  end if;

  if reservation.state <> 'uploaded'
    or reservation.lease_token <> p_lease_token
    or reservation.lease_expires_at <= request_time then
    return pg_catalog.jsonb_build_object('outcome', 'busy');
  end if;

  select
    object.id,
    object.version,
    object.metadata,
    object.user_metadata
  into object_row
  from storage.objects as object
  where object.bucket_id = 'member-gallery'
    and object.name = reservation.storage_path
  for key share;

  if not found
    or object_row.id is distinct from reservation.storage_object_id
    or object_row.version is distinct from reservation.storage_object_version
    or (case
      when coalesce(object_row.metadata ->> 'size', '') ~ '^[0-9]{1,10}$'
        then (object_row.metadata ->> 'size')::bigint
      else null
    end) is distinct from reservation.size_bytes
    or lower(coalesce(object_row.metadata ->> 'mimetype', ''))
      <> reservation.mime_type
    or object_row.user_metadata ->> 'sourceSha256'
      is distinct from reservation.source_sha256
    or object_row.user_metadata ->> 'validatorVersion'
      is distinct from 'gallery-source-v1' then
    return pg_catalog.jsonb_build_object('outcome', 'object_changed');
  end if;

  begin
    insert into public.gallery_submissions (
      user_id,
      storage_bucket,
      storage_path,
      original_filename,
      mime_type,
      size_bytes,
      source_sha256,
      title,
      caption,
      category,
      status,
      submission_source,
      discord_guild_id,
      discord_channel_id,
      discord_message_id,
      discord_attachment_id,
      discord_user_id,
      instagram_opt_in,
      instagram_opt_in_at,
      instagram_opt_in_source,
      instagram_opt_in_copy_version
    ) values (
      reservation.user_id,
      'member-gallery',
      reservation.storage_path,
      reservation.original_filename,
      reservation.mime_type,
      reservation.size_bytes,
      reservation.source_sha256,
      reservation.title,
      reservation.caption,
      'discord',
      'pending',
      'discord',
      reservation.discord_guild_id,
      reservation.discord_channel_id,
      reservation.discord_message_id,
      reservation.discord_attachment_id,
      reservation.discord_user_id,
      reservation.instagram_opt_in,
      case when reservation.instagram_opt_in then request_time else null end,
      case when reservation.instagram_opt_in then 'discord_slash_command' else null end,
      case when reservation.instagram_opt_in then '2026-06-discord-submit-v1' else null end
    )
    returning id, user_id, discord_user_id, storage_path, status, created_at
    into submission;
    created := true;
  exception
    when unique_violation then
      select
        existing.id,
        existing.user_id,
        existing.storage_bucket,
        existing.storage_path,
        existing.original_filename,
        existing.mime_type,
        existing.size_bytes,
        existing.title,
        existing.caption,
        existing.category,
        existing.submission_source,
        existing.discord_guild_id,
        existing.discord_channel_id,
        existing.discord_message_id,
        existing.discord_attachment_id,
        existing.discord_user_id,
        existing.instagram_opt_in,
        existing.instagram_opt_in_at,
        existing.instagram_opt_in_source,
        existing.instagram_opt_in_copy_version,
        existing.source_sha256,
        existing.status,
        existing.created_at
      into submission
      from public.gallery_submissions as existing
      where existing.submission_source = 'discord'
        and existing.discord_message_id = reservation.discord_message_id
        and existing.discord_attachment_id = reservation.discord_attachment_id
      limit 1;
      if not found
        or submission.user_id <> reservation.user_id
        or submission.storage_bucket <> 'member-gallery'
        or submission.storage_path <> reservation.storage_path
        or submission.original_filename <> reservation.original_filename
        or submission.mime_type <> reservation.mime_type
        or submission.size_bytes <> reservation.size_bytes
        or submission.title is distinct from reservation.title
        or submission.caption is distinct from reservation.caption
        or submission.category <> 'discord'
        or submission.submission_source <> 'discord'
        or submission.discord_guild_id <> reservation.discord_guild_id
        or submission.discord_channel_id <> reservation.discord_channel_id
        or submission.discord_message_id <> reservation.discord_message_id
        or submission.discord_attachment_id <> reservation.discord_attachment_id
        or submission.discord_user_id <> reservation.discord_user_id
        or submission.instagram_opt_in <> reservation.instagram_opt_in
        or (
          reservation.instagram_opt_in
          and (
            submission.instagram_opt_in_at is null
            or submission.instagram_opt_in_source is distinct from 'discord_slash_command'
            or submission.instagram_opt_in_copy_version is distinct from '2026-06-discord-submit-v1'
          )
        )
        or (
          not reservation.instagram_opt_in
          and (
            submission.instagram_opt_in_at is not null
            or submission.instagram_opt_in_source is not null
            or submission.instagram_opt_in_copy_version is not null
          )
        )
        or submission.source_sha256 is distinct from reservation.source_sha256 then
        raise exception 'gallery_ingest_finalize_conflict'
          using errcode = '23505';
      end if;
  end;

  update private.discord_gallery_ingest_reservations
  set
    state = 'ready',
    submission_id = submission.id,
    updated_at = request_time
  where discord_message_id = reservation.discord_message_id
    and discord_attachment_id = reservation.discord_attachment_id;

  return pg_catalog.jsonb_build_object(
    'outcome', case when created then 'created' else 'ready' end,
    'submissionId', submission.id,
    'status', submission.status,
    'createdAt', submission.created_at
  );
end;
$$;

revoke all on function public.acquire_discord_gallery_ingest_reservation(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  boolean
) from public, anon, authenticated, service_role;
grant execute on function public.acquire_discord_gallery_ingest_reservation(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  boolean
) to service_role;

revoke all on function public.confirm_discord_gallery_ingest_upload(
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_discord_gallery_ingest_upload(
  text,
  text,
  uuid
) to service_role;

revoke all on function public.finalize_discord_gallery_ingest_reservation(
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_discord_gallery_ingest_reservation(
  text,
  text,
  uuid
) to service_role;

comment on table private.discord_gallery_ingest_reservations is
  'Private resumable object-path leases for strict HMAC Discord Gallery ingest; not a publication ledger.';
comment on function public.acquire_discord_gallery_ingest_reservation(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  boolean
) is 'Acquires or resumes one bounded service-role Discord Gallery storage lease.';
comment on function public.confirm_discord_gallery_ingest_upload(
  text,
  text,
  uuid
) is 'Binds an exact Storage object id, version, size, MIME, and validator digest to one active ingest lease.';
comment on function public.finalize_discord_gallery_ingest_reservation(
  text,
  text,
  uuid
) is 'Atomically inserts a reserved Discord Gallery submission and marks the private lease ready.';

alter table public.gallery_submissions
  validate constraint gallery_submissions_source_sha256_check;
alter table public.gallery_submissions
  validate constraint gallery_submissions_discord_source_required_check;
alter table public.gallery_submissions
  validate constraint gallery_submissions_discord_id_format_check;

commit;
