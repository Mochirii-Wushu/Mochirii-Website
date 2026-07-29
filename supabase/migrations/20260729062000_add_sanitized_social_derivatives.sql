begin;

set local lock_timeout = '5s';

-- This copy authorizes a public Page post plus an optional moderator share of
-- that Page post into the private official guild group. Historical v1 consent
-- remains immutable and is deliberately not made API-publishable.
create or replace function private.attest_gallery_facebook_page_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.facebook_page_opt_in is true then
    new.facebook_page_opt_in_at := clock_timestamp();
    new.facebook_page_opt_in_source := case new.submission_source
      when 'website' then 'website_upload'
      when 'discord' then 'discord_slash_command'
      else null
    end;
    new.facebook_page_opt_in_copy_version := case new.submission_source
      when 'website' then '2026-07-website-public-facebook-page-group-v2'
      else 'gallery-facebook-page-opt-in-v1'
    end;
  else
    new.facebook_page_opt_in_at := null;
    new.facebook_page_opt_in_source := null;
    new.facebook_page_opt_in_copy_version := null;
  end if;

  return new;
end;
$$;

revoke all on function private.attest_gallery_facebook_page_consent()
from public, anon, authenticated;

create table private.gallery_social_derivatives (
  submission_id uuid primary key
    references public.gallery_submissions(id) on delete cascade,
  storage_object_id uuid not null unique,
  storage_bucket text not null,
  storage_path text not null unique,
  storage_object_version text,
  storage_object_updated_at timestamptz not null,
  mime_type text not null,
  size_bytes bigint not null,
  width integer not null,
  height integer not null,
  sha256 text not null,
  sanitizer_version text not null,
  metadata_policy text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  constraint gallery_social_derivatives_bucket_check
    check (storage_bucket = 'member-gallery'),
  constraint gallery_social_derivatives_path_check
    check (
      storage_path = '_social/submissions/' || submission_id::text || '/v1.jpg'
    ),
  constraint gallery_social_derivatives_mime_check
    check (mime_type = 'image/jpeg'),
  constraint gallery_social_derivatives_size_check
    check (size_bytes between 1 and 8388608),
  constraint gallery_social_derivatives_dimensions_check
    check (
      width between 320 and 1440
      and height between 1 and 1800
      and width * 5 >= height * 4
      and width * 100 <= height * 191
    ),
  constraint gallery_social_derivatives_sha256_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint gallery_social_derivatives_sanitizer_check
    check (sanitizer_version = 'gallery-social-jpeg-v1'),
  constraint gallery_social_derivatives_metadata_policy_check
    check (metadata_policy = 'jfif-only-no-app-metadata-v1')
);

alter table private.gallery_social_derivatives enable row level security;
revoke all on table private.gallery_social_derivatives
from public, anon, authenticated, service_role;

create policy service_only_default_deny
on private.gallery_social_derivatives
as restrictive for all to anon, authenticated
using (false)
with check (false);

create function private.reject_gallery_social_derivative_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Social derivative evidence is immutable.' using errcode = '23514';
end;
$$;

revoke all on function private.reject_gallery_social_derivative_update()
from public, anon, authenticated, service_role;

create trigger reject_gallery_social_derivative_update
before update on private.gallery_social_derivatives
for each row
execute function private.reject_gallery_social_derivative_update();

-- The bucket is private already. This restrictive policy makes the reserved
-- derivative prefix explicitly unavailable to every browser role, even if a
-- future permissive member policy is broadened accidentally.
create policy "Block browser access to social derivatives"
on storage.objects
as restrictive for all to anon, authenticated
using (
  bucket_id <> 'member-gallery'
  or name not like '_social/%'
)
with check (
  bucket_id <> 'member-gallery'
  or name not like '_social/%'
);

alter table public.gallery_facebook_page_publish_jobs
  add column destination_page_id text,
  add column social_storage_object_id uuid,
  add column social_storage_object_version text,
  add column social_storage_object_updated_at timestamptz,
  add column social_mime_type text,
  add column social_size_bytes bigint,
  add column social_width integer,
  add column social_height integer,
  add column social_sha256 text,
  add column social_sanitizer_version text,
  add column social_metadata_policy text;

update public.gallery_facebook_page_publish_jobs
set destination_page_id = '1222888660907862'
where destination_page_id is null;

