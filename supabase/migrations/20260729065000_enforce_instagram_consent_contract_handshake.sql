begin;

set local lock_timeout = '5s';

-- This append-only cutover guard also repairs review databases that applied an
-- earlier draft of the Instagram hardening migration. The browser-provided
-- contract version is a handshake, never authoritative consent provenance.
alter table public.gallery_submissions
  add column if not exists instagram_opt_in_contract_version text;

create or replace function private.attest_gallery_instagram_consent()
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

create or replace function private.reject_gallery_instagram_consent_update()
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

drop trigger if exists reject_gallery_instagram_consent_update
on public.gallery_submissions;
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
alter table public.gallery_submissions
  validate constraint gallery_submissions_instagram_contract_version_check;

with transitioned as (
  update public.gallery_instagram_publish_jobs as job
  set
    status = 'ineligible',
    eligibility_reason =
      'Instagram publication requires the exact current website consent contract handshake.',
    last_error = null,
    attempt_started_at = null
  from public.gallery_submissions as submission
  where submission.id = job.submission_id
    and job.status in ('queued', 'failed')
    and (
      submission.instagram_opt_in is not true
      or submission.instagram_opt_in_source is distinct from 'website_upload'
      or submission.instagram_opt_in_copy_version is distinct from
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
    'reason', 'exact_contract_handshake_required',
    'historical_copy_version', instagram_opt_in_copy_version,
    'historical_contract_version', instagram_opt_in_contract_version
  )
from transitioned;

with transitioned as (
  update public.gallery_instagram_publish_jobs as job
  set
    status = 'reconcile_required',
    last_error =
      'This publish attempt predates the exact website consent handshake guard. Inspect the official account before resolving it.',
    attempt_started_at = null
  from public.gallery_submissions as submission
  where submission.id = job.submission_id
    and job.status = 'publishing'
    and (
      submission.instagram_opt_in is not true
      or submission.instagram_opt_in_source is distinct from 'website_upload'
      or submission.instagram_opt_in_copy_version is distinct from
        '2026-07-website-public-instagram-publish-v2'
      or submission.instagram_opt_in_contract_version is distinct from
        '2026-07-website-public-instagram-publish-v2'
    )
  returning job.id, job.submission_id, job.attempt_count
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
    'reason', 'publish_attempt_predates_exact_contract_guard',
    'attempt_count', attempt_count
  )
from transitioned;

create function private.enforce_gallery_instagram_active_job_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_consent boolean := false;
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
    raise exception
      'Instagram active publication state requires the exact current website consent contract handshake.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_gallery_instagram_active_job_consent()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_gallery_instagram_active_job_consent
on public.gallery_instagram_publish_jobs;
create trigger enforce_gallery_instagram_active_job_consent
before insert or update of status
on public.gallery_instagram_publish_jobs
for each row
execute function private.enforce_gallery_instagram_active_job_consent();

revoke update (
  instagram_opt_in,
  instagram_opt_in_at,
  instagram_opt_in_source,
  instagram_opt_in_copy_version,
  instagram_opt_in_contract_version
) on table public.gallery_submissions from authenticated;

-- Keep older cached upload clients working through the release cutover. These
-- values are untrusted and are overwritten by the insert trigger above.
grant insert (
  instagram_opt_in,
  instagram_opt_in_at,
  instagram_opt_in_source,
  instagram_opt_in_copy_version,
  instagram_opt_in_contract_version
)
on table public.gallery_submissions to authenticated;

commit;
