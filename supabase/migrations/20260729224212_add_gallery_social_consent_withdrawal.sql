begin;

set local lock_timeout = '5s';

-- Current website submissions use a server-owned rights attestation and a
-- destination-specific consent version. The earlier opt-in columns remain as
-- compatibility fields for the unreleased queue functions; the immutable
-- ledgers below are authoritative for every new API publication.
alter table public.gallery_submissions
  add column upload_rights_confirmed boolean not null default false,
  add column upload_rights_attested_at timestamptz,
  add column upload_rights_contract_version text,
  add column instagram_consent_version text,
  add column facebook_page_consent_version text;

alter table public.gallery_submissions
  add constraint gallery_submissions_upload_rights_check
  check (
    (
      upload_rights_confirmed is false
      and upload_rights_attested_at is null
      and upload_rights_contract_version is null
    )
    or (
      upload_rights_confirmed is true
      and submission_source = 'website'
      and upload_rights_attested_at is not null
      and upload_rights_contract_version =
        '2026-07-gallery-upload-rights-v1'
    )
  ),
  add constraint gallery_submissions_instagram_consent_v3_check
  check (
    instagram_consent_version is null
    or (
      instagram_opt_in is true
      and instagram_opt_in_source = 'website_upload'
      and instagram_consent_version =
        '2026-07-website-public-instagram-publish-v3'
      and upload_rights_confirmed is true
      and upload_rights_contract_version =
        '2026-07-gallery-upload-rights-v1'
    )
  ),
  add constraint gallery_submissions_facebook_consent_v3_check
  check (
    facebook_page_consent_version is null
    or (
      facebook_page_opt_in is true
      and facebook_page_opt_in_source = 'website_upload'
      and facebook_page_consent_version =
        '2026-07-website-public-facebook-page-group-v3'
      and upload_rights_confirmed is true
      and upload_rights_contract_version =
        '2026-07-gallery-upload-rights-v1'
    )
  ),
  add constraint gallery_submissions_current_social_jpeg_check
  check (
    (
      instagram_consent_version is null
      and facebook_page_consent_version is null
    )
    or mime_type = 'image/jpeg'
  );

revoke insert (
  upload_rights_attested_at,
  upload_rights_contract_version,
  instagram_consent_version,
  facebook_page_consent_version
) on table public.gallery_submissions from authenticated;
grant insert (upload_rights_confirmed)
on table public.gallery_submissions to authenticated;
revoke update (
  upload_rights_confirmed,
  upload_rights_attested_at,
  upload_rights_contract_version,
  instagram_consent_version,
  facebook_page_consent_version
) on table public.gallery_submissions from authenticated;

create table private.gallery_upload_rights_attestations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  member_id uuid not null,
  contract_version text not null,
  attested_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint gallery_upload_rights_contract_check
    check (contract_version = '2026-07-gallery-upload-rights-v1')
);

create table private.gallery_social_consent_records (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  member_id uuid not null,
  destination text not null,
  consent_version text not null,
  consented_at timestamptz not null,
  source_storage_object_id uuid not null,
  source_storage_object_version text,
  source_storage_object_updated_at timestamptz not null,
  source_sha256 text not null,
  derivative_storage_object_id uuid not null,
  derivative_storage_object_version text,
  derivative_storage_object_updated_at timestamptz not null,
  derivative_sha256 text not null,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint gallery_social_consent_destination_check
    check (destination in ('instagram', 'facebook_page')),
  constraint gallery_social_consent_version_check
    check (
      (destination = 'instagram' and consent_version =
        '2026-07-website-public-instagram-publish-v3')
      or
      (destination = 'facebook_page' and consent_version =
        '2026-07-website-public-facebook-page-group-v3')
    ),
  constraint gallery_social_consent_source_sha_check
    check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint gallery_social_consent_derivative_sha_check
    check (derivative_sha256 ~ '^[0-9a-f]{64}$'),
  constraint gallery_social_consent_submission_destination_key
    unique (submission_id, destination)
);

create table private.gallery_social_publication_attestations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  destination text not null,
  job_id uuid not null,
  moderator_id uuid not null,
  confirmed_job_status text not null,
  confirmed_attempt_count integer not null,
  attempt_number integer not null,
  confirmed_job_updated_at timestamptz not null,
  copy_hash text not null,
  confirmation_fingerprint text not null unique,
  confirmed_at timestamptz not null default clock_timestamp(),
  constraint gallery_social_attestation_destination_check
    check (destination in ('instagram', 'facebook_page')),
  constraint gallery_social_attestation_status_check
    check (confirmed_job_status in ('queued', 'failed')),
  constraint gallery_social_attestation_attempt_check
    check (
      confirmed_attempt_count >= 0
      and attempt_number = confirmed_attempt_count + 1
    ),
  constraint gallery_social_attestation_copy_hash_check
    check (copy_hash ~ '^[0-9a-f]{64}$'),
  constraint gallery_social_attestation_fingerprint_check
    check (confirmation_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint gallery_social_attestation_attempt_key
    unique (destination, job_id, attempt_number)
);

create table private.gallery_social_withdrawal_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  member_id uuid not null,
  destination text not null,
  consent_record_id uuid,
  job_id uuid,
  job_state_before text,
  outcome text not null,
  reason text,
  requested_at timestamptz not null default clock_timestamp(),
  constraint gallery_social_withdrawal_destination_check
    check (destination in ('instagram', 'facebook_page')),
  constraint gallery_social_withdrawal_outcome_check
    check (outcome in (
      'withdrawn_before_queue', 'canceled', 'quarantined',
      'removal_requested'
    )),
  constraint gallery_social_withdrawal_reason_check
    check (reason is null or char_length(reason) <= 500),
  constraint gallery_social_withdrawal_once_key
    unique (submission_id, destination)
);

create table private.gallery_social_removal_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  member_id uuid not null,
  destination text not null,
  job_id uuid not null,
  withdrawal_event_id uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  constraint gallery_social_removal_destination_check
    check (destination in ('instagram', 'facebook_page')),
  constraint gallery_social_removal_once_key
    unique (submission_id, destination)
);

create table private.gallery_social_withdrawal_status_projection (
  submission_id uuid not null,
  member_id uuid not null,
  destination text not null,
  state text not null,
  external_removal_required boolean not null default false,
  requested_at timestamptz not null,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (submission_id, destination),
  constraint gallery_social_withdrawal_projection_destination_check
    check (destination in ('instagram', 'facebook_page')),
  constraint gallery_social_withdrawal_projection_state_check
    check (state in (
      'withdrawn_before_queue', 'canceled', 'quarantined',
      'removal_requested'
    ))
);

alter table private.gallery_upload_rights_attestations enable row level security;
alter table private.gallery_social_consent_records enable row level security;
alter table private.gallery_social_publication_attestations enable row level security;
alter table private.gallery_social_withdrawal_events enable row level security;
alter table private.gallery_social_removal_requests enable row level security;
alter table private.gallery_social_withdrawal_status_projection enable row level security;

create policy service_only_default_deny
on private.gallery_upload_rights_attestations
as restrictive for all to anon, authenticated
using (false) with check (false);

