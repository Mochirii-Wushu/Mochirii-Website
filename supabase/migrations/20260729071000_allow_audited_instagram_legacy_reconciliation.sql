begin;

set local lock_timeout = '5s';

-- A publish attempt quarantined by a later consent or derivative guard may
-- already have created a provider post. Keep normal claim/publish paths
-- fail-closed, but let the service-only reconciliation RPC record the verified
-- outcome. A private transaction-scoped capability makes that exception
-- unavailable to direct table updates, including direct service-role updates.
create table if not exists private.gallery_instagram_reconciliation_context (
  backend_pid integer not null,
  transaction_id bigint not null,
  job_id uuid not null,
  actor_id uuid not null,
  resolution text not null check (
    resolution in ('confirmed_published', 'confirmed_not_published')
  ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (backend_pid, transaction_id, job_id)
);

revoke all on table private.gallery_instagram_reconciliation_context
from public, anon, authenticated, service_role;

create or replace function private.gallery_instagram_reconciliation_context_allows(
  p_job_id uuid,
  p_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.gallery_instagram_reconciliation_context as context
    where context.backend_pid = pg_backend_pid()
      and context.transaction_id = txid_current()
      and context.job_id = p_job_id
      and (
        (context.resolution = 'confirmed_published' and p_status = 'published')
        or
        (context.resolution = 'confirmed_not_published' and p_status = 'failed')
      )
  );
$$;

revoke all on function private.gallery_instagram_reconciliation_context_allows(uuid, text)
from public, anon, authenticated, service_role;

-- Queued and publishing jobs must always have a frozen derivative. Terminal
-- published/failed rows are guarded by the immutable binding trigger below so
-- the audited reconciliation capability can close a pre-derivative attempt.
alter table public.gallery_instagram_publish_jobs
  drop constraint if exists gallery_instagram_publish_jobs_publishable_social_check;
alter table public.gallery_instagram_publish_jobs
  add constraint gallery_instagram_publish_jobs_publishable_social_check
  check (
    status not in ('queued', 'publishing')
    or social_storage_object_id is not null
  ) not valid;

alter table public.gallery_instagram_publish_jobs
  add constraint gallery_instagram_publish_jobs_canonical_permalink_check
  check (
    instagram_permalink is null
    or instagram_permalink ~
      '^https://www\.instagram\.com/(p|reel)/[A-Za-z0-9_-]+/$'
  ) not valid;

create or replace function private.enforce_gallery_instagram_active_job_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_consent boolean := false;
  audited_reconciliation boolean := false;
begin
  if new.status not in ('queued', 'publishing', 'published') then
    return new;
  end if;

  select (
    submission.instagram_opt_in is true
    and submission.instagram_opt_in_source = 'website_upload'
    and submission.instagram_opt_in_copy_version =
      '2026-07-website-public-instagram-publish-v2'
    and submission.instagram_opt_in_contract_version =
      '2026-07-website-public-instagram-publish-v2'
  )
  into current_consent
  from public.gallery_submissions as submission
  where submission.id = new.submission_id;

  if coalesce(current_consent, false) is not true then
    if new.status = 'queued' then
      new.status := 'ineligible';
      new.eligibility_reason :=
        'Instagram publication requires the exact current website consent contract handshake.';
      return new;
    end if;

    audited_reconciliation := (
      tg_op = 'UPDATE'
      and old.status = 'reconcile_required'
      and new.status = 'published'
      and private.gallery_instagram_reconciliation_context_allows(
        new.id,
        new.status
      )
    );
    if audited_reconciliation then
      return new;
    end if;

    raise exception
      'Instagram active publication state requires the exact current website consent contract handshake.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_gallery_instagram_active_job_consent()
from public, anon, authenticated, service_role;

create or replace function private.guard_gallery_instagram_job_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audited_reconciliation boolean := false;
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
    audited_reconciliation := (
      old.status = 'reconcile_required'
      and new.status in ('published', 'failed')
      and private.gallery_instagram_reconciliation_context_allows(
        new.id,
        new.status
      )
    );
    if not audited_reconciliation then
      raise exception 'Instagram publishing requires a frozen social derivative.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_gallery_instagram_job_binding()
from public, anon, authenticated, service_role;

create or replace function public.gallery_instagram_resolve_reconciliation(
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
  consent_contract_current boolean := false;
  social_derivative_bound boolean := false;
  guard_exception_used boolean := false;
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
      or resolved_permalink !~
        '^https://www\.instagram\.com/(p|reel)/[A-Za-z0-9_-]+/$'
    )
  then
    return jsonb_build_object(
      'committed', false,
      'reason', 'external_evidence_required',
      'status', current_job.status
    );
  end if;

  select (
    submission.instagram_opt_in is true
    and submission.instagram_opt_in_source = 'website_upload'
    and submission.instagram_opt_in_copy_version =
      '2026-07-website-public-instagram-publish-v2'
    and submission.instagram_opt_in_contract_version =
      '2026-07-website-public-instagram-publish-v2'
  )
  into consent_contract_current
  from public.gallery_submissions as submission
  where submission.id = current_job.submission_id;

  social_derivative_bound := current_job.social_storage_object_id is not null;
  guard_exception_used :=
    coalesce(consent_contract_current, false) is not true
    or social_derivative_bound is not true;

  event_action := case p_resolution
    when 'confirmed_published' then 'reconciliation_resolved_published'
    else 'reconciliation_resolved_not_published'
  end;

  insert into private.gallery_instagram_reconciliation_context (
    backend_pid,
    transaction_id,
    job_id,
    actor_id,
    resolution
  ) values (
    pg_backend_pid(),
    txid_current(),
    current_job.id,
    p_actor_id,
    p_resolution
  );

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
      'instagram_permalink', updated_job.instagram_permalink,
      'guard_exception_used', guard_exception_used,
      'consent_contract_current', coalesce(consent_contract_current, false),
      'social_derivative_bound', social_derivative_bound
    )
  );

  delete from private.gallery_instagram_reconciliation_context
  where backend_pid = pg_backend_pid()
    and transaction_id = txid_current()
    and job_id = current_job.id;

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

