begin;

set local lock_timeout = '5s';

alter table public.gallery_submissions
  add column if not exists instagram_opt_in_contract_version text;

alter table public.gallery_submissions
  drop constraint if exists gallery_submissions_instagram_contract_version_check;
alter table public.gallery_submissions
  add constraint gallery_submissions_instagram_contract_version_check
  check (
    instagram_opt_in_contract_version is null
    or (
      submission_source = 'website'
      and instagram_opt_in is true
      and instagram_opt_in_contract_version =
        '2026-07-website-public-instagram-publish-v2'
      and instagram_opt_in_source = 'website_upload'
      and instagram_opt_in_copy_version =
        '2026-07-website-public-instagram-publish-v2'
    )
  ) not valid;

create function private.attest_gallery_instagram_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  claimed_contract_version text := new.instagram_opt_in_contract_version;
  claimed_copy_version text := new.instagram_opt_in_copy_version;
begin
  if new.instagram_opt_in is true then
    new.instagram_opt_in_at := clock_timestamp();
    new.instagram_opt_in_source := case new.submission_source
      when 'website' then 'website_upload'
      when 'discord' then 'discord_slash_command'
      else null
    end;
    new.instagram_opt_in_contract_version := case
      when new.submission_source = 'website'
        and claimed_contract_version =
          '2026-07-website-public-instagram-publish-v2'
      then '2026-07-website-public-instagram-publish-v2'
      else null
    end;
    new.instagram_opt_in_copy_version := case new.submission_source
      when 'website' then case
        when claimed_contract_version =
          '2026-07-website-public-instagram-publish-v2'
        then '2026-07-website-public-instagram-publish-v2'
        when claimed_copy_version = '2026-06-website-upload-v1'
        then '2026-06-website-upload-v1'
        else 'gallery-instagram-opt-in-unverified-v1'
      end
      when 'discord' then '2026-06-discord-submit-v1'
      else null
    end;
  else
    new.instagram_opt_in_at := null;
    new.instagram_opt_in_source := null;
    new.instagram_opt_in_copy_version := null;
    new.instagram_opt_in_contract_version := null;
  end if;

  return new;
end;
$$;

revoke all on function private.attest_gallery_instagram_consent()
from public, anon, authenticated;

drop trigger if exists attest_gallery_instagram_consent on public.gallery_submissions;
create trigger attest_gallery_instagram_consent
before insert
on public.gallery_submissions
for each row
execute function private.attest_gallery_instagram_consent();

create function private.reject_gallery_instagram_consent_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.instagram_opt_in is distinct from old.instagram_opt_in
    or new.instagram_opt_in_at is distinct from old.instagram_opt_in_at
    or new.instagram_opt_in_source is distinct from old.instagram_opt_in_source
    or new.instagram_opt_in_copy_version is distinct from old.instagram_opt_in_copy_version
    or new.instagram_opt_in_contract_version is distinct from old.instagram_opt_in_contract_version
  then
    raise exception 'Instagram consent is immutable after submission.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.reject_gallery_instagram_consent_update()
from public, anon, authenticated;

drop trigger if exists reject_gallery_instagram_consent_update on public.gallery_submissions;
create trigger reject_gallery_instagram_consent_update
before update of
  instagram_opt_in,
  instagram_opt_in_at,
  instagram_opt_in_source,
  instagram_opt_in_copy_version,
  instagram_opt_in_contract_version
on public.gallery_submissions
for each row
execute function private.reject_gallery_instagram_consent_update();

revoke insert (
  instagram_opt_in_at,
  instagram_opt_in_source,
  instagram_opt_in_copy_version,
  instagram_opt_in_contract_version
) on table public.gallery_submissions from authenticated;
revoke update (
  instagram_opt_in,
  instagram_opt_in_at,
  instagram_opt_in_source,
  instagram_opt_in_copy_version,
  instagram_opt_in_contract_version
) on table public.gallery_submissions from authenticated;

-- During the browser cutover, older cached clients may still send the three
-- former provenance fields. They remain accepted as untrusted input only: the
-- trigger above always replaces them with database-authored evidence and only
-- the dedicated exact contract handshake can produce the v2 attestation.
grant insert (
  instagram_opt_in,
  instagram_opt_in_at,
  instagram_opt_in_source,
  instagram_opt_in_copy_version,
  instagram_opt_in_contract_version
)
on table public.gallery_submissions to authenticated;