create policy service_only_default_deny
on private.gallery_social_consent_records
as restrictive for all to anon, authenticated
using (false) with check (false);

create policy service_only_default_deny
on private.gallery_social_publication_attestations
as restrictive for all to anon, authenticated
using (false) with check (false);

create policy service_only_default_deny
on private.gallery_social_withdrawal_events
as restrictive for all to anon, authenticated
using (false) with check (false);

create policy service_only_default_deny
on private.gallery_social_removal_requests
as restrictive for all to anon, authenticated
using (false) with check (false);

revoke all on table
  private.gallery_upload_rights_attestations,
  private.gallery_social_consent_records,
  private.gallery_social_publication_attestations,
  private.gallery_social_withdrawal_events,
  private.gallery_social_removal_requests,
  private.gallery_social_withdrawal_status_projection
from public, anon, authenticated, service_role;

grant select on table
  private.gallery_upload_rights_attestations,
  private.gallery_social_consent_records,
  private.gallery_social_publication_attestations,
  private.gallery_social_withdrawal_events,
  private.gallery_social_removal_requests,
  private.gallery_social_withdrawal_status_projection
to service_role;

grant select on table private.gallery_social_withdrawal_status_projection
to authenticated;

create policy gallery_social_withdrawal_status_owner_select
on private.gallery_social_withdrawal_status_projection
for select to authenticated
using ((select auth.uid()) = member_id);

create view public.gallery_social_withdrawal_status
with (security_invoker = true)
as
select
  submission_id,
  destination,
  state,
  external_removal_required,
  requested_at,
  updated_at
from private.gallery_social_withdrawal_status_projection;

revoke all on table public.gallery_social_withdrawal_status
from public, anon, authenticated, service_role;
grant select on table public.gallery_social_withdrawal_status
to authenticated, service_role;

create or replace function private.reject_gallery_immutable_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Gallery consent and publication audit records are immutable.'
    using errcode = '23514';
end;
$$;

revoke all on function private.reject_gallery_immutable_audit_mutation()
from public, anon, authenticated, service_role;

create trigger reject_gallery_upload_rights_attestation_mutation
before update or delete on private.gallery_upload_rights_attestations
for each row execute function private.reject_gallery_immutable_audit_mutation();
create trigger reject_gallery_social_consent_mutation
before update or delete on private.gallery_social_consent_records
for each row execute function private.reject_gallery_immutable_audit_mutation();
create trigger reject_gallery_social_publication_attestation_mutation
before update or delete on private.gallery_social_publication_attestations
for each row execute function private.reject_gallery_immutable_audit_mutation();
create trigger reject_gallery_social_withdrawal_event_mutation
before update or delete on private.gallery_social_withdrawal_events
for each row execute function private.reject_gallery_immutable_audit_mutation();
create trigger reject_gallery_social_removal_request_mutation
before update or delete on private.gallery_social_removal_requests
for each row execute function private.reject_gallery_immutable_audit_mutation();

create or replace function private.gallery_request_is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', ''),
    ''
  ) = 'service_role';
$$;

revoke all on function private.gallery_request_is_service_role()
from public, anon, authenticated, service_role;

create function private.attest_gallery_upload_rights()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.submission_source = 'website'
    and new.upload_rights_confirmed is true
  then
    new.upload_rights_attested_at := clock_timestamp();
    new.upload_rights_contract_version :=
      '2026-07-gallery-upload-rights-v1';
  else
    new.upload_rights_confirmed := false;
    new.upload_rights_attested_at := null;
    new.upload_rights_contract_version := null;
  end if;
  return new;
end;
$$;

revoke all on function private.attest_gallery_upload_rights()
from public, anon, authenticated, service_role;

create trigger attest_gallery_upload_rights
before insert on public.gallery_submissions
for each row execute function private.attest_gallery_upload_rights();

create function private.reject_gallery_upload_rights_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.upload_rights_confirmed is distinct from old.upload_rights_confirmed
    or new.upload_rights_attested_at is distinct from old.upload_rights_attested_at
    or new.upload_rights_contract_version is distinct from old.upload_rights_contract_version
    or new.instagram_opt_in is distinct from old.instagram_opt_in
    or new.instagram_opt_in_at is distinct from old.instagram_opt_in_at
    or new.instagram_opt_in_source is distinct from old.instagram_opt_in_source
    or new.instagram_opt_in_copy_version is distinct from old.instagram_opt_in_copy_version
    or new.instagram_opt_in_contract_version is distinct from old.instagram_opt_in_contract_version
    or new.instagram_consent_version is distinct from old.instagram_consent_version
    or new.facebook_page_opt_in is distinct from old.facebook_page_opt_in
    or new.facebook_page_opt_in_at is distinct from old.facebook_page_opt_in_at
    or new.facebook_page_opt_in_source is distinct from old.facebook_page_opt_in_source
    or new.facebook_page_opt_in_copy_version is distinct from old.facebook_page_opt_in_copy_version
    or new.facebook_page_opt_in_contract_version is distinct from old.facebook_page_opt_in_contract_version
    or new.facebook_page_consent_version is distinct from old.facebook_page_consent_version
  then
    raise exception 'Gallery upload rights and consent evidence are immutable.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_gallery_upload_rights_update()
from public, anon, authenticated, service_role;

create trigger reject_gallery_upload_rights_update
before update of
  upload_rights_confirmed,
  upload_rights_attested_at,
  upload_rights_contract_version,
  instagram_opt_in,
  instagram_opt_in_at,
  instagram_opt_in_source,
  instagram_opt_in_copy_version,
  instagram_opt_in_contract_version,
  instagram_consent_version,
  facebook_page_opt_in,
  facebook_page_opt_in_at,
  facebook_page_opt_in_source,
  facebook_page_opt_in_copy_version,
  facebook_page_opt_in_contract_version,
  facebook_page_consent_version
on public.gallery_submissions
for each row execute function private.reject_gallery_upload_rights_update();

create or replace function private.attest_gallery_instagram_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.instagram_opt_in is true then
    new.instagram_opt_in_at := clock_timestamp();
    new.instagram_opt_in_source := case new.submission_source
      when 'website' then 'website_upload'
      when 'discord' then 'discord_slash_command'
      else null
    end;

    if new.submission_source = 'website'
      and new.upload_rights_confirmed is true
    then
      -- The v2 columns are compatibility inputs for the unreleased queue
      -- creator. The v3 server-owned column and ledger are authoritative.
      new.instagram_opt_in_copy_version :=
        '2026-07-website-public-instagram-publish-v2';
      new.instagram_opt_in_contract_version :=
        '2026-07-website-public-instagram-publish-v2';
      new.instagram_consent_version :=
        '2026-07-website-public-instagram-publish-v3';
    else
      new.instagram_opt_in_copy_version := case new.submission_source
        when 'website' then 'gallery-instagram-opt-in-unverified-v1'
        when 'discord' then '2026-06-discord-submit-v1'
        else null
      end;
      new.instagram_opt_in_contract_version := null;
      new.instagram_consent_version := null;
    end if;
  else
    new.instagram_opt_in_at := null;
    new.instagram_opt_in_source := null;
    new.instagram_opt_in_copy_version := null;
    new.instagram_opt_in_contract_version := null;
    new.instagram_consent_version := null;
  end if;
  return new;
