begin;

set local lock_timeout = '5s';

alter table public.gallery_submissions
  add column if not exists facebook_page_opt_in_contract_version text;

-- Earlier draft triggers stamped the expanded public-Page-plus-optional-group
-- copy for every website boolean, including cached clients that never saw it.
-- Relabel those rows before the exact browser/server handshake is enforced.
drop trigger if exists reject_gallery_facebook_page_consent_update
on public.gallery_submissions;

update public.gallery_submissions
set facebook_page_opt_in_copy_version =
  'gallery-facebook-page-opt-in-unverified-v1'
where submission_source = 'website'
  and facebook_page_opt_in is true
  and facebook_page_opt_in_source = 'website_upload'
  and facebook_page_opt_in_copy_version =
    '2026-07-website-public-facebook-page-group-v2'
  and facebook_page_opt_in_contract_version is null;

create or replace function private.attest_gallery_facebook_page_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  claimed_contract_version text := new.facebook_page_opt_in_contract_version;
begin
  if new.facebook_page_opt_in is true then
    new.facebook_page_opt_in_at := clock_timestamp();
    new.facebook_page_opt_in_source := case new.submission_source
      when 'website' then 'website_upload'
      when 'discord' then 'discord_slash_command'
      else null
    end;
    new.facebook_page_opt_in_contract_version := case
      when new.submission_source = 'website'
        and claimed_contract_version =
          '2026-07-website-public-facebook-page-group-v2'
      then '2026-07-website-public-facebook-page-group-v2'
      else null
    end;
    new.facebook_page_opt_in_copy_version := case
      when new.submission_source = 'website'
        and claimed_contract_version =
          '2026-07-website-public-facebook-page-group-v2'
      then '2026-07-website-public-facebook-page-group-v2'
      when new.submission_source = 'website'
      then 'gallery-facebook-page-opt-in-unverified-v1'
      when new.submission_source = 'discord'
      then 'gallery-facebook-page-opt-in-v1'
      else null
    end;
  else
    new.facebook_page_opt_in_at := null;
    new.facebook_page_opt_in_source := null;
    new.facebook_page_opt_in_copy_version := null;
    new.facebook_page_opt_in_contract_version := null;
  end if;

  return new;
end;
$$;

revoke all on function private.attest_gallery_facebook_page_consent()
from public, anon, authenticated, service_role;

create or replace function private.reject_gallery_facebook_page_consent_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.facebook_page_opt_in is distinct from old.facebook_page_opt_in
    or new.facebook_page_opt_in_at is distinct from old.facebook_page_opt_in_at
    or new.facebook_page_opt_in_source is distinct from old.facebook_page_opt_in_source
    or new.facebook_page_opt_in_copy_version is distinct from old.facebook_page_opt_in_copy_version
    or new.facebook_page_opt_in_contract_version is distinct from old.facebook_page_opt_in_contract_version
  then
    raise exception 'Facebook Page consent is immutable after submission.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.reject_gallery_facebook_page_consent_update()
from public, anon, authenticated, service_role;

create trigger reject_gallery_facebook_page_consent_update
before update of
  facebook_page_opt_in,
  facebook_page_opt_in_at,
  facebook_page_opt_in_source,
  facebook_page_opt_in_copy_version,
  facebook_page_opt_in_contract_version
on public.gallery_submissions
for each row
execute function private.reject_gallery_facebook_page_consent_update();

alter table public.gallery_submissions
  drop constraint if exists gallery_submissions_facebook_page_contract_version_check;
alter table public.gallery_submissions
  add constraint gallery_submissions_facebook_page_contract_version_check
  check (
    (
      facebook_page_opt_in_contract_version is null
      and facebook_page_opt_in_copy_version is distinct from
        '2026-07-website-public-facebook-page-group-v2'
    )
    or (
      submission_source = 'website'
      and facebook_page_opt_in is true
      and facebook_page_opt_in_at is not null
      and facebook_page_opt_in_source = 'website_upload'
      and facebook_page_opt_in_copy_version =
        '2026-07-website-public-facebook-page-group-v2'
      and facebook_page_opt_in_contract_version =
        '2026-07-website-public-facebook-page-group-v2'
    )
  ) not valid;