alter table public.gallery_submissions
  validate constraint gallery_submissions_instagram_contract_version_check;

alter table public.gallery_instagram_publish_jobs
  add column if not exists source_mime_type text,
  add column if not exists source_size_bytes bigint,
  add column if not exists source_sha256 text,
  add column if not exists attempt_started_at timestamptz;

update public.gallery_instagram_publish_jobs as job
set
  source_mime_type = validation.source_mime_type,
  source_size_bytes = validation.source_size_bytes,
  source_sha256 = validation.source_sha256
from private.gallery_source_validations as validation
where validation.submission_id = job.submission_id
  and validation.validator_version = 'gallery-source-v1'
  and (
    job.source_mime_type is null
    or job.source_size_bytes is null
    or job.source_sha256 is null
  );

alter table public.gallery_instagram_publish_jobs
  drop constraint if exists gallery_instagram_publish_jobs_status_check;

alter table public.gallery_instagram_publish_jobs
  add constraint gallery_instagram_publish_jobs_status_check
  check (status in (
    'queued', 'ineligible', 'publishing', 'published', 'failed',
    'reconcile_required', 'canceled', 'shared_manually'
  )) not valid;

alter table public.gallery_instagram_publish_jobs
  validate constraint gallery_instagram_publish_jobs_status_check;

alter table public.gallery_instagram_publish_events
  drop constraint if exists gallery_instagram_publish_events_action_check;

alter table public.gallery_instagram_publish_events
  add constraint gallery_instagram_publish_events_action_check
  check (action in (
    'queued', 'ineligible', 'publishing', 'published', 'failed', 'retry',
    'reconcile_required', 'reconciliation_resolved_published',
    'reconciliation_resolved_not_published', 'canceled', 'shared_manually'
  )) not valid;

alter table public.gallery_instagram_publish_events
  validate constraint gallery_instagram_publish_events_action_check;

with transitioned as (
  update public.gallery_instagram_publish_jobs
  set
    status = 'reconcile_required',
    last_error = 'An earlier Instagram publish attempt was still in progress during the safety upgrade. Inspect the account before any retry.'
  where status = 'publishing'
  returning id, submission_id, attempt_count, attempt_started_at
)
insert into public.gallery_instagram_publish_events (
  job_id, submission_id, actor_id, action, details
)
select
  id,
  submission_id,
  null,
  'reconcile_required',
  jsonb_build_object(
    'reason', 'migration_quarantine',
    'attempt_count', attempt_count,
    'attempt_started_at', attempt_started_at
  )
from transitioned;

with transitioned as (
  update public.gallery_instagram_publish_jobs as job
  set
    status = 'ineligible',
    eligibility_reason = 'Instagram publication requires the current explicit public-account and moderator-approved-caption consent.',
    last_error = null,
    attempt_started_at = null
  from public.gallery_submissions as submission
  where submission.id = job.submission_id
    and job.status in ('queued', 'failed')
    and submission.instagram_opt_in is true
    and (
      submission.instagram_opt_in_copy_version is distinct from
        '2026-07-website-public-instagram-publish-v2'
      or submission.instagram_opt_in_contract_version is distinct from
        '2026-07-website-public-instagram-publish-v2'
    )
  returning
    job.id,
    job.submission_id,
    submission.instagram_opt_in_copy_version,
    submission.instagram_opt_in_contract_version
)
insert into public.gallery_instagram_publish_events (
  job_id, submission_id, actor_id, action, details
)
select
  id,
  submission_id,
  null,
  'ineligible',
  jsonb_build_object(
    'reason', 'current_consent_required',
    'historical_copy_version', instagram_opt_in_copy_version,
    'historical_contract_version', instagram_opt_in_contract_version
  )
from transitioned;

with transitioned as (
  update public.gallery_instagram_publish_jobs
  set
    status = 'ineligible',
    eligibility_reason = 'Immutable source evidence is unavailable for this historical Instagram job.',
    last_error = null,
    attempt_started_at = null
  where status in ('queued', 'failed')
    and (
      source_mime_type is null
      or source_size_bytes is null
      or source_sha256 is null
    )
  returning id, submission_id
)
insert into public.gallery_instagram_publish_events (
  job_id, submission_id, actor_id, action, details
)
select
  id,
  submission_id,
  null,
  'ineligible',
  jsonb_build_object('reason', 'source_evidence_unavailable')
