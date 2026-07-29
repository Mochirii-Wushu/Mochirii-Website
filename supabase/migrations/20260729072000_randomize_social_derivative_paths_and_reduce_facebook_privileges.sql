begin;

set local lock_timeout = '5s';

-- The source-bound pipeline is unreleased. Refuse to reinterpret any existing
-- deterministic derivative; a reviewer must quarantine it explicitly.
do $$
begin
  if exists (select 1 from private.gallery_social_derivatives) then
    raise exception
      'Existing gallery social derivatives require manual quarantine before revisioned paths are enabled.';
  end if;
end;
$$;

alter table private.gallery_social_derivatives
  drop constraint if exists gallery_social_derivatives_path_check;
alter table private.gallery_social_derivatives
  add constraint gallery_social_derivatives_path_check
  check (
    storage_path ~ (
      '^_social/submissions/' || submission_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
    )
  );

create or replace function public.gallery_commit_moderation_with_social_derivative(
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
  p_expected_updated_at timestamptz,
  p_social_storage_path text,
  p_social_mime_type text,
  p_social_size_bytes bigint,
  p_social_width integer,
  p_social_height integer,
  p_social_sha256 text,
  p_social_sanitizer_version text,
  p_social_metadata_policy text,
  p_social_source_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_submission public.gallery_submissions%rowtype;
  source_validation private.gallery_source_validations%rowtype;
  source_object storage.objects%rowtype;
  social_object storage.objects%rowtype;
  result jsonb;
  requires_social boolean := false;
  has_social boolean := false;
  inserted_social boolean := false;
  object_size bigint;
  object_mime text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  has_social := num_nonnulls(
    p_social_storage_path,
    p_social_mime_type,
    p_social_size_bytes,
    p_social_width,
    p_social_height,
    p_social_sha256,
    p_social_sanitizer_version,
    p_social_metadata_policy,
    p_social_source_sha256
  ) > 0;

  if p_action = 'approved' then
    select * into current_submission
    from public.gallery_submissions
    where id = p_submission_id
      and status = 'pending'
      and updated_at = p_expected_updated_at
    for update;

    if not found then
      return jsonb_build_object(
        'committed', false,
        'reason', 'submission_revision_conflict',
        'instagramJob', null,
        'facebookPageJob', null
      );
    end if;

    requires_social := (
      current_submission.facebook_page_opt_in is true
      and current_submission.facebook_page_opt_in_source = 'website_upload'
      and current_submission.facebook_page_opt_in_copy_version =
        '2026-07-website-public-facebook-page-group-v2'
      and current_submission.facebook_page_opt_in_contract_version =
        '2026-07-website-public-facebook-page-group-v2'
    ) or (
      current_submission.instagram_opt_in is true
      and current_submission.instagram_opt_in_source = 'website_upload'
      and current_submission.instagram_opt_in_copy_version =
        '2026-07-website-public-instagram-publish-v2'
      and current_submission.instagram_opt_in_contract_version =
        '2026-07-website-public-instagram-publish-v2'
    );

    if has_social then
      if requires_social is not true or coalesce(
        p_social_storage_path ~ (
          '^_social/submissions/' || p_submission_id::text ||
          '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
        )
        and p_social_mime_type = 'image/jpeg'
        and p_social_size_bytes between 1 and 8388608
        and p_social_width between 320 and 1440
        and p_social_height between 1 and 1800
        and p_social_width * 5 >= p_social_height * 4
        and p_social_width * 100 <= p_social_height * 191
        and p_social_sha256 ~ '^[0-9a-f]{64}$'
        and p_social_source_sha256 ~ '^[0-9a-f]{64}$'
        and p_social_sanitizer_version = 'gallery-social-jpeg-v1'
        and p_social_metadata_policy = 'jfif-only-no-app-metadata-v1',
        false
      ) is not true then
        raise exception
          'Invalid source-bound social derivative evidence.'
          using errcode = '23514';
      end if;

      select * into source_validation
      from private.gallery_source_validations
      where submission_id = current_submission.id
        and storage_bucket = current_submission.storage_bucket
        and storage_path = current_submission.storage_path
        and source_mime_type = current_submission.mime_type
        and source_mime_type = 'image/jpeg'
        and source_size_bytes = current_submission.size_bytes
        and source_width = p_social_width
        and source_height = p_social_height
        and source_sha256 = p_social_source_sha256
        and validator_version = 'gallery-source-v1';

      if not found then
        raise exception
          'The social derivative is not bound to the validated consented source.'
          using errcode = '23514';
      end if;

      select * into source_object
      from storage.objects
      where id = source_validation.storage_object_id
        and bucket_id = source_validation.storage_bucket
        and name = source_validation.storage_path
        and version is not distinct from source_validation.storage_object_version
        and updated_at = source_validation.storage_object_updated_at
      for update;

      if not found then
        raise exception
          'The consented source Storage object changed after validation.'
          using errcode = '23514';
      end if;

      object_size := case
        when coalesce(source_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (source_object.metadata ->> 'size')::bigint
        else null
      end;
      object_mime := lower(coalesce(source_object.metadata ->> 'mimetype', ''));
      if object_size is distinct from source_validation.source_size_bytes
        or object_mime <> source_validation.source_mime_type
      then
        raise exception
          'The consented source Storage evidence does not match.'
          using errcode = '23514';
      end if;

      select * into social_object
      from storage.objects
      where bucket_id = 'member-gallery'
        and name = p_social_storage_path
      for update;

      if not found then
        raise exception
          'The social derivative Storage object is missing.'
          using errcode = '23514';
      end if;

      object_size := case
        when coalesce(social_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (social_object.metadata ->> 'size')::bigint
        else null
      end;
      object_mime := lower(coalesce(social_object.metadata ->> 'mimetype', ''));
      if object_size is distinct from p_social_size_bytes
        or object_mime <> p_social_mime_type
      then
        raise exception
          'The social derivative Storage evidence does not match.'
          using errcode = '23514';
      end if;

      insert into private.gallery_social_derivatives (
        submission_id,
        storage_object_id,
        storage_bucket,
        storage_path,
        storage_object_version,
        storage_object_updated_at,
        mime_type,
        size_bytes,
        width,
        height,
        sha256,
        sanitizer_version,
        metadata_policy,
        created_by,
        source_storage_object_id,
        source_storage_object_version,
        source_storage_object_updated_at,
        source_sha256,
        derivation_method
      ) values (
        p_submission_id,
        social_object.id,
        social_object.bucket_id,
        social_object.name,
        social_object.version,
        social_object.updated_at,
        p_social_mime_type,
        p_social_size_bytes,
        p_social_width,
        p_social_height,
        p_social_sha256,
        p_social_sanitizer_version,
        p_social_metadata_policy,
        p_moderator_id,
        source_validation.storage_object_id,
        source_validation.storage_object_version,
        source_validation.storage_object_updated_at,
        source_validation.source_sha256,
        'jpeg-metadata-strip-v1'
      );
      inserted_social := true;
    end if;
  elsif has_social then
    raise exception
      'Social derivatives are accepted only during approval.'
      using errcode = '22023';
  end if;

  result := public.gallery_commit_moderation(
    p_submission_id,
    p_moderator_id,
    p_action,
    p_reason,
    p_publication_id,
    p_public_original_storage_path,
    p_public_original_mime_type,
    p_public_original_size_bytes,
    p_public_original_width,
    p_public_original_height,
    p_public_original_sha256,
    p_thumbnail_revision_id,
    p_thumbnail_storage_path,
    p_thumbnail_mime_type,
    p_thumbnail_size_bytes,
    p_thumbnail_width,
    p_thumbnail_height,
    p_thumbnail_sha256,
    p_expected_thumbnail_revision_id,
    p_expected_updated_at
  );

  if inserted_social
    and coalesce((result ->> 'committed')::boolean, false) is not true
  then
    delete from private.gallery_social_derivatives
    where submission_id = p_submission_id;
  end if;

  return result;
end;
$$;

revoke all on function public.gallery_commit_moderation_with_social_derivative(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, text,
  uuid, text, text, bigint, integer, integer, text, uuid, timestamptz,
  text, text, bigint, integer, integer, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.gallery_commit_moderation_with_social_derivative(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, text,
  uuid, text, text, bigint, integer, integer, text, uuid, timestamptz,
  text, text, bigint, integer, integer, text, text, text, text
) to service_role;

-- Edge code reads these tables directly but all mutations are owner-executed
-- security-definer RPCs or triggers. Remove unnecessary direct write power.
revoke all
on table public.gallery_facebook_page_publish_jobs
from service_role;
revoke all
on table public.gallery_facebook_page_publish_events
from service_role;
grant select
on table public.gallery_facebook_page_publish_jobs,
  public.gallery_facebook_page_publish_events
to service_role;

commit;