alter table public.gallery_facebook_page_publish_jobs
  alter column destination_page_id set not null,
  add constraint gallery_facebook_page_publish_jobs_destination_check
    check (destination_page_id = '1222888660907862'),
  add constraint gallery_facebook_page_publish_jobs_social_evidence_check
    check (
      (
        social_storage_object_id is null
        and social_storage_object_version is null
        and social_storage_object_updated_at is null
        and social_mime_type is null
        and social_size_bytes is null
        and social_width is null
        and social_height is null
        and social_sha256 is null
        and social_sanitizer_version is null
        and social_metadata_policy is null
      )
      or (
        social_storage_object_id is not null
        and social_storage_object_updated_at is not null
        and social_mime_type = 'image/jpeg'
        and social_size_bytes between 1 and 8388608
        and social_width between 320 and 1440
        and social_height between 1 and 1800
        and social_width * 5 >= social_height * 4
        and social_width * 100 <= social_height * 191
        and social_sha256 ~ '^[0-9a-f]{64}$'
        and social_sanitizer_version = 'gallery-social-jpeg-v1'
        and social_metadata_policy = 'jfif-only-no-app-metadata-v1'
        and source_mime_type = social_mime_type
        and source_size_bytes = social_size_bytes
        and source_sha256 = social_sha256
      )
    ),
  add constraint gallery_facebook_page_publish_jobs_publishable_social_check
    check (
      status not in ('queued', 'publishing', 'published', 'failed')
      or social_storage_object_id is not null
    ) not valid;

alter table public.gallery_instagram_publish_jobs
  add column social_storage_object_id uuid,
  add column social_storage_object_version text,
  add column social_storage_object_updated_at timestamptz,
  add column social_mime_type text,
  add column social_size_bytes bigint,
  add column social_width integer,
  add column social_height integer,
  add column social_sha256 text,
  add column social_sanitizer_version text,
  add column social_metadata_policy text,
  add constraint gallery_instagram_publish_jobs_social_evidence_check
    check (
      (
        social_storage_object_id is null
        and social_storage_object_version is null
        and social_storage_object_updated_at is null
        and social_mime_type is null
        and social_size_bytes is null
        and social_width is null
        and social_height is null
        and social_sha256 is null
        and social_sanitizer_version is null
        and social_metadata_policy is null
      )
      or (
        social_storage_object_id is not null
        and social_storage_object_updated_at is not null
        and social_mime_type = 'image/jpeg'
        and social_size_bytes between 1 and 8388608
        and social_width between 320 and 1440
        and social_height between 1 and 1800
        and social_width * 5 >= social_height * 4
        and social_width * 100 <= social_height * 191
        and social_sha256 ~ '^[0-9a-f]{64}$'
        and social_sanitizer_version = 'gallery-social-jpeg-v1'
        and social_metadata_policy = 'jfif-only-no-app-metadata-v1'
        and source_mime_type = social_mime_type
        and source_size_bytes = social_size_bytes
        and source_sha256 = social_sha256
      )
    ),
  add constraint gallery_instagram_publish_jobs_publishable_social_check
    check (
      status not in ('queued', 'publishing', 'published', 'failed')
      or social_storage_object_id is not null
    ) not valid;

with transitioned as (
  update public.gallery_facebook_page_publish_jobs as job
  set
    status = 'ineligible',
    eligibility_reason = 'Current explicit Facebook Page and guild-group consent is required.',
    last_error = null,
    attempt_started_at = null
  from public.gallery_submissions as submission
  where submission.id = job.submission_id
    and job.status in ('queued', 'failed')
    and (
      submission.facebook_page_opt_in_source <> 'website_upload'
      or submission.facebook_page_opt_in_copy_version <>
        '2026-07-website-public-facebook-page-group-v2'
    )
  returning job.id, job.submission_id
)
insert into public.gallery_facebook_page_publish_events (
  job_id, submission_id, actor_id, action, details
)
select
  id,
  submission_id,
  null,
  'ineligible',
  jsonb_build_object('reason', 'current_explicit_consent_required')
from transitioned;

create function private.copy_gallery_social_derivative_to_facebook_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.gallery_submissions%rowtype;
  derivative private.gallery_social_derivatives%rowtype;
