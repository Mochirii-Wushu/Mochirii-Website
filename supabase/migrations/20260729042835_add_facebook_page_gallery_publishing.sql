begin;

set local lock_timeout = '5s';

alter table public.gallery_submissions
  add column if not exists facebook_page_opt_in boolean not null default false,
  add column if not exists facebook_page_opt_in_at timestamptz,
  add column if not exists facebook_page_opt_in_source text,
  add column if not exists facebook_page_opt_in_copy_version text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_facebook_page_opt_in_source_check'
  ) then
    alter table public.gallery_submissions
      add constraint gallery_submissions_facebook_page_opt_in_source_check
      check (
        facebook_page_opt_in_source is null
        or facebook_page_opt_in_source in ('website_upload', 'discord_slash_command')
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_facebook_page_opt_in_consistency_check'
  ) then
    alter table public.gallery_submissions
      add constraint gallery_submissions_facebook_page_opt_in_consistency_check
      check (
        (
          facebook_page_opt_in is false
          and facebook_page_opt_in_at is null
          and facebook_page_opt_in_source is null
          and facebook_page_opt_in_copy_version is null
        )
        or (
          facebook_page_opt_in is true
          and facebook_page_opt_in_at is not null
          and facebook_page_opt_in_copy_version is not null
          and (
            (submission_source = 'website' and facebook_page_opt_in_source = 'website_upload')
            or (submission_source = 'discord' and facebook_page_opt_in_source = 'discord_slash_command')
          )
        )
      ) not valid;
  end if;
end
$$;

alter table public.gallery_submissions
  validate constraint gallery_submissions_facebook_page_opt_in_source_check;

alter table public.gallery_submissions
  validate constraint gallery_submissions_facebook_page_opt_in_consistency_check;

create function private.attest_gallery_facebook_page_consent()
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
    new.facebook_page_opt_in_copy_version := 'gallery-facebook-page-opt-in-v1';
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

drop trigger if exists attest_gallery_facebook_page_consent on public.gallery_submissions;
create trigger attest_gallery_facebook_page_consent
before insert
on public.gallery_submissions
for each row
execute function private.attest_gallery_facebook_page_consent();

create function private.reject_gallery_facebook_page_consent_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.facebook_page_opt_in is distinct from old.facebook_page_opt_in
    or new.facebook_page_opt_in_at is distinct from old.facebook_page_opt_in_at
    or new.facebook_page_opt_in_source is distinct from old.facebook_page_opt_in_source
    or new.facebook_page_opt_in_copy_version is distinct from old.facebook_page_opt_in_copy_version
  then
    raise exception 'Facebook Page consent is immutable after submission.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.reject_gallery_facebook_page_consent_update()
from public, anon, authenticated;

drop trigger if exists reject_gallery_facebook_page_consent_update on public.gallery_submissions;
create trigger reject_gallery_facebook_page_consent_update
before update of
  facebook_page_opt_in,
  facebook_page_opt_in_at,
  facebook_page_opt_in_source,
  facebook_page_opt_in_copy_version
on public.gallery_submissions
for each row
execute function private.reject_gallery_facebook_page_consent_update();

revoke insert (
  facebook_page_opt_in_at,
  facebook_page_opt_in_source,
  facebook_page_opt_in_copy_version
) on table public.gallery_submissions from authenticated;
grant insert (facebook_page_opt_in)
on table public.gallery_submissions to authenticated;