end;
$$;

revoke all on function private.attest_gallery_instagram_consent()
from public, anon, authenticated, service_role;

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

    if new.submission_source = 'website'
      and new.upload_rights_confirmed is true
    then
      new.facebook_page_opt_in_copy_version :=
        '2026-07-website-public-facebook-page-group-v2';
      new.facebook_page_opt_in_contract_version :=
        '2026-07-website-public-facebook-page-group-v2';
      new.facebook_page_consent_version :=
        '2026-07-website-public-facebook-page-group-v3';
    else
      new.facebook_page_opt_in_copy_version := case new.submission_source
        when 'website' then 'gallery-facebook-page-opt-in-unverified-v1'
        when 'discord' then 'gallery-facebook-page-opt-in-v1'
        else null
      end;
      new.facebook_page_opt_in_contract_version := null;
      new.facebook_page_consent_version := null;
    end if;
  else
    new.facebook_page_opt_in_at := null;
    new.facebook_page_opt_in_source := null;
    new.facebook_page_opt_in_copy_version := null;
    new.facebook_page_opt_in_contract_version := null;
    new.facebook_page_consent_version := null;
  end if;
  return new;
end;
$$;

revoke all on function private.attest_gallery_facebook_page_consent()
from public, anon, authenticated, service_role;

create function private.record_gallery_upload_rights_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.upload_rights_confirmed is true
    and new.upload_rights_contract_version =
      '2026-07-gallery-upload-rights-v1'
  then
    insert into private.gallery_upload_rights_attestations (
      submission_id, member_id, contract_version, attested_at
    ) values (
      new.id,
      new.user_id,
      new.upload_rights_contract_version,
      new.upload_rights_attested_at
    );
  end if;
  return new;
end;
$$;

revoke all on function private.record_gallery_upload_rights_attestation()
from public, anon, authenticated, service_role;

create trigger record_gallery_upload_rights_attestation
after insert on public.gallery_submissions
for each row execute function private.record_gallery_upload_rights_attestation();

create function private.gallery_social_submission_has_current_consent(
  p_submission_id uuid,
  p_destination text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      submission.upload_rights_confirmed is true
      and submission.upload_rights_contract_version =
        '2026-07-gallery-upload-rights-v1'
      and exists (
        select 1
        from private.gallery_upload_rights_attestations as rights
        where rights.submission_id = submission.id
          and rights.member_id = submission.user_id
      )
      and case p_destination
        when 'instagram' then
          submission.instagram_opt_in is true
          and submission.instagram_opt_in_source = 'website_upload'
          and submission.instagram_consent_version =
            '2026-07-website-public-instagram-publish-v3'
        when 'facebook_page' then
          submission.facebook_page_opt_in is true
          and submission.facebook_page_opt_in_source = 'website_upload'
          and submission.facebook_page_consent_version =
            '2026-07-website-public-facebook-page-group-v3'
        else false
      end
      and not exists (
        select 1
        from private.gallery_social_withdrawal_events as withdrawal
        where withdrawal.submission_id = submission.id
          and withdrawal.destination = p_destination
      )
    from public.gallery_submissions as submission
    where submission.id = p_submission_id
  ), false);
$$;

revoke all on function private.gallery_social_submission_has_current_consent(uuid, text)
from public, anon, authenticated, service_role;

create or replace function private.enforce_gallery_instagram_active_job_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  consent_ok boolean := false;
  audited_reconciliation boolean := false;
begin
  if new.status not in ('queued', 'publishing', 'published') then return new; end if;

  if tg_op = 'INSERT' then
    consent_ok := private.gallery_social_submission_has_current_consent(
      new.submission_id, 'instagram'
    );
  else
    consent_ok := exists (
      select 1
      from private.gallery_social_consent_records as consent
      where consent.submission_id = new.submission_id
        and consent.destination = 'instagram'
    ) and not exists (
      select 1
      from private.gallery_social_withdrawal_events as withdrawal
      where withdrawal.submission_id = new.submission_id
        and withdrawal.destination = 'instagram'
    );
  end if;

  if consent_ok is not true then
    if new.status = 'queued' then
      new.status := 'ineligible';
      new.eligibility_reason :=
        'Current Instagram rights and destination consent are required.';
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
    if audited_reconciliation then return new; end if;

    raise exception 'Current Instagram rights and consent are required.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_gallery_instagram_active_job_consent()
from public, anon, authenticated, service_role;

create or replace function private.enforce_gallery_facebook_active_job_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  consent_ok boolean := false;
begin
  if new.status not in ('queued', 'publishing') then return new; end if;

  if tg_op = 'INSERT' then
    consent_ok := private.gallery_social_submission_has_current_consent(
      new.submission_id, 'facebook_page'
    );
  else
    consent_ok := exists (
      select 1
      from private.gallery_social_consent_records as consent
      where consent.submission_id = new.submission_id
        and consent.destination = 'facebook_page'
    ) and not exists (
      select 1
      from private.gallery_social_withdrawal_events as withdrawal
      where withdrawal.submission_id = new.submission_id
        and withdrawal.destination = 'facebook_page'
    );
  end if;

  if consent_ok is not true then
    if new.status = 'queued' then
      new.status := 'ineligible';
      new.eligibility_reason :=
        'Current Facebook Page rights and destination consent are required.';
      return new;
    end if;
    raise exception 'Current Facebook Page rights and consent are required.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_gallery_facebook_active_job_consent()
from public, anon, authenticated, service_role;

create function private.record_gallery_social_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  destination_name text;
  submission public.gallery_submissions%rowtype;
  derivative private.gallery_social_derivatives%rowtype;
  consent_version text;
  consented_at timestamptz;
begin
  destination_name := case tg_table_name
    when 'gallery_instagram_publish_jobs' then 'instagram'
    when 'gallery_facebook_page_publish_jobs' then 'facebook_page'
    else null
  end;
  if destination_name is null or new.status <> 'queued' then return new; end if;
  if private.gallery_social_submission_has_current_consent(
    new.submission_id, destination_name
  ) is not true then return new; end if;

  select * into submission
  from public.gallery_submissions
  where id = new.submission_id;
  select * into derivative
  from private.gallery_social_derivatives
  where submission_id = new.submission_id;
  if not found then
    raise exception 'Current destination consent requires a frozen derivative.'
      using errcode = '23514';
  end if;

  consent_version := case destination_name
    when 'instagram' then submission.instagram_consent_version
    else submission.facebook_page_consent_version
  end;
  consented_at := case destination_name
    when 'instagram' then submission.instagram_opt_in_at
    else submission.facebook_page_opt_in_at
  end;

  insert into private.gallery_social_consent_records (
    submission_id,
    member_id,
    destination,
    consent_version,
    consented_at,
    source_storage_object_id,
    source_storage_object_version,
    source_storage_object_updated_at,
    source_sha256,
    derivative_storage_object_id,
    derivative_storage_object_version,
    derivative_storage_object_updated_at,
    derivative_sha256
  ) values (
    submission.id,
    submission.user_id,
    destination_name,
    consent_version,
    consented_at,
    derivative.source_storage_object_id,
    derivative.source_storage_object_version,
    derivative.source_storage_object_updated_at,
    derivative.source_sha256,
    derivative.storage_object_id,
    derivative.storage_object_version,
    derivative.storage_object_updated_at,
    derivative.sha256
  ) on conflict (submission_id, destination) do nothing;
  return new;