begin
  new.destination_page_id := '1222888660907862';
  new.message := coalesce(
    nullif(btrim(new.message), ''),
    'A pretty gameplay showcase from Mōchirīī.'
  );

  select * into submission
  from public.gallery_submissions
  where id = new.submission_id;

  if not found
    or submission.facebook_page_opt_in is not true
    or submission.facebook_page_opt_in_source <> 'website_upload'
    or submission.facebook_page_opt_in_copy_version <>
      '2026-07-website-public-facebook-page-group-v2'
  then
    new.status := 'ineligible';
    new.eligibility_reason :=
      'Current explicit Facebook Page and guild-group consent is required.';
    return new;
  end if;

  select * into derivative
  from private.gallery_social_derivatives
  where submission_id = new.submission_id;

  if not found then
    new.status := 'ineligible';
    new.eligibility_reason :=
      'A metadata-stripped social derivative is required.';
    return new;
  end if;

  new.status := 'queued';
  new.eligibility_reason := null;
  new.source_mime_type := derivative.mime_type;
  new.source_size_bytes := derivative.size_bytes;
  new.source_sha256 := derivative.sha256;
  new.social_storage_object_id := derivative.storage_object_id;
  new.social_storage_object_version := derivative.storage_object_version;
  new.social_storage_object_updated_at := derivative.storage_object_updated_at;
  new.social_mime_type := derivative.mime_type;
  new.social_size_bytes := derivative.size_bytes;
  new.social_width := derivative.width;
  new.social_height := derivative.height;
  new.social_sha256 := derivative.sha256;
  new.social_sanitizer_version := derivative.sanitizer_version;
  new.social_metadata_policy := derivative.metadata_policy;
  return new;
end;
$$;

revoke all on function private.copy_gallery_social_derivative_to_facebook_job()
from public, anon, authenticated, service_role;

create trigger copy_gallery_social_derivative_to_facebook_job
before insert on public.gallery_facebook_page_publish_jobs
for each row
execute function private.copy_gallery_social_derivative_to_facebook_job();

drop trigger if exists attest_gallery_instagram_job_source
on public.gallery_instagram_publish_jobs;

create function private.copy_gallery_social_derivative_to_instagram_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.gallery_submissions%rowtype;
  derivative private.gallery_social_derivatives%rowtype;
begin
  new.caption := coalesce(
    nullif(btrim(new.caption), ''),
    'A pretty gameplay showcase from Mōchirīī.'
  );
  select * into submission
  from public.gallery_submissions
  where id = new.submission_id;

  if not found
    or submission.instagram_opt_in is not true
    or submission.instagram_opt_in_source <> 'website_upload'
    or submission.instagram_opt_in_copy_version <>
      '2026-07-website-public-instagram-publish-v2'
    or submission.instagram_opt_in_contract_version <>
      '2026-07-website-public-instagram-publish-v2'
  then
    new.status := 'ineligible';
    new.eligibility_reason :=
      'Current explicit public Instagram publishing consent is required.';
    return new;
  end if;

  select * into derivative
  from private.gallery_social_derivatives
  where submission_id = new.submission_id;

  if not found then
    new.status := 'ineligible';
    new.eligibility_reason :=
      'A metadata-stripped social derivative is required.';
    return new;
  end if;

  new.status := 'queued';
  new.eligibility_reason := null;
  new.source_mime_type := derivative.mime_type;
  new.source_size_bytes := derivative.size_bytes;
  new.source_sha256 := derivative.sha256;
  new.social_storage_object_id := derivative.storage_object_id;
  new.social_storage_object_version := derivative.storage_object_version;
  new.social_storage_object_updated_at := derivative.storage_object_updated_at;
  new.social_mime_type := derivative.mime_type;
  new.social_size_bytes := derivative.size_bytes;
  new.social_width := derivative.width;
  new.social_height := derivative.height;
  new.social_sha256 := derivative.sha256;
  new.social_sanitizer_version := derivative.sanitizer_version;
  new.social_metadata_policy := derivative.metadata_policy;
  return new;
end;
$$;

revoke all on function private.copy_gallery_social_derivative_to_instagram_job()
from public, anon, authenticated, service_role;

create trigger copy_gallery_social_derivative_to_instagram_job
before insert on public.gallery_instagram_publish_jobs
for each row
execute function private.copy_gallery_social_derivative_to_instagram_job();