from transitioned;

alter table public.gallery_instagram_publish_jobs
  add constraint gallery_instagram_publish_jobs_source_mime_check
  check (
    source_mime_type is null
    or source_mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ) not valid,
  add constraint gallery_instagram_publish_jobs_source_size_check
  check (
    source_size_bytes is null
    or source_size_bytes between 1 and 8388608
  ) not valid,
  add constraint gallery_instagram_publish_jobs_source_sha256_check
  check (
    source_sha256 is null
    or source_sha256 ~ '^[0-9a-f]{64}$'
  ) not valid,
  add constraint gallery_instagram_publish_jobs_external_ids_length
  check (
    (instagram_container_id is null or char_length(instagram_container_id) between 1 and 255)
    and (instagram_media_id is null or char_length(instagram_media_id) between 1 and 255)
    and (instagram_permalink is null or char_length(instagram_permalink) between 1 and 1000)
  ) not valid,
  add constraint gallery_instagram_publish_jobs_error_length
  check (last_error is null or char_length(last_error) <= 1000) not valid;

alter table public.gallery_instagram_publish_jobs
  validate constraint gallery_instagram_publish_jobs_source_mime_check;
alter table public.gallery_instagram_publish_jobs
  validate constraint gallery_instagram_publish_jobs_source_size_check;
alter table public.gallery_instagram_publish_jobs
  validate constraint gallery_instagram_publish_jobs_source_sha256_check;
alter table public.gallery_instagram_publish_jobs
  validate constraint gallery_instagram_publish_jobs_external_ids_length;
alter table public.gallery_instagram_publish_jobs
  validate constraint gallery_instagram_publish_jobs_error_length;

create index if not exists gallery_instagram_publish_jobs_stale_lease_idx
on public.gallery_instagram_publish_jobs (attempt_started_at)
where status = 'publishing';

alter table public.gallery_instagram_publish_jobs enable row level security;
revoke all on table public.gallery_instagram_publish_jobs
from public, anon, authenticated;
grant all on table public.gallery_instagram_publish_jobs to service_role;
drop policy if exists service_only_default_deny on public.gallery_instagram_publish_jobs;
create policy service_only_default_deny on public.gallery_instagram_publish_jobs
  as restrictive for all to anon, authenticated using (false) with check (false);

alter table public.gallery_instagram_publish_events enable row level security;
revoke all on table public.gallery_instagram_publish_events
from public, anon, authenticated;
grant all on table public.gallery_instagram_publish_events to service_role;
drop policy if exists service_only_default_deny on public.gallery_instagram_publish_events;
create policy service_only_default_deny on public.gallery_instagram_publish_events
  as restrictive for all to anon, authenticated using (false) with check (false);

create function private.attest_gallery_instagram_job_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_validation private.gallery_source_validations%rowtype;
  current_copy_version text;
  current_contract_version text;
begin
  select validation.*
  into source_validation
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
  where validation.submission_id = new.submission_id
    and validation.validator_version = 'gallery-source-v1';

  if not found then
    raise exception 'Instagram outbox requires current source validation.' using errcode = '23514';
  end if;

  select
    submission.instagram_opt_in_copy_version,
    submission.instagram_opt_in_contract_version
  into current_copy_version, current_contract_version
  from public.gallery_submissions as submission
  where submission.id = new.submission_id;

  new.source_mime_type := source_validation.source_mime_type;
  new.source_size_bytes := source_validation.source_size_bytes;
  new.source_sha256 := source_validation.source_sha256;
  if new.caption is null
    or btrim(new.caption) = ''
    or new.caption = 'Shared from the Mōchirīī guild gallery.'
  then
    new.caption := 'A pretty gameplay showcase from Mōchirīī.';
  end if;
  if current_copy_version is distinct from
    '2026-07-website-public-instagram-publish-v2'
    or current_contract_version is distinct from
      '2026-07-website-public-instagram-publish-v2'
  then
    new.status := 'ineligible';
    new.eligibility_reason :=
      'Instagram publication requires the current explicit public-account and moderator-approved-caption consent.';
  end if;
  return new;
end;
$$;