alter table public.gallery_submissions
  validate constraint gallery_submissions_facebook_page_contract_version_check;

revoke update (
  facebook_page_opt_in,
  facebook_page_opt_in_at,
  facebook_page_opt_in_source,
  facebook_page_opt_in_copy_version,
  facebook_page_opt_in_contract_version
) on table public.gallery_submissions from authenticated;

revoke insert (
  facebook_page_opt_in_at,
  facebook_page_opt_in_source,
  facebook_page_opt_in_copy_version
) on table public.gallery_submissions from authenticated;
grant insert (
  facebook_page_opt_in,
  facebook_page_opt_in_contract_version
) on table public.gallery_submissions to authenticated;

with transitioned as (
  update public.gallery_facebook_page_publish_jobs as job
  set
    status = 'ineligible',
    eligibility_reason =
      'Facebook Page publication requires the exact current website consent contract handshake.',
    last_error = null,
    attempt_started_at = null
  from public.gallery_submissions as submission
  where submission.id = job.submission_id
    and job.status in ('queued', 'failed')
    and (
      submission.facebook_page_opt_in is not true
      or submission.facebook_page_opt_in_source is distinct from 'website_upload'
      or submission.facebook_page_opt_in_copy_version is distinct from
        '2026-07-website-public-facebook-page-group-v2'
      or submission.facebook_page_opt_in_contract_version is distinct from
        '2026-07-website-public-facebook-page-group-v2'
    )
  returning
    job.id,
    job.submission_id,
    submission.facebook_page_opt_in_copy_version,
    submission.facebook_page_opt_in_contract_version
)
insert into public.gallery_facebook_page_publish_events (
  job_id, submission_id, actor_id, action, details
)
select
  id,
  submission_id,
  null,
  'ineligible',
  jsonb_build_object(
    'reason', 'exact_contract_handshake_required',
    'historical_copy_version', facebook_page_opt_in_copy_version,
    'historical_contract_version', facebook_page_opt_in_contract_version
  )
from transitioned;

with transitioned as (
  update public.gallery_facebook_page_publish_jobs as job
  set
    status = 'reconcile_required',
    last_error =
      'This publish attempt predates the exact website consent handshake guard. Inspect the official Page before resolving it.',
    attempt_started_at = null
  from public.gallery_submissions as submission
  where submission.id = job.submission_id
    and job.status = 'publishing'
    and (
      submission.facebook_page_opt_in is not true
      or submission.facebook_page_opt_in_source is distinct from 'website_upload'
      or submission.facebook_page_opt_in_copy_version is distinct from
        '2026-07-website-public-facebook-page-group-v2'
      or submission.facebook_page_opt_in_contract_version is distinct from
        '2026-07-website-public-facebook-page-group-v2'
    )
  returning job.id, job.submission_id, job.attempt_count
)
insert into public.gallery_facebook_page_publish_events (
  job_id, submission_id, actor_id, action, details
)
select
  id,
  submission_id,
  null,
  'reconcile_required',
  jsonb_build_object(
    'reason', 'publish_attempt_predates_exact_contract_guard',
    'attempt_count', attempt_count
  )
from transitioned;

create or replace function private.copy_gallery_social_derivative_to_facebook_job()
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
    or submission.facebook_page_opt_in_contract_version <>
      '2026-07-website-public-facebook-page-group-v2'
  then
    new.status := 'ineligible';
    new.eligibility_reason :=
      'Facebook Page publication requires the exact current website consent contract handshake.';
    return new;
  end if;

  select * into derivative
  from private.gallery_social_derivatives
  where submission_id = new.submission_id
    and storage_path ~ (
      '^_social/submissions/' || new.submission_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
    );

  if not found then
    new.status := 'ineligible';
    new.eligibility_reason :=
      'A source-bound metadata-stripped social derivative is required.';
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