create function private.guard_gallery_facebook_page_job_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.destination_page_id is distinct from old.destination_page_id
    or new.social_storage_object_id is distinct from old.social_storage_object_id
    or new.social_storage_object_version is distinct from old.social_storage_object_version
    or new.social_storage_object_updated_at is distinct from old.social_storage_object_updated_at
    or new.social_mime_type is distinct from old.social_mime_type
    or new.social_size_bytes is distinct from old.social_size_bytes
    or new.social_width is distinct from old.social_width
    or new.social_height is distinct from old.social_height
    or new.social_sha256 is distinct from old.social_sha256
    or new.social_sanitizer_version is distinct from old.social_sanitizer_version
    or new.social_metadata_policy is distinct from old.social_metadata_policy
  then
    raise exception 'Facebook destination and derivative binding are immutable.' using errcode = '23514';
  end if;

  if new.destination_page_id <> '1222888660907862' then
    raise exception 'Facebook destination is outside the Mochirii Page scope.' using errcode = '23514';
  end if;
  if new.status in ('queued', 'publishing', 'published', 'failed')
    and new.social_storage_object_id is null
  then
    raise exception 'Facebook publishing requires a frozen social derivative.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_gallery_facebook_page_job_binding()
from public, anon, authenticated, service_role;

create trigger guard_gallery_facebook_page_job_binding
before update on public.gallery_facebook_page_publish_jobs
for each row
execute function private.guard_gallery_facebook_page_job_binding();

create function private.guard_gallery_instagram_job_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.social_storage_object_id is distinct from old.social_storage_object_id
    or new.social_storage_object_version is distinct from old.social_storage_object_version
    or new.social_storage_object_updated_at is distinct from old.social_storage_object_updated_at
    or new.social_mime_type is distinct from old.social_mime_type
    or new.social_size_bytes is distinct from old.social_size_bytes
    or new.social_width is distinct from old.social_width
    or new.social_height is distinct from old.social_height
    or new.social_sha256 is distinct from old.social_sha256
    or new.social_sanitizer_version is distinct from old.social_sanitizer_version
    or new.social_metadata_policy is distinct from old.social_metadata_policy
  then
    raise exception 'Instagram derivative binding is immutable.' using errcode = '23514';
  end if;
  if new.status in ('queued', 'publishing', 'published', 'failed')
    and new.social_storage_object_id is null
  then
    raise exception 'Instagram publishing requires a frozen social derivative.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_gallery_instagram_job_binding()
from public, anon, authenticated, service_role;

create trigger guard_gallery_instagram_job_binding
before update on public.gallery_instagram_publish_jobs
for each row
execute function private.guard_gallery_instagram_job_binding();

create function public.gallery_commit_moderation_with_social_derivative(
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
  p_social_metadata_policy text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_submission public.gallery_submissions%rowtype;
  social_object storage.objects%rowtype;
  result jsonb;
  requires_social boolean := false;
  inserted_social boolean := false;
  object_size bigint;
  object_mime text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

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
    ) or (
      current_submission.instagram_opt_in is true
      and current_submission.instagram_opt_in_source = 'website_upload'
      and current_submission.instagram_opt_in_copy_version =
        '2026-07-website-public-instagram-publish-v2'
      and current_submission.instagram_opt_in_contract_version =
        '2026-07-website-public-instagram-publish-v2'
    );

    if requires_social then
      if coalesce(
        p_social_storage_path =
          '_social/submissions/' || p_submission_id::text || '/v1.jpg'
        and p_social_mime_type = 'image/jpeg'
        and p_social_size_bytes between 1 and 8388608
        and p_social_width between 320 and 1440
        and p_social_height between 1 and 1800
        and p_social_width * 5 >= p_social_height * 4
        and p_social_width * 100 <= p_social_height * 191
        and p_social_sha256 ~ '^[0-9a-f]{64}$'
        and p_social_sanitizer_version = 'gallery-social-jpeg-v1'
        and p_social_metadata_policy = 'jfif-only-no-app-metadata-v1',
        false
      ) is not true then
        raise exception 'A valid metadata-stripped social derivative is required.' using errcode = '23514';
      end if;

      select * into social_object
      from storage.objects
      where bucket_id = 'member-gallery'
        and name = p_social_storage_path;

      if not found then
        raise exception 'The social derivative Storage object is missing.' using errcode = '23514';
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
        raise exception 'The social derivative Storage evidence does not match.' using errcode = '23514';
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
        created_by
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
        p_moderator_id
      );
      inserted_social := true;
    elsif p_social_storage_path is not null then
      raise exception 'Unexpected social derivative evidence.' using errcode = '22023';
    end if;
  elsif p_social_storage_path is not null then
    raise exception 'Social derivatives are accepted only during approval.' using errcode = '22023';
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
  text, text, bigint, integer, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.gallery_commit_moderation_with_social_derivative(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, text,
  uuid, text, text, bigint, integer, integer, text, uuid, timestamptz,
  text, text, bigint, integer, integer, text, text, text
) to service_role;