end;
$$;

revoke all on function private.record_gallery_social_consent()
from public, anon, authenticated, service_role;

create trigger record_gallery_instagram_consent
after insert on public.gallery_instagram_publish_jobs
for each row execute function private.record_gallery_social_consent();
create trigger record_gallery_facebook_consent
after insert on public.gallery_facebook_page_publish_jobs
for each row execute function private.record_gallery_social_consent();

-- Existing v1/v2 jobs retain their audit history, but no historical consent is
-- relabeled as v3. Ambiguous attempts are quarantined; never retry them.
with transitioned as (
  update public.gallery_instagram_publish_jobs
  set
    status = 'ineligible',
    eligibility_reason =
      'This legacy Instagram job has no current rights and consent attestation.',
    last_error = null,
    attempt_started_at = null
  where status in ('queued', 'failed')
  returning id, submission_id
)
insert into public.gallery_instagram_publish_events (
  job_id, submission_id, actor_id, action, details
)
select id, submission_id, null, 'ineligible',
  jsonb_build_object('reason', 'legacy_consent_not_upgraded')
from transitioned;

with transitioned as (
  update public.gallery_instagram_publish_jobs
  set
    status = 'reconcile_required',
    last_error =
      'A legacy Instagram attempt requires official-account reconciliation.',
    attempt_started_at = null
  where status = 'publishing'
  returning id, submission_id, attempt_count
)
insert into public.gallery_instagram_publish_events (
  job_id, submission_id, actor_id, action, details
)
select id, submission_id, null, 'reconcile_required',
  jsonb_build_object(
    'reason', 'legacy_publish_attempt_quarantined',
    'attempt_count', attempt_count
  )
from transitioned;

with transitioned as (
  update public.gallery_facebook_page_publish_jobs
  set
    status = 'ineligible',
    eligibility_reason =
      'This legacy Facebook Page job has no current rights and consent attestation.',
    last_error = null,
    attempt_started_at = null
  where status in ('queued', 'failed')
  returning id, submission_id
)
insert into public.gallery_facebook_page_publish_events (
  job_id, submission_id, actor_id, action, details
)
select id, submission_id, null, 'ineligible',
  jsonb_build_object('reason', 'legacy_consent_not_upgraded')
from transitioned;

with transitioned as (
  update public.gallery_facebook_page_publish_jobs
  set
    status = 'reconcile_required',
    last_error =
      'A legacy Facebook Page attempt requires official-Page reconciliation.',
    attempt_started_at = null
  where status = 'publishing'
  returning id, submission_id, attempt_count
)
insert into public.gallery_facebook_page_publish_events (
  job_id, submission_id, actor_id, action, details
)
select id, submission_id, null, 'reconcile_required',
  jsonb_build_object(
    'reason', 'legacy_publish_attempt_quarantined',
    'attempt_count', attempt_count
  )
from transitioned;

alter table public.gallery_instagram_publish_jobs
  add column confirmation_copy_hash text,
  add column confirmation_fingerprint text,
  add column confirmation_moderator_id uuid,
  add column confirmation_job_updated_at timestamptz,
  add column confirmation_confirmed_at timestamptz,
  add constraint gallery_instagram_confirmation_binding_check
  check (
    (
      confirmation_copy_hash is null
      and confirmation_fingerprint is null
      and confirmation_moderator_id is null
      and confirmation_job_updated_at is null
      and confirmation_confirmed_at is null
    )
    or (
      confirmation_copy_hash ~ '^[0-9a-f]{64}$'
      and confirmation_fingerprint ~ '^[0-9a-f]{64}$'
      and confirmation_moderator_id is not null
      and confirmation_job_updated_at is not null
      and confirmation_confirmed_at is not null
    )
  );

alter table public.gallery_facebook_page_publish_jobs
  add column confirmation_copy_hash text,
  add column confirmation_fingerprint text,
  add column confirmation_moderator_id uuid,
  add column confirmation_job_updated_at timestamptz,
  add column confirmation_confirmed_at timestamptz,
  add constraint gallery_facebook_confirmation_binding_check
  check (
    (
      confirmation_copy_hash is null
      and confirmation_fingerprint is null
      and confirmation_moderator_id is null
      and confirmation_job_updated_at is null
      and confirmation_confirmed_at is null
    )
    or (
      confirmation_copy_hash ~ '^[0-9a-f]{64}$'
      and confirmation_fingerprint ~ '^[0-9a-f]{64}$'
      and confirmation_moderator_id is not null
      and confirmation_job_updated_at is not null
      and confirmation_confirmed_at is not null
    )
  );