create or replace function private.enforce_gallery_facebook_active_job_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_consent boolean := false;
begin
  if new.status not in ('queued', 'publishing') then
    return new;
  end if;

  select (
    submission.facebook_page_opt_in is true
    and submission.facebook_page_opt_in_source = 'website_upload'
    and submission.facebook_page_opt_in_copy_version =
      '2026-07-website-public-facebook-page-group-v2'
    and submission.facebook_page_opt_in_contract_version =
      '2026-07-website-public-facebook-page-group-v2'
  )
  into current_consent
  from public.gallery_submissions as submission
  where submission.id = new.submission_id;

  if coalesce(current_consent, false) is not true then
    if new.status = 'queued' then
      new.status := 'ineligible';
      new.eligibility_reason :=
        'Facebook Page publication requires the exact current website consent contract handshake.';
      return new;
    end if;
    raise exception
      'Facebook Page publishing requires the exact current website consent contract handshake.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_gallery_facebook_active_job_consent()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_gallery_facebook_active_job_consent
on public.gallery_facebook_page_publish_jobs;
create trigger enforce_gallery_facebook_active_job_consent
before insert or update of status
on public.gallery_facebook_page_publish_jobs
for each row
execute function private.enforce_gallery_facebook_active_job_consent();

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

  perform 1
  from public.gallery_submissions
  where id = current_job.submission_id
    and status = 'approved'
    and facebook_page_opt_in is true
    and facebook_page_opt_in_source = 'website_upload'
    and facebook_page_opt_in_copy_version =
      '2026-07-website-public-facebook-page-group-v2'
    and facebook_page_opt_in_contract_version =
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
    or not exists (
      select 1
      from private.gallery_social_derivatives as derivative
      where derivative.submission_id = current_job.submission_id
        and derivative.storage_object_id = current_job.social_storage_object_id
        and derivative.storage_object_version is not distinct from
          current_job.social_storage_object_version
        and derivative.storage_object_updated_at =
          current_job.social_storage_object_updated_at
        and derivative.sha256 = current_job.social_sha256
        and derivative.storage_path ~ (
          '^_social/submissions/' || current_job.submission_id::text ||
          '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
        )
    )
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

revoke all on function public.gallery_facebook_page_begin_publish(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_begin_publish(uuid, uuid, text)
to service_role;

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
      '2026-07-website-public-facebook-page-group-v2'
    and facebook_page_opt_in_contract_version =
      '2026-07-website-public-facebook-page-group-v2';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'submission_not_publishable');
  end if;

  select * into derivative
  from private.gallery_social_derivatives
  where submission_id = current_job.submission_id
    and storage_path ~ (
      '^_social/submissions/' || current_job.submission_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
    )
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

revoke all on function public.gallery_facebook_page_publish_source(uuid)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_publish_source(uuid)
to service_role;