create or replace function public.gallery_facebook_page_begin_publish(
  p_job_id uuid,
  p_actor_id uuid,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_facebook_page_publish_jobs%rowtype;
  current_submission public.gallery_submissions%rowtype;
  updated_job public.gallery_facebook_page_publish_jobs%rowtype;
  next_message text;
  event_action text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select * into current_job
  from public.gallery_facebook_page_publish_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'job_not_found');
  end if;
  if current_job.status not in ('queued', 'failed') then
    return jsonb_build_object(
      'committed', false, 'reason', 'job_not_publishable', 'status', current_job.status
    );
  end if;
  select * into current_submission
  from public.gallery_submissions
  where id = current_job.submission_id
    and status = 'approved'
    and facebook_page_opt_in is true
    and facebook_page_opt_in_source = 'website_upload'
    and facebook_page_opt_in_copy_version =
      '2026-07-website-public-facebook-page-group-v2';
  if not found then
    return jsonb_build_object(
      'committed', false, 'reason', 'submission_not_publishable', 'status', current_job.status
    );
  end if;
  if current_job.destination_page_id <> '1222888660907862'
    or current_job.social_storage_object_id is null
    or current_job.social_mime_type <> 'image/jpeg'
    or current_job.social_size_bytes not between 1 and 8388608
    or current_job.social_width not between 320 and 1440
    or current_job.social_height not between 1 and 1800
    or current_job.social_width * 5 < current_job.social_height * 4
    or current_job.social_width * 100 > current_job.social_height * 191
    or current_job.social_sha256 !~ '^[0-9a-f]{64}$'
    or current_job.social_sanitizer_version <> 'gallery-social-jpeg-v1'
    or current_job.social_metadata_policy <> 'jfif-only-no-app-metadata-v1'
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'destination_or_derivative_invalid', 'status', current_job.status
    );
  end if;

  next_message := coalesce(nullif(btrim(p_message), ''), current_job.message);
  if char_length(coalesce(next_message, '')) > 5000 then
    raise exception 'Facebook Page message is too long.' using errcode = '22023';
  end if;
  event_action := case when current_job.status = 'failed' then 'retry' else 'publishing' end;

  update public.gallery_facebook_page_publish_jobs
  set
    status = 'publishing',
    message = next_message,
    last_error = null,
    attempt_count = attempt_count + 1,
    attempt_started_at = clock_timestamp()
  where id = current_job.id
  returning * into updated_job;

  insert into public.gallery_facebook_page_publish_events (
    job_id, submission_id, actor_id, action, details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    event_action,
    jsonb_build_object(
      'attempt_count', updated_job.attempt_count,
      'destination_page_id', updated_job.destination_page_id
    )
  );

  return jsonb_build_object('committed', true, 'job', to_jsonb(updated_job));
end;
$$;