create function public.gallery_social_copy_hash(
  p_destination text,
  p_primary_copy text,
  p_alt_text text default null
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  normalized_primary text;
  normalized_alt text;
  payload text;
begin
  if p_destination not in ('instagram', 'facebook_page') then
    raise exception 'Invalid social destination.' using errcode = '22023';
  end if;
  normalized_primary := btrim(replace(replace(
    normalize(coalesce(p_primary_copy, ''), NFC), E'\r\n', E'\n'
  ), E'\r', E'\n'));
  normalized_alt := btrim(replace(replace(
    normalize(coalesce(p_alt_text, ''), NFC), E'\r\n', E'\n'
  ), E'\r', E'\n'));
  if p_destination = 'facebook_page' then normalized_alt := ''; end if;

  payload := '[' ||
    to_json('gallery-social-copy-v1'::text)::text || ',' ||
    to_json(p_destination)::text || ',' ||
    to_json(normalized_primary)::text || ',' ||
    to_json(normalized_alt)::text || ']';
  return encode(extensions.digest(convert_to(payload, 'UTF8'), 'sha256'), 'hex');
end;
$$;

revoke all on function public.gallery_social_copy_hash(text, text, text)
from public, anon, authenticated;
grant execute on function public.gallery_social_copy_hash(text, text, text)
to service_role;

create function private.gallery_social_copy_has_url(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value, '') ~* (
    '(^|[^[:alnum:]_])' ||
    '(https?://|www[.]|[[:alnum:]-]+([.][[:alnum:]-]+)+([^[:alnum:]_-]|$))'
  );
$$;

revoke all on function private.gallery_social_copy_has_url(text)
from public, anon, authenticated, service_role;

create function public.gallery_social_confirmation_fingerprint(
  p_destination text,
  p_job_id uuid,
  p_status text,
  p_attempt_count integer,
  p_updated_at timestamptz,
  p_moderator_id uuid,
  p_copy_hash text
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  canonical_updated_at text;
  payload text;
begin
  if p_destination not in ('instagram', 'facebook_page')
    or p_status not in ('queued', 'failed')
    or p_attempt_count < 0
    or p_copy_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invalid social confirmation input.' using errcode = '22023';
  end if;
  canonical_updated_at := to_char(
    p_updated_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  payload := '[' ||
    to_json('gallery-social-confirmation-v1'::text)::text || ',' ||
    to_json(p_destination)::text || ',' ||
    to_json(lower(p_job_id::text))::text || ',' ||
    to_json(p_status)::text || ',' ||
    p_attempt_count::text || ',' ||
    to_json(canonical_updated_at)::text || ',' ||
    to_json(lower(p_moderator_id::text))::text || ',' ||
    to_json(lower(p_copy_hash))::text || ']';
  return encode(extensions.digest(convert_to(payload, 'UTF8'), 'sha256'), 'hex');
end;
$$;

revoke all on function public.gallery_social_confirmation_fingerprint(
  text, uuid, text, integer, timestamptz, uuid, text
) from public, anon, authenticated;
grant execute on function public.gallery_social_confirmation_fingerprint(
  text, uuid, text, integer, timestamptz, uuid, text
) to service_role;

-- The database stores only a destination class. The expected numeric Page
-- identity is independently pinned in Edge secrets and verified at Meta.
alter table public.gallery_facebook_page_publish_jobs
  drop constraint if exists gallery_facebook_page_publish_jobs_destination_check;
update public.gallery_facebook_page_publish_jobs
set destination_page_id = 'facebook_page';
alter table public.gallery_facebook_page_publish_jobs
  alter column destination_page_id set default 'facebook_page',
  add constraint gallery_facebook_page_publish_jobs_destination_check
    check (destination_page_id = 'facebook_page');
comment on column public.gallery_facebook_page_publish_jobs.destination_page_id is
  'Compatibility destination class only; never a provider identifier.';

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
  new.destination_page_id := 'facebook_page';
  new.message := coalesce(
    nullif(btrim(new.message), ''),
    'A pretty gameplay showcase from Mōchirīī.'
  );
  select * into submission
  from public.gallery_submissions
  where id = new.submission_id;

  if not found
    or submission.facebook_page_opt_in is not true
    or submission.facebook_page_consent_version is distinct from
      '2026-07-website-public-facebook-page-group-v3'
    or private.gallery_social_submission_has_current_consent(
      new.submission_id, 'facebook_page'
    ) is not true
  then
    new.status := 'ineligible';
    new.eligibility_reason :=
      'Current Facebook Page rights and destination consent are required.';
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
      'A source-bound metadata-stripped JPEG derivative is required.';
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

create or replace function private.guard_gallery_facebook_page_job_binding()
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
    raise exception 'Facebook Page destination and derivative binding are immutable.'
      using errcode = '23514';
  end if;
  if new.destination_page_id <> 'facebook_page' then
    raise exception 'Invalid Facebook Page destination class.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_gallery_facebook_page_job_binding()
from public, anon, authenticated, service_role;

drop function if exists public.gallery_facebook_page_begin_publish(uuid, uuid, text);

create function public.gallery_facebook_page_begin_publish(
  p_job_id uuid,
  p_actor_id uuid,
  p_message text,
  p_expected_updated_at timestamptz,
  p_confirmation_fingerprint text,
  p_confirmation_copy_hash text
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
  computed_copy_hash text;
  computed_fingerprint text;
  event_action text;
begin
  if private.gallery_request_is_service_role() is not true then
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
      'committed', false, 'reason', 'job_not_publishable',
      'status', current_job.status
    );
  end if;
  if p_expected_updated_at is null
    or current_job.updated_at is distinct from p_expected_updated_at
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'stale_job_revision',
      'status', current_job.status
    );
  end if;
  if current_job.destination_page_id <> 'facebook_page'
    or not exists (
      select 1
      from private.gallery_social_consent_records as consent
      where consent.submission_id = current_job.submission_id
        and consent.destination = 'facebook_page'
        and consent.derivative_storage_object_id =
          current_job.social_storage_object_id
        and consent.derivative_storage_object_version is not distinct from
          current_job.social_storage_object_version
        and consent.derivative_storage_object_updated_at =
          current_job.social_storage_object_updated_at
        and consent.derivative_sha256 = current_job.social_sha256
    )
    or exists (
      select 1
      from private.gallery_social_withdrawal_events as withdrawal
      where withdrawal.submission_id = current_job.submission_id
        and withdrawal.destination = 'facebook_page'
    )
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'consent_or_derivative_invalid',
      'status', current_job.status
    );
  end if;

  next_message := btrim(replace(replace(normalize(coalesce(
    nullif(p_message, ''), current_job.message, ''
  ), NFC), E'\r\n', E'\n'), E'\r', E'\n'));
  if char_length(next_message) > 5000 then
    raise exception 'Facebook Page message is too long.' using errcode = '22023';
  end if;
  if private.gallery_social_copy_has_url(next_message) then
    return jsonb_build_object(
      'committed', false, 'reason', 'public_copy_must_not_contain_links',
      'status', current_job.status
    );
  end if;
  computed_copy_hash := public.gallery_social_copy_hash(
    'facebook_page', next_message, ''
  );
  if p_confirmation_copy_hash !~ '^[0-9a-f]{64}$'
    or lower(p_confirmation_copy_hash) <> computed_copy_hash
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'confirmation_copy_mismatch',
      'status', current_job.status
    );
  end if;
  computed_fingerprint := public.gallery_social_confirmation_fingerprint(
    'facebook_page',
    current_job.id,
    current_job.status,
    current_job.attempt_count,
    current_job.updated_at,
    p_actor_id,
    computed_copy_hash
  );
  if p_confirmation_fingerprint !~ '^[0-9a-f]{64}$'
    or lower(p_confirmation_fingerprint) <> computed_fingerprint
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'confirmation_fingerprint_mismatch',
      'status', current_job.status
    );
  end if;

  insert into private.gallery_social_publication_attestations (
    submission_id,
    destination,
    job_id,
    moderator_id,
    confirmed_job_status,
    confirmed_attempt_count,
    attempt_number,
    confirmed_job_updated_at,
    copy_hash,
    confirmation_fingerprint
  ) values (
    current_job.submission_id,
    'facebook_page',
    current_job.id,
    p_actor_id,
    current_job.status,
    current_job.attempt_count,
    current_job.attempt_count + 1,
    current_job.updated_at,
    computed_copy_hash,
    computed_fingerprint
  );

  event_action := case
    when current_job.status = 'failed' then 'retry'
    else 'publishing'
  end;
  update public.gallery_facebook_page_publish_jobs
  set
    status = 'publishing',
    message = next_message,
    last_error = null,
    attempt_count = attempt_count + 1,
    attempt_started_at = clock_timestamp(),
    confirmation_copy_hash = computed_copy_hash,
    confirmation_fingerprint = computed_fingerprint,
    confirmation_moderator_id = p_actor_id,
    confirmation_job_updated_at = current_job.updated_at,
    confirmation_confirmed_at = clock_timestamp()
  where id = current_job.id
    and status = current_job.status
    and attempt_count = current_job.attempt_count
    and updated_at = current_job.updated_at
  returning * into updated_job;
  if not found then
    raise exception 'Facebook Page claim changed while locked.' using errcode = '40001';
  end if;

  insert into public.gallery_facebook_page_publish_events (
    job_id, submission_id, actor_id, action, details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    event_action,
    jsonb_build_object(
      'attempt_count', updated_job.attempt_count,
      'confirmation_attested', true,
      'destination', 'facebook_page'
    )
  );
  return jsonb_build_object(
    'committed', true,
    'job', jsonb_build_object(
      'id', updated_job.id,
      'submission_id', updated_job.submission_id,
      'status', updated_job.status,
      'message', updated_job.message,
      'attempt_count', updated_job.attempt_count,
      'updated_at', updated_job.updated_at
    )
  );