create or replace function private.gallery_instagram_job_has_current_derivative(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gallery_instagram_publish_jobs as job
    join public.gallery_submissions as submission
      on submission.id = job.submission_id
    join private.gallery_social_derivatives as derivative
      on derivative.submission_id = job.submission_id
     and derivative.storage_object_id = job.social_storage_object_id
     and derivative.storage_object_version is not distinct from
       job.social_storage_object_version
     and derivative.storage_object_updated_at =
       job.social_storage_object_updated_at
     and derivative.mime_type = job.social_mime_type
     and derivative.size_bytes = job.social_size_bytes
     and derivative.width = job.social_width
     and derivative.height = job.social_height
     and derivative.sha256 = job.social_sha256
     and derivative.sanitizer_version = job.social_sanitizer_version
     and derivative.metadata_policy = job.social_metadata_policy
     and derivative.mime_type = job.source_mime_type
     and derivative.size_bytes = job.source_size_bytes
     and derivative.sha256 = job.source_sha256
    join private.gallery_source_validations as source_validation
      on source_validation.submission_id = submission.id
     and source_validation.storage_object_id =
       derivative.source_storage_object_id
     and source_validation.storage_object_version is not distinct from
       derivative.source_storage_object_version
     and source_validation.storage_object_updated_at =
       derivative.source_storage_object_updated_at
     and source_validation.storage_bucket = submission.storage_bucket
     and source_validation.storage_path = submission.storage_path
     and source_validation.source_mime_type = submission.mime_type
     and source_validation.source_size_bytes = submission.size_bytes
     and source_validation.source_width = derivative.width
     and source_validation.source_height = derivative.height
     and source_validation.source_sha256 = derivative.source_sha256
     and source_validation.validator_version = 'gallery-source-v1'
    join storage.objects as social_object
      on social_object.id = derivative.storage_object_id
     and social_object.bucket_id = derivative.storage_bucket
     and social_object.name = derivative.storage_path
     and social_object.version is not distinct from
       derivative.storage_object_version
     and social_object.updated_at = derivative.storage_object_updated_at
    join storage.objects as source_object
      on source_object.id = derivative.source_storage_object_id
     and source_object.bucket_id = source_validation.storage_bucket
     and source_object.name = source_validation.storage_path
     and source_object.version is not distinct from
       derivative.source_storage_object_version
     and source_object.updated_at =
       derivative.source_storage_object_updated_at
    where job.id = p_job_id
      and derivative.storage_bucket = 'member-gallery'
      and derivative.storage_path ~ (
        '^_social/submissions/' || submission.id::text ||
        '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
      )
      and case
        when coalesce(social_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (social_object.metadata ->> 'size')::bigint
        else null
      end = derivative.size_bytes
      and lower(coalesce(social_object.metadata ->> 'mimetype', '')) =
        derivative.mime_type
      and case
        when coalesce(source_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (source_object.metadata ->> 'size')::bigint
        else null
      end = source_validation.source_size_bytes
      and lower(coalesce(source_object.metadata ->> 'mimetype', '')) =
        source_validation.source_mime_type
      and derivative.derivation_method = 'jpeg-metadata-strip-v1'
  );
$$;

revoke all on function private.gallery_instagram_job_has_current_derivative(uuid)
from public, anon, authenticated, service_role;

-- Old queued rows may predate the exact frozen derivative contract. They must
-- not remain actionable after this migration.
with transitioned as (
  update public.gallery_instagram_publish_jobs as job
  set
    status = 'ineligible',
    eligibility_reason =
      'Instagram publishing requires the exact current frozen social derivative.',
    last_error = null,
    attempt_started_at = null
  where job.status = 'queued'
    and private.gallery_instagram_job_has_current_derivative(job.id) is not true
  returning job.id, job.submission_id
)
insert into public.gallery_instagram_publish_events (
  job_id, submission_id, actor_id, action, details
)
select
  id,
  submission_id,
  null,
  'ineligible',
  jsonb_build_object('reason', 'current_social_derivative_binding_missing')
from transitioned;

-- Manual completion cannot prove which private derivative a moderator posted.
-- Keep the historical status readable, but remove every database mutation RPC.
drop function if exists public.gallery_instagram_mark_shared_manually(
  uuid, uuid, text, text
);
drop function if exists public.gallery_instagram_mark_shared_manually(
  uuid, uuid, text, text, text, text
);

-- Edge functions may inspect queue and audit state, but every mutation is now
-- constrained to one of the service-only, security-definer lifecycle RPCs.
revoke all on table public.gallery_instagram_publish_jobs from service_role;
grant select on table public.gallery_instagram_publish_jobs to service_role;
revoke all on table public.gallery_instagram_publish_events from service_role;
grant select on table public.gallery_instagram_publish_events to service_role;

commit;