create or replace function public.gallery_instagram_begin_publish(
  p_job_id uuid,
  p_actor_id uuid,
  p_caption text default null,
  p_alt_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_instagram_publish_jobs%rowtype;
  current_submission public.gallery_submissions%rowtype;
  updated_job public.gallery_instagram_publish_jobs%rowtype;
  next_caption text;
  next_alt_text text;
  event_action text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select * into current_job
  from public.gallery_instagram_publish_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'job_not_found');
  end if;
  if current_job.status not in ('queued', 'failed') then
    return jsonb_build_object(
      'committed', false, 'reason', 'job_not_publishable', 'status', current_job.status
    );
  end if;
  select * into current_submission
  from public.gallery_submissions
  where id = current_job.submission_id
    and status = 'approved'
    and instagram_opt_in is true
    and instagram_opt_in_source = 'website_upload'
    and instagram_opt_in_copy_version =
      '2026-07-website-public-instagram-publish-v2'
    and instagram_opt_in_contract_version =
      '2026-07-website-public-instagram-publish-v2';
  if not found then
    return jsonb_build_object(
      'committed', false, 'reason', 'submission_not_publishable', 'status', current_job.status
    );
  end if;
  if current_job.social_storage_object_id is null
    or current_job.social_mime_type <> 'image/jpeg'
    or current_job.social_size_bytes not between 1 and 8388608
    or current_job.social_width not between 320 and 1440
    or current_job.social_height not between 1 and 1800
    or current_job.social_width * 5 < current_job.social_height * 4
    or current_job.social_width * 100 > current_job.social_height * 191
    or current_job.social_sha256 !~ '^[0-9a-f]{64}$'
    or current_job.social_sanitizer_version <> 'gallery-social-jpeg-v1'
    or current_job.social_metadata_policy <> 'jfif-only-no-app-metadata-v1'
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'social_derivative_invalid', 'status', current_job.status
    );
  end if;

  next_caption := coalesce(nullif(btrim(p_caption), ''), current_job.caption);
  next_alt_text := coalesce(nullif(btrim(p_alt_text), ''), current_job.alt_text);
  if char_length(coalesce(next_caption, '')) > 2200
    or char_length(coalesce(next_alt_text, '')) > 1000
  then
    raise exception 'Instagram copy is too long.' using errcode = '22023';
  end if;
  event_action := case when current_job.status = 'failed' then 'retry' else 'publishing' end;

  update public.gallery_instagram_publish_jobs
  set
    status = 'publishing',
    caption = next_caption,
    alt_text = next_alt_text,
    last_error = null,
    attempt_count = attempt_count + 1,
    attempt_started_at = clock_timestamp()
  where id = current_job.id
  returning * into updated_job;

  insert into public.gallery_instagram_publish_events (
    job_id, submission_id, actor_id, action, details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    event_action,
    jsonb_build_object('attempt_count', updated_job.attempt_count)
  );

  return jsonb_build_object('committed', true, 'job', to_jsonb(updated_job));
end;
$$;

create or replace function public.gallery_facebook_page_publish_source(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_facebook_page_publish_jobs%rowtype;
  current_submission public.gallery_submissions%rowtype;
  derivative private.gallery_social_derivatives%rowtype;
  source_object storage.objects%rowtype;
  object_size bigint;
  object_mime text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select * into current_job
  from public.gallery_facebook_page_publish_jobs
  where id = p_job_id;

  if not found then return jsonb_build_object('ok', false, 'reason', 'job_not_found'); end if;
  if current_job.status <> 'publishing' then
    return jsonb_build_object('ok', false, 'reason', 'job_not_publishing');
  end if;
  if current_job.destination_page_id <> '1222888660907862' then
    return jsonb_build_object('ok', false, 'reason', 'destination_mismatch');
  end if;

  select * into current_submission
  from public.gallery_submissions
  where id = current_job.submission_id
    and status = 'approved'
    and facebook_page_opt_in is true
    and facebook_page_opt_in_source = 'website_upload'
    and facebook_page_opt_in_copy_version =
      '2026-07-website-public-facebook-page-group-v2';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'submission_not_publishable');
  end if;

  select * into derivative
  from private.gallery_social_derivatives
  where submission_id = current_job.submission_id
    and storage_object_id = current_job.social_storage_object_id
    and storage_object_version is not distinct from current_job.social_storage_object_version
    and storage_object_updated_at = current_job.social_storage_object_updated_at
    and mime_type = current_job.social_mime_type
    and size_bytes = current_job.social_size_bytes
    and width = current_job.social_width
    and height = current_job.social_height
    and sha256 = current_job.social_sha256
    and sanitizer_version = current_job.social_sanitizer_version
    and metadata_policy = current_job.social_metadata_policy;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'derivative_binding_mismatch');
  end if;

  select * into source_object
  from storage.objects
  where id = derivative.storage_object_id
    and bucket_id = derivative.storage_bucket
    and name = derivative.storage_path
    and version is not distinct from derivative.storage_object_version
    and updated_at = derivative.storage_object_updated_at;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'derivative_object_mismatch');
  end if;

  object_size := case
    when coalesce(source_object.metadata ->> 'size', '') ~ '^[0-9]+$'
      then (source_object.metadata ->> 'size')::bigint
    else null
  end;
  object_mime := lower(coalesce(source_object.metadata ->> 'mimetype', ''));
  if object_size is distinct from derivative.size_bytes
    or object_mime <> derivative.mime_type
  then
    return jsonb_build_object('ok', false, 'reason', 'derivative_object_mismatch');
  end if;

  return jsonb_build_object(
    'ok', true,
    'submission_id', current_submission.id,
    'destination_page_id', current_job.destination_page_id,
    'bucket_id', derivative.storage_bucket,
    'object_name', derivative.storage_path,
    'object_id', derivative.storage_object_id,
    'object_version', derivative.storage_object_version,
    'object_updated_at', derivative.storage_object_updated_at,
    'mime_type', derivative.mime_type,
    'size_bytes', derivative.size_bytes,
    'width', derivative.width,
    'height', derivative.height,
    'sha256', derivative.sha256,
    'sanitizer_version', derivative.sanitizer_version,
    'metadata_policy', derivative.metadata_policy
  );