end;
$$;

revoke all on function public.gallery_facebook_page_begin_publish(
  uuid, uuid, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_begin_publish(
  uuid, uuid, text, timestamptz, text, text
) to service_role;

drop function if exists public.gallery_instagram_begin_publish(
  uuid, uuid, text, text
);

create function public.gallery_instagram_begin_publish(
  p_job_id uuid,
  p_actor_id uuid,
  p_caption text,
  p_alt_text text,
  p_expected_updated_at timestamptz,
  p_confirmation_fingerprint text,
  p_confirmation_copy_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_instagram_publish_jobs%rowtype;
  updated_job public.gallery_instagram_publish_jobs%rowtype;
  next_caption text;
  next_alt_text text;
  computed_copy_hash text;
  computed_fingerprint text;
  event_action text;
begin
  if private.gallery_request_is_service_role() is not true then
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
      'committed', false, 'reason', 'job_not_publishable',
      'status', current_job.status
    );
  end if;
  if p_expected_updated_at is null
    or current_job.updated_at is distinct from p_expected_updated_at
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'stale_job_revision',
      'status', current_job.status
    );
  end if;
  if not exists (
    select 1
    from private.gallery_social_consent_records as consent
    where consent.submission_id = current_job.submission_id
      and consent.destination = 'instagram'
      and consent.derivative_storage_object_id =
        current_job.social_storage_object_id
      and consent.derivative_storage_object_version is not distinct from
        current_job.social_storage_object_version
      and consent.derivative_storage_object_updated_at =
        current_job.social_storage_object_updated_at
      and consent.derivative_sha256 = current_job.social_sha256
  ) or exists (
    select 1
    from private.gallery_social_withdrawal_events as withdrawal
    where withdrawal.submission_id = current_job.submission_id
      and withdrawal.destination = 'instagram'
  ) then
    return jsonb_build_object(
      'committed', false, 'reason', 'consent_or_derivative_invalid',
      'status', current_job.status
    );
  end if;

  next_caption := btrim(replace(replace(normalize(coalesce(
    nullif(p_caption, ''), current_job.caption, ''
  ), NFC), E'\r\n', E'\n'), E'\r', E'\n'));
  next_alt_text := btrim(replace(replace(normalize(coalesce(
    nullif(p_alt_text, ''), current_job.alt_text, ''
  ), NFC), E'\r\n', E'\n'), E'\r', E'\n'));
  if char_length(next_caption) > 2200
    or char_length(next_alt_text) not between 1 and 1000
  then
    raise exception 'Instagram caption or alt text is invalid.' using errcode = '22023';
  end if;
  if private.gallery_social_copy_has_url(next_caption)
    or private.gallery_social_copy_has_url(next_alt_text)
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'public_copy_must_not_contain_links',
      'status', current_job.status
    );
  end if;
  computed_copy_hash := public.gallery_social_copy_hash(
    'instagram', next_caption, next_alt_text
  );
  if p_confirmation_copy_hash !~ '^[0-9a-f]{64}$'
    or lower(p_confirmation_copy_hash) <> computed_copy_hash
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'confirmation_copy_mismatch',
      'status', current_job.status
    );
  end if;
  computed_fingerprint := public.gallery_social_confirmation_fingerprint(
    'instagram',
    current_job.id,
    current_job.status,
    current_job.attempt_count,
    current_job.updated_at,
    p_actor_id,
    computed_copy_hash
  );
  if p_confirmation_fingerprint !~ '^[0-9a-f]{64}$'
    or lower(p_confirmation_fingerprint) <> computed_fingerprint
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'confirmation_fingerprint_mismatch',
      'status', current_job.status
    );
  end if;

  insert into private.gallery_social_publication_attestations (
    submission_id,
    destination,
    job_id,
    moderator_id,
    confirmed_job_status,
    confirmed_attempt_count,
    attempt_number,
    confirmed_job_updated_at,
    copy_hash,
    confirmation_fingerprint
  ) values (
    current_job.submission_id,
    'instagram',
    current_job.id,
    p_actor_id,
    current_job.status,
    current_job.attempt_count,
    current_job.attempt_count + 1,
    current_job.updated_at,
    computed_copy_hash,
    computed_fingerprint
  );

  event_action := case
    when current_job.status = 'failed' then 'retry'
    else 'publishing'
  end;
  update public.gallery_instagram_publish_jobs
  set
    status = 'publishing',
    caption = next_caption,
    alt_text = next_alt_text,
    last_error = null,
    attempt_count = attempt_count + 1,
    attempt_started_at = clock_timestamp(),
    confirmation_copy_hash = computed_copy_hash,
    confirmation_fingerprint = computed_fingerprint,
    confirmation_moderator_id = p_actor_id,
    confirmation_job_updated_at = current_job.updated_at,
    confirmation_confirmed_at = clock_timestamp()
  where id = current_job.id
    and status = current_job.status
    and attempt_count = current_job.attempt_count
    and updated_at = current_job.updated_at
  returning * into updated_job;
  if not found then
    raise exception 'Instagram claim changed while locked.' using errcode = '40001';
  end if;

  insert into public.gallery_instagram_publish_events (
    job_id, submission_id, actor_id, action, details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    event_action,
    jsonb_build_object(
      'attempt_count', updated_job.attempt_count,
      'confirmation_attested', true,
      'destination', 'instagram'
    )
  );
  return jsonb_build_object(
    'committed', true,
    'job', jsonb_build_object(
      'id', updated_job.id,
      'submission_id', updated_job.submission_id,
      'status', updated_job.status,
      'caption', updated_job.caption,
      'alt_text', updated_job.alt_text,
      'attempt_count', updated_job.attempt_count,
      'updated_at', updated_job.updated_at
    )
  );
end;
$$;