revoke all on function private.attest_gallery_instagram_job_source()
from public, anon, authenticated;

drop trigger if exists attest_gallery_instagram_job_source
on public.gallery_instagram_publish_jobs;
create trigger attest_gallery_instagram_job_source
before insert on public.gallery_instagram_publish_jobs
for each row
execute function private.attest_gallery_instagram_job_source();

create function private.reject_gallery_instagram_job_source_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_mime_type is distinct from old.source_mime_type
    or new.source_size_bytes is distinct from old.source_size_bytes
    or new.source_sha256 is distinct from old.source_sha256
  then
    raise exception 'Instagram source evidence is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_gallery_instagram_job_source_update()
from public, anon, authenticated;

drop trigger if exists reject_gallery_instagram_job_source_update
on public.gallery_instagram_publish_jobs;
create trigger reject_gallery_instagram_job_source_update
before update of source_mime_type, source_size_bytes, source_sha256
on public.gallery_instagram_publish_jobs
for each row
execute function private.reject_gallery_instagram_job_source_update();

create function public.gallery_instagram_begin_publish(
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

  select *
  into current_job
  from public.gallery_instagram_publish_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'job_not_found');
  end if;

  if current_job.status not in ('queued', 'failed') then
    return jsonb_build_object(
      'committed', false,
      'reason', 'job_not_publishable',
      'status', current_job.status
    );
  end if;

  select *
  into current_submission
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
      'committed', false,
      'reason', 'current_consent_required',
      'status', current_job.status
    );
  end if;

  if current_job.source_mime_type <> 'image/jpeg'
    or current_job.source_size_bytes not between 1 and 8388608
    or current_job.source_sha256 !~ '^[0-9a-f]{64}$'
  then
    return jsonb_build_object(
      'committed', false,
      'reason', 'source_evidence_invalid',
      'status', current_job.status
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

revoke all on function public.gallery_instagram_begin_publish(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.gallery_instagram_begin_publish(uuid, uuid, text, text)
to service_role;

create function public.gallery_instagram_quarantine_stale_publish_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  quarantined_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  with stale_jobs as (
    update public.gallery_instagram_publish_jobs
    set
      status = 'reconcile_required',
      last_error = 'The Instagram publish attempt exceeded its lease. Inspect the account before any retry.'
    where status = 'publishing'
      and attempt_started_at is not null
      and attempt_started_at <= clock_timestamp() - interval '15 minutes'
    returning id, submission_id, attempt_count, attempt_started_at
  )
  insert into public.gallery_instagram_publish_events (
    job_id, submission_id, actor_id, action, details
  )
  select
    id,
    submission_id,
    null,
    'reconcile_required',
    jsonb_build_object(
      'reason', 'stale_publish_lease',
      'attempt_count', attempt_count,
      'attempt_started_at', attempt_started_at,
      'lease_minutes', 15
    )
  from stale_jobs;

  get diagnostics quarantined_count = row_count;
  return jsonb_build_object(
    'committed', true,
    'quarantined_count', quarantined_count
  );
end;
$$;

revoke all on function public.gallery_instagram_quarantine_stale_publish_jobs()
from public, anon, authenticated;
grant execute on function public.gallery_instagram_quarantine_stale_publish_jobs()
to service_role;

create function public.gallery_instagram_publish_source(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_instagram_publish_jobs%rowtype;
  current_submission public.gallery_submissions%rowtype;
  current_validation private.gallery_source_validations%rowtype;
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

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'job_not_found');
  end if;
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

  select * into current_validation
  from private.gallery_source_validations
  where submission_id = current_submission.id
    and storage_bucket = current_submission.storage_bucket
    and storage_path = current_submission.storage_path
    and source_mime_type = current_submission.mime_type
    and source_size_bytes = current_submission.size_bytes
    and source_mime_type = current_job.source_mime_type
    and source_size_bytes = current_job.source_size_bytes
    and source_sha256 = current_job.source_sha256
    and validator_version = 'gallery-source-v1';

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'source_validation_mismatch');
  end if;

  select * into source_object
  from storage.objects
  where id = current_validation.storage_object_id
    and bucket_id = current_validation.storage_bucket
    and name = current_validation.storage_path
    and version is not distinct from current_validation.storage_object_version
    and updated_at = current_validation.storage_object_updated_at;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'source_object_mismatch');
  end if;

  object_size := case
    when coalesce(source_object.metadata ->> 'size', '') ~ '^[0-9]+$'
      then (source_object.metadata ->> 'size')::bigint
    else null
  end;
  object_mime := lower(coalesce(source_object.metadata ->> 'mimetype', ''));

  if object_size is distinct from current_validation.source_size_bytes
    or object_mime <> current_validation.source_mime_type
    or current_validation.source_mime_type <> 'image/jpeg'
  then
    return jsonb_build_object('ok', false, 'reason', 'source_object_mismatch');
  end if;

  return jsonb_build_object(
    'ok', true,
    'submission_id', current_submission.id,
    'storage_bucket', current_validation.storage_bucket,
    'storage_path', current_validation.storage_path,
    'source_mime_type', current_validation.source_mime_type,
    'source_size_bytes', current_validation.source_size_bytes,
    'source_sha256', current_validation.source_sha256,
    'storage_object_id', current_validation.storage_object_id,
    'storage_object_version', current_validation.storage_object_version,
    'storage_object_updated_at', current_validation.storage_object_updated_at
  );
