begin;

set local lock_timeout = '5s';

create or replace function public.enforce_gallery_original_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.submission_source = 'discord' or new.submission_source = 'discord')
    and row(
      old.user_id,
      old.storage_bucket,
      old.storage_path,
      old.original_filename,
      old.mime_type,
      old.size_bytes,
      old.title,
      old.caption,
      old.category,
      old.submission_source,
      old.discord_guild_id,
      old.discord_channel_id,
      old.discord_message_id,
      old.discord_attachment_id,
      old.discord_user_id,
      old.instagram_opt_in,
      old.instagram_opt_in_at,
      old.instagram_opt_in_source,
      old.instagram_opt_in_copy_version,
      old.source_sha256
    ) is distinct from row(
      new.user_id,
      new.storage_bucket,
      new.storage_path,
      new.original_filename,
      new.mime_type,
      new.size_bytes,
      new.title,
      new.caption,
      new.category,
      new.submission_source,
      new.discord_guild_id,
      new.discord_channel_id,
      new.discord_message_id,
      new.discord_attachment_id,
      new.discord_user_id,
      new.instagram_opt_in,
      new.instagram_opt_in_at,
      new.instagram_opt_in_source,
      new.instagram_opt_in_copy_version,
      new.source_sha256
    ) then
    raise exception 'A Discord gallery source is immutable.' using errcode = '23514';
  end if;

  if (old.status <> 'pending' or new.status <> 'pending')
    and row(old.storage_bucket, old.storage_path, old.mime_type, old.size_bytes)
      is distinct from
        row(new.storage_bucket, new.storage_path, new.mime_type, new.size_bytes)
  then
    raise exception 'A moderated gallery original is immutable.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_gallery_original_immutability()
from public, anon, authenticated;

-- Members may still edit Website-submitted pending metadata, but the signed
-- Discord payload is immutable once the service finalizes it.
drop policy if exists "Users can update their own pending submission metadata"
on public.gallery_submissions;
create policy "Users can update their own pending submission metadata"
on public.gallery_submissions
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and status = 'pending'
  and submission_source = 'website'
)
with check (
  (select auth.uid()) = user_id
  and status = 'pending'
  and submission_source = 'website'
);

-- The whole service-generated namespace is excluded from authenticated
-- INSERT, including before a reservation has a public submission row.
drop policy if exists "Members upload own gallery objects" on storage.objects;
create policy "Members upload own gallery objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'member-gallery'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name not like ((select auth.uid())::text || '/discord-ingest/%')
  and private.member_has_gallery_upload_access((select auth.uid()))
);

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
    and p_object_name not like (p_user_id::text || '/discord-ingest/%')
    and case
      when exists (
        select 1
        from public.gallery_submissions as submission
        where submission.user_id = p_user_id
          and submission.storage_bucket = p_bucket_id
          and submission.storage_path = p_object_name
      ) then coalesce(
        (
          select submission.status = 'pending'
            and submission.submission_source = 'website'
          from public.gallery_submissions as submission
          where submission.user_id = p_user_id
            and submission.storage_bucket = p_bucket_id
            and submission.storage_path = p_object_name
          limit 1
        ),
        false
      )
      else p_allow_orphan and not exists (
        select 1
        from private.discord_gallery_ingest_reservations as reservation
        where reservation.storage_path = p_object_name
      )
    end;
$$;

revoke all on function private.member_gallery_original_mutation_allowed(
  uuid,
  text,
  text,
  boolean
) from public, anon, authenticated, service_role;
grant execute on function private.member_gallery_original_mutation_allowed(
  uuid,
  text,
  text,
  boolean
) to authenticated;

drop policy if exists "Members update own pending gallery originals"
on storage.objects;
create policy "Members update own pending gallery originals"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'member-gallery'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.member_has_gallery_upload_access((select auth.uid()))
  and private.member_gallery_original_mutation_allowed(
    (select auth.uid()),
    storage.objects.bucket_id,
    storage.objects.name,
    false
  )
)
with check (
  bucket_id = 'member-gallery'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.member_has_gallery_upload_access((select auth.uid()))
  and private.member_gallery_original_mutation_allowed(
    (select auth.uid()),
    storage.objects.bucket_id,
    storage.objects.name,
    false
  )
);

drop policy if exists "Members delete own pending or orphaned gallery originals"
on storage.objects;
create policy "Members delete own pending or orphaned gallery originals"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'member-gallery'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.member_has_gallery_upload_access((select auth.uid()))
  and private.member_gallery_original_mutation_allowed(
    (select auth.uid()),
    storage.objects.bucket_id,
    storage.objects.name,
    true
  )
);