end;
$$;

create or replace function public.gallery_instagram_publish_source(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_instagram_publish_jobs%rowtype;
  current_submission public.gallery_submissions%rowtype;
  derivative private.gallery_social_derivatives%rowtype;
  source_object storage.objects%rowtype;
  object_size bigint;
  object_mime text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select * into current_job
  from public.gallery_instagram_publish_jobs
  where id = p_job_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'job_not_found'); end if;
  if current_job.status <> 'publishing' then
    return jsonb_build_object('ok', false, 'reason', 'job_not_publishing');
  end if;

  select * into current_submission
  from public.gallery_submissions
  where id = current_job.submission_id
    and status = 'approved'
    and instagram_opt_in is true
    and instagram_opt_in_source = 'website_upload'
    and instagram_opt_in_copy_version =
      '2026-07-website-public-instagram-publish-v2'
    and instagram_opt_in_contract_version =
      '2026-07-website-public-instagram-publish-v2';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'submission_not_publishable');
  end if;

  select * into derivative
  from private.gallery_social_derivatives
  where submission_id = current_job.submission_id
    and storage_object_id = current_job.social_storage_object_id
    and storage_object_version is not distinct from current_job.social_storage_object_version
    and storage_object_updated_at = current_job.social_storage_object_updated_at
    and mime_type = current_job.social_mime_type
    and size_bytes = current_job.social_size_bytes
    and width = current_job.social_width
    and height = current_job.social_height
    and sha256 = current_job.social_sha256
    and sanitizer_version = current_job.social_sanitizer_version
    and metadata_policy = current_job.social_metadata_policy;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'derivative_binding_mismatch');
  end if;

  select * into source_object
  from storage.objects
  where id = derivative.storage_object_id
    and bucket_id = derivative.storage_bucket
    and name = derivative.storage_path
    and version is not distinct from derivative.storage_object_version
    and updated_at = derivative.storage_object_updated_at;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'derivative_object_mismatch');
  end if;

  object_size := case
    when coalesce(source_object.metadata ->> 'size', '') ~ '^[0-9]+$'
      then (source_object.metadata ->> 'size')::bigint
    else null
  end;
  object_mime := lower(coalesce(source_object.metadata ->> 'mimetype', ''));
  if object_size is distinct from derivative.size_bytes
    or object_mime <> derivative.mime_type
  then
    return jsonb_build_object('ok', false, 'reason', 'derivative_object_mismatch');
  end if;

  return jsonb_build_object(
    'ok', true,
    'submission_id', current_submission.id,
    'bucket_id', derivative.storage_bucket,
    'object_name', derivative.storage_path,
    'object_id', derivative.storage_object_id,
    'object_version', derivative.storage_object_version,
    'object_updated_at', derivative.storage_object_updated_at,
    'mime_type', derivative.mime_type,
    'size_bytes', derivative.size_bytes,
    'width', derivative.width,
    'height', derivative.height,
    'sha256', derivative.sha256,
    'sanitizer_version', derivative.sanitizer_version,
    'metadata_policy', derivative.metadata_policy
  );
end;
$$;

-- Keep all established function privilege boundaries after replacement.
revoke all on function public.gallery_facebook_page_begin_publish(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_begin_publish(uuid, uuid, text)
to service_role;
revoke all on function public.gallery_instagram_begin_publish(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.gallery_instagram_begin_publish(uuid, uuid, text, text)
to service_role;
revoke all on function public.gallery_facebook_page_publish_source(uuid)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_publish_source(uuid)
to service_role;
revoke all on function public.gallery_instagram_publish_source(uuid)
from public, anon, authenticated;
grant execute on function public.gallery_instagram_publish_source(uuid)
to service_role;

commit;