create table public.gallery_facebook_page_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.gallery_submissions(id) on delete cascade,
  status text not null default 'queued',
  eligibility_reason text,
  message text,
  source_mime_type text not null,
  source_size_bytes bigint not null,
  source_sha256 text not null,
  facebook_photo_id text,
  facebook_post_id text,
  facebook_permalink text,
  last_error text,
  attempt_count integer not null default 0,
  attempt_started_at timestamptz,
  queued_by uuid references auth.users(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gallery_facebook_page_publish_jobs_submission_key unique (submission_id),
  constraint gallery_facebook_page_publish_jobs_status_check
    check (status in (
      'queued', 'ineligible', 'publishing', 'published', 'failed',
      'reconcile_required', 'canceled'
    )),
  constraint gallery_facebook_page_publish_jobs_message_length
    check (message is null or char_length(message) <= 5000),
  constraint gallery_facebook_page_publish_jobs_source_mime_check
    check (source_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint gallery_facebook_page_publish_jobs_source_size_check
    check (source_size_bytes between 1 and 8388608),
  constraint gallery_facebook_page_publish_jobs_source_sha256_check
    check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint gallery_facebook_page_publish_jobs_attempt_count_check
    check (attempt_count >= 0),
  constraint gallery_facebook_page_publish_jobs_external_ids_length
    check (
      (facebook_photo_id is null or char_length(facebook_photo_id) between 1 and 255)
      and (facebook_post_id is null or char_length(facebook_post_id) between 1 and 255)
      and (facebook_permalink is null or char_length(facebook_permalink) between 1 and 1000)
    ),
  constraint gallery_facebook_page_publish_jobs_error_length
    check (last_error is null or char_length(last_error) <= 1000),
  constraint gallery_facebook_page_publish_jobs_published_state_check
    check (
      (status = 'published' and published_by is not null and published_at is not null
        and (facebook_photo_id is not null or facebook_post_id is not null))
      or (status <> 'published' and published_at is null)
    )
);

create trigger set_gallery_facebook_page_publish_jobs_updated_at
before update on public.gallery_facebook_page_publish_jobs
for each row
execute function public.set_updated_at();

create index gallery_facebook_page_publish_jobs_status_idx
on public.gallery_facebook_page_publish_jobs (status, updated_at desc, created_at desc);

create index gallery_facebook_page_publish_jobs_queued_by_idx
on public.gallery_facebook_page_publish_jobs (queued_by);

create index gallery_facebook_page_publish_jobs_published_by_idx
on public.gallery_facebook_page_publish_jobs (published_by);

create index gallery_facebook_page_publish_jobs_stale_lease_idx
on public.gallery_facebook_page_publish_jobs (attempt_started_at)
where status = 'publishing';

alter table public.gallery_facebook_page_publish_jobs enable row level security;
revoke all on table public.gallery_facebook_page_publish_jobs from public, anon, authenticated;
grant all on table public.gallery_facebook_page_publish_jobs to service_role;
drop policy if exists service_only_default_deny on public.gallery_facebook_page_publish_jobs;
create policy service_only_default_deny on public.gallery_facebook_page_publish_jobs
  as restrictive for all to anon, authenticated using (false) with check (false);

create table public.gallery_facebook_page_publish_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.gallery_facebook_page_publish_jobs(id) on delete cascade,
  submission_id uuid not null references public.gallery_submissions(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint gallery_facebook_page_publish_events_action_check
    check (action in (
      'queued', 'ineligible', 'publishing', 'retry', 'published', 'failed',
      'reconcile_required', 'reconciliation_resolved_published',
      'reconciliation_resolved_not_published', 'canceled'
    )),
  constraint gallery_facebook_page_publish_events_details_object_check
    check (jsonb_typeof(details) = 'object')
);

create index gallery_facebook_page_publish_events_job_id_idx
on public.gallery_facebook_page_publish_events (job_id, created_at desc);

create index gallery_facebook_page_publish_events_submission_id_idx
on public.gallery_facebook_page_publish_events (submission_id, created_at desc);

create index gallery_facebook_page_publish_events_actor_id_idx
on public.gallery_facebook_page_publish_events (actor_id);

alter table public.gallery_facebook_page_publish_events enable row level security;
revoke all on table public.gallery_facebook_page_publish_events from public, anon, authenticated;
grant all on table public.gallery_facebook_page_publish_events to service_role;
drop policy if exists service_only_default_deny on public.gallery_facebook_page_publish_events;
create policy service_only_default_deny on public.gallery_facebook_page_publish_events
  as restrictive for all to anon, authenticated using (false) with check (false);

create function public.gallery_facebook_page_begin_publish(
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

  select *
  into current_job
  from public.gallery_facebook_page_publish_jobs
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

  next_message := coalesce(nullif(btrim(p_message), ''), current_job.message);
  if next_message is not null and char_length(next_message) > 5000 then
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
    job_id,
    submission_id,
    actor_id,
    action,
    details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    event_action,
    jsonb_build_object('attempt_count', updated_job.attempt_count)
  );

  return jsonb_build_object(
    'committed', true,
    'job', to_jsonb(updated_job)
  );
end;
$$;

revoke all on function public.gallery_facebook_page_begin_publish(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_begin_publish(uuid, uuid, text)
to service_role;

create function public.gallery_facebook_page_quarantine_stale_publish_jobs()
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
    update public.gallery_facebook_page_publish_jobs
    set
      status = 'reconcile_required',
      last_error = 'The Facebook Page publish attempt exceeded its lease. Inspect the Page before any retry.'
    where status = 'publishing'
      and attempt_started_at is not null
      and attempt_started_at <= clock_timestamp() - interval '15 minutes'
    returning id, submission_id, attempt_count, attempt_started_at
  )
  insert into public.gallery_facebook_page_publish_events (
    job_id,
    submission_id,
    actor_id,
    action,
    details
  )
  select
    stale_jobs.id,
    stale_jobs.submission_id,
    null,
    'reconcile_required',
    jsonb_build_object(
      'reason', 'stale_publish_lease',
      'attempt_count', stale_jobs.attempt_count,
      'attempt_started_at', stale_jobs.attempt_started_at,
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

revoke all on function public.gallery_facebook_page_quarantine_stale_publish_jobs()
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_quarantine_stale_publish_jobs()
to service_role;

create function public.gallery_facebook_page_publish_source(
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_facebook_page_publish_jobs%rowtype;
  current_submission public.gallery_submissions%rowtype;
  current_validation private.gallery_source_validations%rowtype;
  source_object storage.objects%rowtype;
  object_size bigint;
  object_mime text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select *
  into current_job
  from public.gallery_facebook_page_publish_jobs
  where id = p_job_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'job_not_found');
  end if;

  if current_job.status <> 'publishing' then
    return jsonb_build_object('ok', false, 'reason', 'job_not_publishing');
  end if;

  select *
  into current_submission
  from public.gallery_submissions
  where id = current_job.submission_id
    and status = 'approved'
    and facebook_page_opt_in is true;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'submission_not_publishable');
  end if;

  select *
  into current_validation
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

  select *
  into source_object
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
    or current_validation.source_mime_type not in ('image/jpeg', 'image/png')
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

revoke all on function public.gallery_facebook_page_publish_source(uuid)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_publish_source(uuid)
to service_role;

create function public.gallery_facebook_page_finish_publish(
  p_job_id uuid,
  p_actor_id uuid,
  p_outcome text,
  p_facebook_photo_id text default null,
  p_facebook_post_id text default null,
  p_facebook_permalink text default null,
  p_error text default null,
  p_details jsonb default '{}'::jsonb
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
  clean_permalink text := nullif(btrim(p_facebook_permalink), '');
  clean_error text := nullif(btrim(p_error), '');
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

  if p_outcome = 'published' and clean_photo_id is null and clean_post_id is null then
    raise exception 'A published Facebook Page job requires an external id.' using errcode = '22023';
  end if;

  if char_length(coalesce(clean_photo_id, '')) > 255
    or char_length(coalesce(clean_post_id, '')) > 255
    or char_length(coalesce(clean_permalink, '')) > 1000
    or char_length(coalesce(clean_error, '')) > 1000
  then
    raise exception 'Facebook Page publish result is too long.' using errcode = '22023';
  end if;

  select *
  into current_job
  from public.gallery_facebook_page_publish_jobs
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
    last_error = case when p_outcome = 'published' then null else coalesce(clean_error, 'Facebook Page publishing failed.') end,
    published_by = case when p_outcome = 'published' then p_actor_id else null end,
    published_at = case when p_outcome = 'published' then clock_timestamp() else null end
  where id = current_job.id
  returning * into updated_job;

  insert into public.gallery_facebook_page_publish_events (
    job_id,
    submission_id,
    actor_id,
    action,
    details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    p_outcome,
    p_details || jsonb_build_object(
      'has_photo_id', clean_photo_id is not null,
      'has_post_id', clean_post_id is not null,
      'has_permalink', clean_permalink is not null,
      'facebook_photo_id', clean_photo_id,
      'facebook_post_id', clean_post_id,
      'facebook_permalink', clean_permalink
    )
  );

  return jsonb_build_object(
    'committed', true,
    'job', to_jsonb(updated_job)
  );
end;
$$;

revoke all on function public.gallery_facebook_page_finish_publish(uuid, uuid, text, text, text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_finish_publish(uuid, uuid, text, text, text, text, text, jsonb)
to service_role;

create function public.gallery_facebook_page_resolve_reconciliation(
  p_job_id uuid,
  p_actor_id uuid,
  p_resolution text,
  p_facebook_photo_id text default null,
  p_facebook_post_id text default null,
  p_facebook_permalink text default null,
  p_note text default null
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
  clean_permalink text := nullif(btrim(p_facebook_permalink), '');
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

  if char_length(coalesce(clean_photo_id, '')) > 255
    or char_length(coalesce(clean_post_id, '')) > 255
    or char_length(coalesce(clean_permalink, '')) > 1000
  then
    raise exception 'Facebook Page reconciliation evidence is too long.' using errcode = '22023';
  end if;

  select *
  into current_job
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

  if p_resolution = 'confirmed_published'
    and resolved_photo_id is null
    and resolved_post_id is null
  then
    return jsonb_build_object(
      'committed', false,
      'reason', 'external_id_required',
      'status', current_job.status
    );
  end if;

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
      else left('Moderator confirmed the Page post was not published: ' || clean_note, 1000)
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
    job_id,
    submission_id,
    actor_id,
    action,
    details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    event_action,
    jsonb_build_object(
      'resolution', p_resolution,
      'note', clean_note,
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

revoke all on function public.gallery_facebook_page_resolve_reconciliation(uuid, uuid, text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_resolve_reconciliation(uuid, uuid, text, text, text, text, text)
to service_role;

alter function public.gallery_commit_moderation(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, text,
  uuid, text, text, bigint, integer, integer, text, uuid, timestamptz
) rename to gallery_commit_moderation_without_facebook_page;

revoke all on function public.gallery_commit_moderation_without_facebook_page(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, text,
  uuid, text, text, bigint, integer, integer, text, uuid, timestamptz
) from public, anon, authenticated, service_role;

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
  result jsonb;
  updated_submission public.gallery_submissions%rowtype;
  source_validation private.gallery_source_validations%rowtype;
  facebook_page_job public.gallery_facebook_page_publish_jobs%rowtype;
  facebook_page_status text;
  facebook_page_eligibility_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  result := public.gallery_commit_moderation_without_facebook_page(
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

  if coalesce((result ->> 'committed')::boolean, false) is not true then
    return result || jsonb_build_object('facebookPageJob', null);
  end if;

  if p_action = 'approved' then
    select *
    into updated_submission
    from public.gallery_submissions
    where id = p_submission_id;
  end if;

  if p_action = 'approved' and updated_submission.facebook_page_opt_in is true then
    select validation.*
    into source_validation
    from private.gallery_source_validations as validation
    join storage.objects as object
      on object.id = validation.storage_object_id
     and object.bucket_id = validation.storage_bucket
     and object.name = validation.storage_path
     and object.version is not distinct from validation.storage_object_version
     and object.updated_at = validation.storage_object_updated_at
     and coalesce(object.metadata ->> 'size', '') ~ '^[0-9]+$'
     and (object.metadata ->> 'size')::bigint = validation.source_size_bytes
     and lower(coalesce(object.metadata ->> 'mimetype', '')) = validation.source_mime_type
    where validation.submission_id = updated_submission.id
      and validation.storage_bucket = updated_submission.storage_bucket
      and validation.storage_path = updated_submission.storage_path
      and validation.source_mime_type = updated_submission.mime_type
      and validation.source_size_bytes = updated_submission.size_bytes
      and validation.validator_version = 'gallery-source-v1';

    if not found then
      raise exception 'Facebook Page outbox requires current source validation.' using errcode = '23514';
    end if;

    facebook_page_status := case
      when updated_submission.mime_type in ('image/jpeg', 'image/png') then 'queued'
      else 'ineligible'
    end;
    facebook_page_eligibility_reason := case
      when facebook_page_status = 'queued' then null
      else 'Facebook Page publishing supports JPEG and PNG source images only.'
    end;

    insert into public.gallery_facebook_page_publish_jobs (
      submission_id,
      status,
      eligibility_reason,
      message,
      source_mime_type,
      source_size_bytes,
      source_sha256,
      queued_by
    ) values (
      p_submission_id,
      facebook_page_status,
      facebook_page_eligibility_reason,
      left(concat_ws(
        E'\n\n',
        nullif(btrim(updated_submission.title), ''),
        nullif(btrim(updated_submission.caption), ''),
        'A pretty gameplay showcase from Mōchirīī.'
      ), 5000),
      source_validation.source_mime_type,
      source_validation.source_size_bytes,
      source_validation.source_sha256,
      p_moderator_id
    )
    returning * into facebook_page_job;

    insert into public.gallery_facebook_page_publish_events (
      job_id,
      submission_id,
      actor_id,
      action,
      details
    ) values (
      facebook_page_job.id,
      p_submission_id,
      p_moderator_id,
      facebook_page_status,
      jsonb_build_object(
        'reason', facebook_page_eligibility_reason,
        'mime_type', source_validation.source_mime_type,
        'size_bytes', source_validation.source_size_bytes
      )
    );
  end if;

  return result || jsonb_build_object(
    'facebookPageJob', case
      when facebook_page_job.id is null then null
      else jsonb_build_object(
        'id', facebook_page_job.id,
        'status', facebook_page_job.status,
        'eligibility_reason', facebook_page_job.eligibility_reason,
        'created_at', facebook_page_job.created_at
      )
    end
  );
end;
$$;

revoke all on function public.gallery_commit_moderation(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, text,
  uuid, text, text, bigint, integer, integer, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.gallery_commit_moderation(
  uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, text,
  uuid, text, text, bigint, integer, integer, text, uuid, timestamptz
) to service_role;

commit;