-- Keep the original RPC for migration compatibility but remove its external
-- service grant. New callers must supply the immutable source digest to the
-- checked wrapper, which also compares the ready reservation and exact Storage
-- object id/version under the same transaction.
revoke all on function public.gallery_commit_moderation(
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  bigint,
  uuid
) from public, anon, authenticated, service_role;

create or replace function public.gallery_commit_moderation_checked(
  p_submission_id uuid,
  p_moderator_id uuid,
  p_action text,
  p_reason text default null,
  p_thumbnail_revision_id uuid default null,
  p_thumbnail_storage_path text default null,
  p_thumbnail_mime_type text default null,
  p_thumbnail_size_bytes bigint default null,
  p_expected_thumbnail_revision_id uuid default null,
  p_expected_source_sha256 text default null
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
  current_submission public.gallery_submissions%rowtype;
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

  select *
  into current_submission
  from public.gallery_submissions
  where id = p_submission_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'committed', false,
      'reason', 'submission_not_found'
    );
  end if;

  if current_submission.submission_source = 'discord' then
    if coalesce(p_expected_source_sha256, '') !~ '^[0-9a-f]{64}$'
      or p_expected_source_sha256 is distinct from current_submission.source_sha256 then
      return pg_catalog.jsonb_build_object(
        'committed', false,
        'reason', 'source_digest_mismatch'
      );
    end if;

    select *
    into reservation
    from private.discord_gallery_ingest_reservations
    where discord_message_id = current_submission.discord_message_id
      and discord_attachment_id = current_submission.discord_attachment_id
      and state = 'ready'
      and submission_id = current_submission.id
    for key share;

    if not found
      or reservation.user_id <> current_submission.user_id
      or reservation.discord_guild_id <> current_submission.discord_guild_id
      or reservation.discord_channel_id <> current_submission.discord_channel_id
      or reservation.discord_user_id <> current_submission.discord_user_id
      or reservation.storage_path <> current_submission.storage_path
      or reservation.mime_type <> current_submission.mime_type
      or reservation.size_bytes <> current_submission.size_bytes
      or reservation.source_sha256 <> current_submission.source_sha256 then
      return pg_catalog.jsonb_build_object(
        'committed', false,
        'reason', 'source_reservation_mismatch'
      );
    end if;

    select
      object.id,
      object.version,
      object.metadata,
      object.user_metadata
    into object_row
    from storage.objects as object
    where object.bucket_id = current_submission.storage_bucket
      and object.name = current_submission.storage_path
    for key share;

    if not found
      or object_row.id is distinct from reservation.storage_object_id
      or object_row.version is distinct from reservation.storage_object_version
      or (case
        when coalesce(object_row.metadata ->> 'size', '') ~ '^[0-9]{1,10}$'
          then (object_row.metadata ->> 'size')::bigint
        else null
      end) is distinct from current_submission.size_bytes
      or lower(coalesce(object_row.metadata ->> 'mimetype', ''))
        <> current_submission.mime_type
      or object_row.user_metadata ->> 'sourceSha256'
        is distinct from current_submission.source_sha256
      or object_row.user_metadata ->> 'validatorVersion'
        is distinct from 'gallery-source-v1' then
      return pg_catalog.jsonb_build_object(
        'committed', false,
        'reason', 'source_object_changed'
      );
    end if;
  elsif p_expected_source_sha256 is not null then
    return pg_catalog.jsonb_build_object(
      'committed', false,
      'reason', 'unexpected_source_digest'
    );
  end if;

  return public.gallery_commit_moderation(
    p_submission_id,
    p_moderator_id,
    p_action,
    p_reason,
    p_thumbnail_revision_id,
    p_thumbnail_storage_path,
    p_thumbnail_mime_type,
    p_thumbnail_size_bytes,
    p_expected_thumbnail_revision_id
  );
end;
$$;

revoke all on function public.gallery_commit_moderation_checked(
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  bigint,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.gallery_commit_moderation_checked(
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  bigint,
  uuid,
  text
) to service_role;

comment on column public.gallery_submissions.source_sha256 is
  'Lowercase SHA-256 of a receiver-validated Discord original; null for legacy and Website uploads.';
comment on function public.gallery_commit_moderation_checked(
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  bigint,
  uuid,
  text
) is 'CAS wrapper requiring a ready Discord ingest reservation and unchanged Storage object before moderation.';

commit;