create or replace function private.normalize_gallery_facebook_permalink(
  p_value text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  raw_value text := nullif(btrim(p_value), '');
  normalized text;
  canonical_path text;
  fbid text;
  set_id text;
  story_id text;
  page_id text;
begin
  if raw_value is null then return null; end if;
  if char_length(raw_value) > 1000
    or raw_value ~ '[[:space:]#]'
    or raw_value ~* '%(2f|5c)'
    or raw_value !~* '^https://(www[.]|m[.])?facebook[.]com/'
  then
    return null;
  end if;

  normalized := regexp_replace(
    raw_value,
    '^https://(www[.]|m[.])?facebook[.]com',
    'https://www.facebook.com',
    'i'
  );

  canonical_path := substring(
    normalized from
      '^(https://www[.]facebook[.]com/[A-Za-z0-9_.:-]{1,100}/posts/[A-Za-z0-9_.:-]{1,255})/?([?].*)?$'
  );
  if canonical_path is not null then return canonical_path; end if;

  canonical_path := substring(
    normalized from
      '^(https://www[.]facebook[.]com/[A-Za-z0-9_.:-]{1,100}/photos/[A-Za-z0-9_.:-]{1,255}(/[A-Za-z0-9_.:-]{1,255}){0,2})/?([?].*)?$'
  );
  if canonical_path is not null then return canonical_path; end if;

  if normalized ~ '^https://www[.]facebook[.]com/(photo|photo[.]php)/?[?]'
    and regexp_count(normalized, '[?&]fbid=', 1, 'i') = 1
    and regexp_count(normalized, '[?&]set=', 1, 'i') <= 1
  then
    fbid := substring(
      normalized from '[?&]fbid=([A-Za-z0-9_.:-]{1,255})(&|$)'
    );
    set_id := substring(
      normalized from '[?&]set=([A-Za-z0-9_.:-]{1,255})(&|$)'
    );
    if fbid is null
      or (
        regexp_count(normalized, '[?&]set=', 1, 'i') = 1
        and set_id is null
      )
    then
      return null;
    end if;
    return 'https://www.facebook.com/photo.php?fbid=' || fbid ||
      case when set_id is null then '' else '&set=' || set_id end;
  end if;

  if normalized ~ '^https://www[.]facebook[.]com/(story[.]php|permalink[.]php)[?]'
    and regexp_count(normalized, '[?&]story_fbid=', 1, 'i') = 1
    and regexp_count(normalized, '[?&]id=', 1, 'i') = 1
  then
    story_id := substring(
      normalized from '[?&]story_fbid=([A-Za-z0-9_.:-]{1,255})(&|$)'
    );
    page_id := substring(
      normalized from '[?&]id=([A-Za-z0-9_.:-]{1,100})(&|$)'
    );
    if story_id is null or page_id is null then return null; end if;
    canonical_path := case
      when normalized like 'https://www.facebook.com/story.php%'
      then 'story.php'
      else 'permalink.php'
    end;
    return 'https://www.facebook.com/' || canonical_path ||
      '?story_fbid=' || story_id || '&id=' || page_id;
  end if;

  return null;
end;
$$;

revoke all on function private.normalize_gallery_facebook_permalink(text)
from public, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from public.gallery_facebook_page_publish_jobs
    where facebook_permalink is not null
      and facebook_permalink is distinct from
        private.normalize_gallery_facebook_permalink(facebook_permalink)
  ) then
    raise exception
      'Non-canonical Facebook permalinks require manual quarantine before migration.';
  end if;
end;
$$;

alter table public.gallery_facebook_page_publish_jobs
  drop constraint if exists gallery_facebook_page_publish_jobs_permalink_canonical_check;
alter table public.gallery_facebook_page_publish_jobs
  add constraint gallery_facebook_page_publish_jobs_permalink_canonical_check
  check (
    facebook_permalink is null
    or facebook_permalink =
      private.normalize_gallery_facebook_permalink(facebook_permalink)
  );

drop function if exists public.gallery_facebook_page_finish_publish(
  uuid, uuid, text, text, text, text, text, jsonb
);