revoke all on function public.gallery_instagram_begin_publish(
  uuid, uuid, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.gallery_instagram_begin_publish(
  uuid, uuid, text, text, timestamptz, text, text
) to service_role;

create function private.guard_gallery_social_confirmation_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  destination_name text;
begin
  destination_name := case tg_table_name
    when 'gallery_instagram_publish_jobs' then 'instagram'
    when 'gallery_facebook_page_publish_jobs' then 'facebook_page'
    else null
  end;
  if destination_name is null then
    raise exception 'Unknown social publication destination.' using errcode = '23514';
  end if;

  if new.status = 'publishing'
    and (
      new.confirmation_copy_hash is null
      or new.confirmation_fingerprint is null
      or new.confirmation_moderator_id is null
      or new.confirmation_job_updated_at is null
      or new.confirmation_confirmed_at is null
    )
  then
    raise exception 'Publishing requires a current moderator confirmation.'
      using errcode = '23514';
  end if;

  if new.confirmation_fingerprint is not null
    and not exists (
      select 1
      from private.gallery_social_publication_attestations as attestation
      where attestation.destination = destination_name
        and attestation.job_id = new.id
        and attestation.attempt_number = new.attempt_count
        and attestation.moderator_id = new.confirmation_moderator_id
        and attestation.copy_hash = new.confirmation_copy_hash
        and attestation.confirmation_fingerprint =
          new.confirmation_fingerprint
        and attestation.confirmed_job_updated_at =
          new.confirmation_job_updated_at
    )
  then
    raise exception 'Publication confirmation attestation is missing or stale.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_gallery_social_confirmation_binding()
from public, anon, authenticated, service_role;

create trigger guard_gallery_instagram_confirmation_binding
before update on public.gallery_instagram_publish_jobs
for each row execute function private.guard_gallery_social_confirmation_binding();
create trigger guard_gallery_facebook_confirmation_binding
before update on public.gallery_facebook_page_publish_jobs
for each row execute function private.guard_gallery_social_confirmation_binding();

alter function public.gallery_instagram_publish_source(uuid)
rename to gallery_instagram_publish_source_without_confirmation;
revoke all on function public.gallery_instagram_publish_source_without_confirmation(uuid)
from public, anon, authenticated, service_role;

create function public.gallery_instagram_publish_source(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_instagram_publish_jobs%rowtype;
begin
  if private.gallery_request_is_service_role() is not true then
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
  if current_job.confirmation_fingerprint is null
    or not exists (
      select 1
      from private.gallery_social_publication_attestations as attestation
      where attestation.destination = 'instagram'
        and attestation.job_id = current_job.id
        and attestation.attempt_number = current_job.attempt_count
        and attestation.confirmation_fingerprint =
          current_job.confirmation_fingerprint
    )
    or not exists (
      select 1
      from private.gallery_social_consent_records as consent
      where consent.submission_id = current_job.submission_id
        and consent.destination = 'instagram'
        and consent.derivative_sha256 = current_job.social_sha256
    )
    or exists (
      select 1
      from private.gallery_social_withdrawal_events as withdrawal
      where withdrawal.submission_id = current_job.submission_id
        and withdrawal.destination = 'instagram'
    )
  then
    return jsonb_build_object(
      'ok', false, 'reason', 'current_confirmation_or_consent_required'
    );
  end if;
  return public.gallery_instagram_publish_source_without_confirmation(p_job_id);
end;
$$;

revoke all on function public.gallery_instagram_publish_source(uuid)
from public, anon, authenticated;
grant execute on function public.gallery_instagram_publish_source(uuid)
to service_role;

alter function public.gallery_facebook_page_publish_source(uuid)
rename to gallery_facebook_page_publish_source_without_confirmation;
revoke all on function public.gallery_facebook_page_publish_source_without_confirmation(uuid)
from public, anon, authenticated, service_role;

create function public.gallery_facebook_page_publish_source(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_facebook_page_publish_jobs%rowtype;
begin
  if private.gallery_request_is_service_role() is not true then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  select * into current_job
  from public.gallery_facebook_page_publish_jobs
  where id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'job_not_found');
  end if;
  if current_job.status <> 'publishing' then
    return jsonb_build_object('ok', false, 'reason', 'job_not_publishing');
  end if;
  if current_job.destination_page_id <> 'facebook_page'
    or current_job.confirmation_fingerprint is null
    or not exists (
      select 1
      from private.gallery_social_publication_attestations as attestation
      where attestation.destination = 'facebook_page'
        and attestation.job_id = current_job.id
        and attestation.attempt_number = current_job.attempt_count
        and attestation.confirmation_fingerprint =
          current_job.confirmation_fingerprint
    )
    or not exists (
      select 1
      from private.gallery_social_consent_records as consent
      where consent.submission_id = current_job.submission_id
        and consent.destination = 'facebook_page'
        and consent.derivative_sha256 = current_job.social_sha256
    )
    or exists (
      select 1
      from private.gallery_social_withdrawal_events as withdrawal
      where withdrawal.submission_id = current_job.submission_id
        and withdrawal.destination = 'facebook_page'
    )
  then
    return jsonb_build_object(
      'ok', false, 'reason', 'current_confirmation_or_consent_required'
    );
  end if;
  return public.gallery_facebook_page_publish_source_without_confirmation(p_job_id);
end;
$$;

revoke all on function public.gallery_facebook_page_publish_source(uuid)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_publish_source(uuid)
to service_role;

create function public.gallery_withdraw_social_publication_consent(
  p_submission_id uuid,
  p_destination text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.gallery_submissions%rowtype;
  existing_event private.gallery_social_withdrawal_events%rowtype;
  consent_record private.gallery_social_consent_records%rowtype;
  instagram_job public.gallery_instagram_publish_jobs%rowtype;
  facebook_job public.gallery_facebook_page_publish_jobs%rowtype;
  selected_job_id uuid;
  selected_job_status text;
  result_job_status text;
  outcome_name text;
  removal_required boolean := false;
  withdrawal_id uuid;
  requested_time timestamptz;
begin
  if private.gallery_request_is_service_role() is not true then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_destination not in ('instagram', 'facebook_page') then
    raise exception 'Invalid social destination.' using errcode = '22023';
  end if;
  select * into submission
  from public.gallery_submissions
  where id = p_submission_id
  for update;
  if not found then
    return jsonb_build_object('committed', false, 'reason', 'submission_not_found');
  end if;
  if submission.user_id is distinct from p_actor_id then
    raise exception 'Submission owner required.' using errcode = '42501';
  end if;
  if not (
    (p_destination = 'instagram' and submission.instagram_opt_in is true)
    or
    (p_destination = 'facebook_page' and submission.facebook_page_opt_in is true)
  ) then
    return jsonb_build_object('committed', false, 'reason', 'destination_not_selected');
  end if;

  select * into existing_event
  from private.gallery_social_withdrawal_events
  where submission_id = p_submission_id
    and destination = p_destination;
  if found then
    return jsonb_build_object(
      'committed', true,
      'action', existing_event.outcome,
      'job_status', case existing_event.outcome
        when 'canceled' then 'canceled'
        when 'quarantined' then 'reconcile_required'
        when 'removal_requested' then existing_event.job_state_before
        else null
      end,
      'requires_moderator_inspection',
        existing_event.outcome in ('quarantined', 'removal_requested'),
      'removal_request_created', exists (
        select 1
        from private.gallery_social_removal_requests as removal
        where removal.submission_id = p_submission_id
          and removal.destination = p_destination
      )
    );
  end if;

  select * into consent_record
  from private.gallery_social_consent_records
  where submission_id = p_submission_id
    and destination = p_destination;

  if p_destination = 'instagram' then
    select * into instagram_job
    from public.gallery_instagram_publish_jobs
    where submission_id = p_submission_id
    for update;
    if found then
      selected_job_id := instagram_job.id;
      selected_job_status := instagram_job.status;
    end if;
  else
    select * into facebook_job
    from public.gallery_facebook_page_publish_jobs
    where submission_id = p_submission_id
    for update;
    if found then
      selected_job_id := facebook_job.id;
      selected_job_status := facebook_job.status;
    end if;
  end if;

  if selected_job_id is null then
    outcome_name := 'withdrawn_before_queue';
    result_job_status := null;
  elsif selected_job_status in ('queued', 'failed', 'ineligible', 'canceled') then
    outcome_name := 'canceled';
    result_job_status := 'canceled';
    if p_destination = 'instagram' then
      update public.gallery_instagram_publish_jobs
      set
        status = 'canceled',
        eligibility_reason = 'Member withdrew Instagram publication consent.',
        last_error = null,
        attempt_started_at = null
      where id = selected_job_id;
      insert into public.gallery_instagram_publish_events (
        job_id, submission_id, actor_id, action, details
      ) values (
        selected_job_id, p_submission_id, p_actor_id, 'canceled',
        jsonb_build_object('reason', 'member_consent_withdrawn')
      );
    else
      update public.gallery_facebook_page_publish_jobs
      set
        status = 'canceled',
        eligibility_reason = 'Member withdrew Facebook Page publication consent.',
        last_error = null,
        attempt_started_at = null
      where id = selected_job_id;
      insert into public.gallery_facebook_page_publish_events (
        job_id, submission_id, actor_id, action, details
      ) values (
        selected_job_id, p_submission_id, p_actor_id, 'canceled',
        jsonb_build_object('reason', 'member_consent_withdrawn')
      );
    end if;
  elsif selected_job_status in ('publishing', 'reconcile_required') then
    outcome_name := 'quarantined';
    result_job_status := 'reconcile_required';
    if p_destination = 'instagram' then
      update public.gallery_instagram_publish_jobs
      set
        status = 'reconcile_required',
        last_error =
          'Member withdrew consent during an ambiguous publish attempt; inspect the official account.',
        attempt_started_at = null
      where id = selected_job_id;
      insert into public.gallery_instagram_publish_events (
        job_id, submission_id, actor_id, action, details
      ) values (
        selected_job_id, p_submission_id, p_actor_id,
        'reconcile_required',
        jsonb_build_object('reason', 'member_consent_withdrawn_during_attempt')
      );
    else
      update public.gallery_facebook_page_publish_jobs
      set
        status = 'reconcile_required',
        last_error =
          'Member withdrew consent during an ambiguous publish attempt; inspect the official Page.',
        attempt_started_at = null
      where id = selected_job_id;
      insert into public.gallery_facebook_page_publish_events (
        job_id, submission_id, actor_id, action, details
      ) values (
        selected_job_id, p_submission_id, p_actor_id,
        'reconcile_required',
        jsonb_build_object('reason', 'member_consent_withdrawn_during_attempt')
      );
    end if;
  elsif selected_job_status in ('published', 'shared_manually') then
    outcome_name := 'removal_requested';
    result_job_status := selected_job_status;
    removal_required := true;
  else
    raise exception 'Unsupported publication state.' using errcode = '23514';
  end if;

  insert into private.gallery_social_withdrawal_events (
    submission_id,
    member_id,
    destination,
    consent_record_id,
    job_id,
    job_state_before,
    outcome,
    reason
  ) values (
    p_submission_id,
    p_actor_id,
    p_destination,
    consent_record.id,
    selected_job_id,
    selected_job_status,
    outcome_name,
    null
  ) returning id, requested_at into withdrawal_id, requested_time;

  if removal_required then
    insert into private.gallery_social_removal_requests (
      submission_id,
      member_id,
      destination,
      job_id,
      withdrawal_event_id,
      requested_at
    ) values (
      p_submission_id,
      p_actor_id,
      p_destination,
      selected_job_id,
      withdrawal_id,
      requested_time
    );
  end if;

  insert into private.gallery_social_withdrawal_status_projection (
    submission_id,
    member_id,
    destination,
    state,
    external_removal_required,
    requested_at,
    updated_at
  ) values (
    p_submission_id,
    p_actor_id,
    p_destination,
    outcome_name,
    removal_required,
    requested_time,
    statement_timestamp()
  )
  on conflict (submission_id, destination) do update
  set
    state = excluded.state,
    external_removal_required = excluded.external_removal_required,
    requested_at = excluded.requested_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'committed', true,
    'action', outcome_name,
    'job_status', result_job_status,
    'requires_moderator_inspection',
      outcome_name in ('quarantined', 'removal_requested'),
    'removal_request_created', removal_required
  );
end;
$$;

revoke all on function public.gallery_withdraw_social_publication_consent(
  uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.gallery_withdraw_social_publication_consent(
  uuid, text, uuid
) to service_role;

create function private.record_gallery_removal_after_late_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  destination_name text;
  withdrawal private.gallery_social_withdrawal_events%rowtype;
begin
  if new.status not in ('published', 'shared_manually')
    or new.status is not distinct from old.status
  then
    return new;
  end if;
  destination_name := case tg_table_name
    when 'gallery_instagram_publish_jobs' then 'instagram'
    when 'gallery_facebook_page_publish_jobs' then 'facebook_page'
    else null
  end;
  select * into withdrawal
  from private.gallery_social_withdrawal_events
  where submission_id = new.submission_id
    and destination = destination_name;
  if not found then return new; end if;

  insert into private.gallery_social_removal_requests (
    submission_id,
    member_id,
    destination,
    job_id,
    withdrawal_event_id,
    requested_at
  ) values (
    new.submission_id,
    withdrawal.member_id,
    destination_name,
    new.id,
    withdrawal.id,
    clock_timestamp()
  ) on conflict (submission_id, destination) do nothing;

  insert into private.gallery_social_withdrawal_status_projection (
    submission_id,
    member_id,
    destination,
    state,
    external_removal_required,
    requested_at,
    updated_at
  ) values (
    new.submission_id,
    withdrawal.member_id,
    destination_name,
    'removal_requested',
    true,
    withdrawal.requested_at,
    statement_timestamp()
  ) on conflict (submission_id, destination) do update
  set
    state = 'removal_requested',
    external_removal_required = true,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function private.record_gallery_removal_after_late_publication()
from public, anon, authenticated, service_role;

create trigger record_instagram_removal_after_late_publication
after update of status on public.gallery_instagram_publish_jobs
for each row execute function private.record_gallery_removal_after_late_publication();
create trigger record_facebook_removal_after_late_publication
after update of status on public.gallery_facebook_page_publish_jobs
for each row execute function private.record_gallery_removal_after_late_publication();

create index gallery_social_consent_member_idx
on private.gallery_social_consent_records (member_id, recorded_at desc);
create index gallery_social_attestation_job_idx
on private.gallery_social_publication_attestations
  (destination, job_id, attempt_number desc);
create index gallery_social_withdrawal_member_idx
on private.gallery_social_withdrawal_events (member_id, requested_at desc);
create index gallery_social_removal_member_idx
on private.gallery_social_removal_requests (member_id, requested_at desc);

comment on table private.gallery_social_consent_records is
  'Immutable server-attested destination consent bound to source-object and sanitized-derivative evidence.';
comment on table private.gallery_social_publication_attestations is
  'Immutable second-confirmation fingerprints for one destination, job revision, copy revision, moderator, and attempt.';
comment on function public.gallery_withdraw_social_publication_consent(
  uuid, text, uuid
) is
  'Service-only atomic member consent withdrawal. Cancels safe jobs, quarantines ambiguous attempts, and records removal requests for public copies.';

commit;