end;
$$;

revoke all on function public.gallery_instagram_publish_source(uuid)
from public, anon, authenticated;
grant execute on function public.gallery_instagram_publish_source(uuid)
to service_role;

create function public.gallery_instagram_finish_publish(
  p_job_id uuid,
  p_actor_id uuid,
  p_outcome text,
  p_instagram_container_id text default null,
  p_instagram_media_id text default null,
  p_instagram_permalink text default null,
  p_error text default null,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_instagram_publish_jobs%rowtype;
  updated_job public.gallery_instagram_publish_jobs%rowtype;
  clean_container_id text := nullif(btrim(p_instagram_container_id), '');
  clean_media_id text := nullif(btrim(p_instagram_media_id), '');
  clean_permalink text := nullif(btrim(p_instagram_permalink), '');
  clean_error text := nullif(btrim(p_error), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_outcome not in ('published', 'failed', 'reconcile_required') then
    raise exception 'Invalid Instagram publish outcome.' using errcode = '22023';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Instagram publish details must be a JSON object.' using errcode = '22023';
  end if;
  if p_outcome = 'published' and clean_media_id is null then
    raise exception 'A published Instagram job requires a media id.' using errcode = '22023';
  end if;
  if char_length(coalesce(clean_container_id, '')) > 255
    or char_length(coalesce(clean_media_id, '')) > 255
    or char_length(coalesce(clean_permalink, '')) > 1000
    or char_length(coalesce(clean_error, '')) > 1000
  then
    raise exception 'Instagram publish result is too long.' using errcode = '22023';
  end if;

  select * into current_job
  from public.gallery_instagram_publish_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'job_not_found');
  end if;
  if current_job.status <> 'publishing' then
    return jsonb_build_object(
      'committed', false,
      'reason', 'job_not_publishing',
      'status', current_job.status
    );
  end if;

  update public.gallery_instagram_publish_jobs
  set
    status = p_outcome,
    instagram_container_id = case
      when clean_container_id is not null then clean_container_id
      else instagram_container_id
    end,
    instagram_media_id = case
      when p_outcome in ('published', 'reconcile_required') and clean_media_id is not null
        then clean_media_id
      else instagram_media_id
    end,
    instagram_permalink = case
      when p_outcome in ('published', 'reconcile_required') and clean_permalink is not null
        then clean_permalink
      else instagram_permalink
    end,
    last_error = case
      when p_outcome = 'published' then null
      else coalesce(clean_error, 'Instagram publishing failed.')
    end,
    attempt_started_at = case
      when p_outcome = 'reconcile_required' then attempt_started_at
      else null
    end,
    published_by = case when p_outcome = 'published' then p_actor_id else null end,
    published_at = case when p_outcome = 'published' then clock_timestamp() else null end
  where id = current_job.id
  returning * into updated_job;

  insert into public.gallery_instagram_publish_events (
    job_id, submission_id, actor_id, action, details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    p_outcome,
    p_details || jsonb_build_object(
      'has_container_id', clean_container_id is not null,
      'has_media_id', clean_media_id is not null,
      'has_permalink', clean_permalink is not null,
      'instagram_container_id', clean_container_id,
      'instagram_media_id', clean_media_id,
      'instagram_permalink', clean_permalink
    )
  );

  return jsonb_build_object('committed', true, 'job', to_jsonb(updated_job));
end;
$$;

revoke all on function public.gallery_instagram_finish_publish(uuid, uuid, text, text, text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.gallery_instagram_finish_publish(uuid, uuid, text, text, text, text, text, jsonb)
to service_role;

create function public.gallery_instagram_resolve_reconciliation(
  p_job_id uuid,
  p_actor_id uuid,
  p_resolution text,
  p_instagram_media_id text default null,
  p_instagram_permalink text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_instagram_publish_jobs%rowtype;
  updated_job public.gallery_instagram_publish_jobs%rowtype;
  clean_media_id text := nullif(btrim(p_instagram_media_id), '');
  clean_permalink text := nullif(btrim(p_instagram_permalink), '');
  clean_note text := nullif(btrim(p_note), '');
  resolved_media_id text;
  resolved_permalink text;
  event_action text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_resolution not in ('confirmed_published', 'confirmed_not_published') then
    raise exception 'Invalid Instagram reconciliation resolution.' using errcode = '22023';
  end if;
  if clean_note is null or char_length(clean_note) > 500 then
    raise exception 'A reconciliation note of at most 500 characters is required.' using errcode = '22023';
  end if;
  if char_length(coalesce(clean_media_id, '')) > 255
    or char_length(coalesce(clean_permalink, '')) > 1000
  then
    raise exception 'Instagram reconciliation evidence is too long.' using errcode = '22023';
  end if;
  if p_resolution = 'confirmed_not_published'
    and (clean_media_id is not null or clean_permalink is not null)
  then
    raise exception 'Publication identifiers are not allowed when no Instagram post exists.' using errcode = '22023';
  end if;

  select * into current_job
  from public.gallery_instagram_publish_jobs
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

  resolved_media_id := coalesce(clean_media_id, current_job.instagram_media_id);
  resolved_permalink := coalesce(clean_permalink, current_job.instagram_permalink);
  if p_resolution = 'confirmed_published'
    and (
      resolved_media_id is null
      or resolved_media_id !~ '^\d{5,255}$'
      or resolved_permalink is null
      or resolved_permalink !~ '^https://([a-z0-9-]+\.)?instagram\.com/'
    )
  then
    return jsonb_build_object(
      'committed', false,
      'reason', 'external_evidence_required',
      'status', current_job.status
    );
  end if;

  event_action := case p_resolution
    when 'confirmed_published' then 'reconciliation_resolved_published'
    else 'reconciliation_resolved_not_published'
  end;

  update public.gallery_instagram_publish_jobs
  set
    status = case p_resolution
      when 'confirmed_published' then 'published'
      else 'failed'
    end,
    instagram_media_id = case p_resolution
      when 'confirmed_published' then resolved_media_id
      else null
    end,
    instagram_permalink = case p_resolution
      when 'confirmed_published' then resolved_permalink
      else null
    end,
    last_error = case p_resolution
      when 'confirmed_published' then null
      else left('Moderator confirmed the Instagram post was not published: ' || clean_note, 1000)
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

  insert into public.gallery_instagram_publish_events (
    job_id, submission_id, actor_id, action, details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    event_action,
    jsonb_build_object(
      'resolution', p_resolution,
      'note', clean_note,
      'previous_instagram_media_id', current_job.instagram_media_id,
      'previous_instagram_permalink', current_job.instagram_permalink,
      'instagram_media_id', updated_job.instagram_media_id,
      'instagram_permalink', updated_job.instagram_permalink
    )
  );

  return jsonb_build_object(
    'committed', true,
    'job', jsonb_build_object(
      'id', updated_job.id,
      'submission_id', updated_job.submission_id,
      'status', updated_job.status,
      'instagram_media_id', updated_job.instagram_media_id,
      'instagram_permalink', updated_job.instagram_permalink,
      'last_error', updated_job.last_error,
      'published_at', updated_job.published_at,
      'updated_at', updated_job.updated_at
    )
  );
end;
$$;

revoke all on function public.gallery_instagram_resolve_reconciliation(uuid, uuid, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.gallery_instagram_resolve_reconciliation(uuid, uuid, text, text, text, text)
to service_role;

commit;