create function public.gallery_facebook_page_finish_publish(
  p_job_id uuid,
  p_actor_id uuid,
  p_outcome text,
  p_facebook_photo_id text default null,
  p_facebook_post_id text default null,
  p_facebook_permalink text default null,
  p_error text default null,
  p_details jsonb default '{}'::jsonb,
  p_page_ownership_verified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_facebook_page_publish_jobs%rowtype;
  updated_job public.gallery_facebook_page_publish_jobs%rowtype;
  clean_photo_id text := nullif(btrim(p_facebook_photo_id), '');
  clean_post_id text := nullif(btrim(p_facebook_post_id), '');
  raw_permalink text := nullif(btrim(p_facebook_permalink), '');
  clean_permalink text :=
    private.normalize_gallery_facebook_permalink(p_facebook_permalink);
  clean_error text := nullif(btrim(p_error), '');
  current_consent boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_outcome not in ('published', 'failed', 'reconcile_required') then
    raise exception 'Invalid Facebook Page publish outcome.' using errcode = '22023';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Facebook Page publish details must be a JSON object.' using errcode = '22023';
  end if;
  if raw_permalink is not null and clean_permalink is null then
    raise exception 'Facebook Page permalink is not canonical.' using errcode = '22023';
  end if;
  if (clean_photo_id is not null and clean_photo_id !~ '^[A-Za-z0-9_.:-]{1,255}$')
    or (clean_post_id is not null and clean_post_id !~ '^[A-Za-z0-9_.:-]{1,255}$')
    or char_length(coalesce(clean_error, '')) > 1000
  then
    raise exception 'Facebook Page publish result is invalid.' using errcode = '22023';
  end if;
  if p_outcome = 'published'
    and (
      p_page_ownership_verified is not true
      or (clean_photo_id is null and clean_post_id is null)
      or clean_permalink is null
    )
  then
    raise exception
      'Published Facebook Page jobs require canonical Page-owned object evidence.'
      using errcode = '22023';
  end if;

  select * into current_job
  from public.gallery_facebook_page_publish_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'job_not_found');
  end if;
  if current_job.status <> 'publishing' then
    return jsonb_build_object(
      'committed', false, 'reason', 'job_not_publishing', 'status', current_job.status
    );
  end if;

  if p_outcome = 'published' then
    select (
      submission.status = 'approved'
      and submission.facebook_page_opt_in is true
      and submission.facebook_page_opt_in_source = 'website_upload'
      and submission.facebook_page_opt_in_copy_version =
        '2026-07-website-public-facebook-page-group-v2'
      and submission.facebook_page_opt_in_contract_version =
        '2026-07-website-public-facebook-page-group-v2'
    )
    into current_consent
    from public.gallery_submissions as submission
    where submission.id = current_job.submission_id;
    if coalesce(current_consent, false) is not true
      or current_job.destination_page_id <> '1222888660907862'
    then
      return jsonb_build_object(
        'committed', false,
        'reason', 'submission_not_publishable',
        'status', current_job.status
      );
    end if;
  end if;

  update public.gallery_facebook_page_publish_jobs
  set
    status = p_outcome,
    facebook_photo_id = case
      when p_outcome in ('published', 'reconcile_required') and clean_photo_id is not null
        then clean_photo_id
      else facebook_photo_id
    end,
    facebook_post_id = case
      when p_outcome in ('published', 'reconcile_required') and clean_post_id is not null
        then clean_post_id
      else facebook_post_id
    end,
    facebook_permalink = case
      when p_outcome in ('published', 'reconcile_required') and clean_permalink is not null
        then clean_permalink
      else facebook_permalink
    end,
    last_error = case
      when p_outcome = 'published' then null
      else coalesce(clean_error, 'Facebook Page publishing failed.')
    end,
    published_by = case when p_outcome = 'published' then p_actor_id else null end,
    published_at = case when p_outcome = 'published' then clock_timestamp() else null end
  where id = current_job.id
  returning * into updated_job;

  insert into public.gallery_facebook_page_publish_events (
    job_id, submission_id, actor_id, action, details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    p_outcome,
    p_details || jsonb_build_object(
      'has_photo_id', clean_photo_id is not null,
      'has_post_id', clean_post_id is not null,
      'has_permalink', clean_permalink is not null,
      'page_ownership_verified', p_page_ownership_verified is true,
      'facebook_photo_id', clean_photo_id,
      'facebook_post_id', clean_post_id,
      'facebook_permalink', clean_permalink
    )
  );

  return jsonb_build_object('committed', true, 'job', to_jsonb(updated_job));
end;
$$;

revoke all on function public.gallery_facebook_page_finish_publish(
  uuid, uuid, text, text, text, text, text, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_finish_publish(
  uuid, uuid, text, text, text, text, text, jsonb, boolean
) to service_role;

drop function if exists public.gallery_facebook_page_resolve_reconciliation(
  uuid, uuid, text, text, text, text, text
);

create function public.gallery_facebook_page_resolve_reconciliation(
  p_job_id uuid,
  p_actor_id uuid,
  p_resolution text,
  p_facebook_photo_id text default null,
  p_facebook_post_id text default null,
  p_facebook_permalink text default null,
  p_note text default null,
  p_page_ownership_verified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_facebook_page_publish_jobs%rowtype;
  updated_job public.gallery_facebook_page_publish_jobs%rowtype;
  clean_photo_id text := nullif(btrim(p_facebook_photo_id), '');
  clean_post_id text := nullif(btrim(p_facebook_post_id), '');
  raw_permalink text := nullif(btrim(p_facebook_permalink), '');
  clean_permalink text :=
    private.normalize_gallery_facebook_permalink(p_facebook_permalink);
  clean_note text := nullif(btrim(p_note), '');
  resolved_photo_id text;
  resolved_post_id text;
  resolved_permalink text;
  event_action text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_resolution not in ('confirmed_published', 'confirmed_not_published') then
    raise exception 'Invalid Facebook Page reconciliation resolution.' using errcode = '22023';
  end if;
  if clean_note is null or char_length(clean_note) > 500 then
    raise exception 'A reconciliation note of at most 500 characters is required.' using errcode = '22023';
  end if;
  if raw_permalink is not null and clean_permalink is null then
    raise exception 'Facebook Page permalink is not canonical.' using errcode = '22023';
  end if;
  if (clean_photo_id is not null and clean_photo_id !~ '^[A-Za-z0-9_.:-]{1,255}$')
    or (clean_post_id is not null and clean_post_id !~ '^[A-Za-z0-9_.:-]{1,255}$')
  then
    raise exception 'Facebook Page reconciliation evidence is invalid.' using errcode = '22023';
  end if;
  if p_resolution = 'confirmed_not_published'
    and (
      clean_photo_id is not null
      or clean_post_id is not null
      or raw_permalink is not null
      or p_page_ownership_verified is true
    )
  then
    raise exception
      'Publication identifiers are not allowed when no Facebook Page post exists.'
      using errcode = '22023';
  end if;
  if p_resolution = 'confirmed_published'
    and (
      p_page_ownership_verified is not true
      or (clean_photo_id is null and clean_post_id is null)
      or clean_permalink is null
    )
  then
    return jsonb_build_object(
      'committed', false,
      'reason', 'canonical_page_evidence_required'
    );
  end if;

  select * into current_job
  from public.gallery_facebook_page_publish_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'job_not_found');
  end if;
  if current_job.status <> 'reconcile_required' then
    return jsonb_build_object(
      'committed', false,
      'reason', 'job_not_reconcilable',
      'status', current_job.status
    );
  end if;

  resolved_photo_id := coalesce(clean_photo_id, current_job.facebook_photo_id);
  resolved_post_id := coalesce(clean_post_id, current_job.facebook_post_id);
  resolved_permalink := coalesce(clean_permalink, current_job.facebook_permalink);

  event_action := case p_resolution
    when 'confirmed_published' then 'reconciliation_resolved_published'
    else 'reconciliation_resolved_not_published'
  end;

  update public.gallery_facebook_page_publish_jobs
  set
    status = case p_resolution
      when 'confirmed_published' then 'published'
      else 'failed'
    end,
    facebook_photo_id = case p_resolution
      when 'confirmed_published' then resolved_photo_id
      else null
    end,
    facebook_post_id = case p_resolution
      when 'confirmed_published' then resolved_post_id
      else null
    end,
    facebook_permalink = case p_resolution
      when 'confirmed_published' then resolved_permalink
      else null
    end,
    last_error = case p_resolution
      when 'confirmed_published' then null
      else left(
        'Moderator confirmed the Page post was not published: ' || clean_note,
        1000
      )
    end,
    attempt_started_at = null,
    published_by = case p_resolution
      when 'confirmed_published' then p_actor_id
      else null
    end,
    published_at = case p_resolution
      when 'confirmed_published' then clock_timestamp()
      else null
    end
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
      'resolution', p_resolution,
      'note', clean_note,
      'page_ownership_verified', p_page_ownership_verified is true,
      'previous_facebook_photo_id', current_job.facebook_photo_id,
      'previous_facebook_post_id', current_job.facebook_post_id,
      'previous_facebook_permalink', current_job.facebook_permalink,
      'facebook_photo_id', updated_job.facebook_photo_id,
      'facebook_post_id', updated_job.facebook_post_id,
      'facebook_permalink', updated_job.facebook_permalink
    )
  );

  return jsonb_build_object(
    'committed', true,
    'job', jsonb_build_object(
      'id', updated_job.id,
      'submission_id', updated_job.submission_id,
      'status', updated_job.status,
      'facebook_photo_id', updated_job.facebook_photo_id,
      'facebook_post_id', updated_job.facebook_post_id,
      'facebook_permalink', updated_job.facebook_permalink,
      'last_error', updated_job.last_error,
      'published_at', updated_job.published_at,
      'updated_at', updated_job.updated_at
    )
  );
end;
$$;

revoke all on function public.gallery_facebook_page_resolve_reconciliation(
  uuid, uuid, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_resolve_reconciliation(
  uuid, uuid, text, text, text, text, text, boolean
) to service_role;

commit;
