begin;
select plan(33);

select has_function(
  'private',
  'attest_gallery_instagram_consent',
  array[]::text[],
  'Instagram consent attestation function exists'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.gallery_submissions'::regclass
      and tgname = 'attest_gallery_instagram_consent'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgrelid = 'public.gallery_submissions'::regclass
      and tgname = 'reject_gallery_instagram_consent_update'
      and not tgisinternal
  ),
  'Instagram consent is attested on insert and immutable on update'
);
select ok(
  has_column_privilege('authenticated', 'public.gallery_submissions', 'instagram_opt_in', 'insert')
  and has_column_privilege('authenticated', 'public.gallery_submissions', 'instagram_opt_in_contract_version', 'insert')
  and not has_column_privilege('authenticated', 'public.gallery_submissions', 'instagram_opt_in', 'update')
  and not has_column_privilege('authenticated', 'public.gallery_submissions', 'instagram_opt_in_contract_version', 'update')
  and not has_column_privilege('authenticated', 'public.gallery_submissions', 'instagram_opt_in_copy_version', 'update'),
  'browser clients can send the contract handshake but cannot update stored Instagram consent evidence'
);
select ok(
  not has_function_privilege('authenticated', 'public.gallery_instagram_begin_publish(uuid,uuid,text,text,timestamptz,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_instagram_begin_publish(uuid,uuid,text,text,timestamptz,text,text)', 'execute'),
  'Instagram claim RPC is service-role only'
);
select ok(
  not has_function_privilege('authenticated', 'public.gallery_instagram_publish_source(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_instagram_publish_source(uuid)', 'execute'),
  'Instagram source RPC is service-role only'
);
select ok(
  not has_function_privilege('authenticated', 'public.gallery_instagram_quarantine_stale_publish_jobs()', 'execute')
  and has_function_privilege('service_role', 'public.gallery_instagram_quarantine_stale_publish_jobs()', 'execute'),
  'Instagram stale-lease quarantine RPC is service-role only'
);
select ok(
  not has_function_privilege('authenticated', 'public.gallery_instagram_finish_publish(uuid,uuid,text,text,text,text,text,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_instagram_finish_publish(uuid,uuid,text,text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_instagram_resolve_reconciliation(uuid,uuid,text,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_instagram_resolve_reconciliation(uuid,uuid,text,text,text,text)', 'execute'),
  'Instagram outcome and reconciliation RPCs are service-role only'
);
select ok(
  has_table_privilege('service_role', 'public.gallery_instagram_publish_jobs', 'select')
  and not has_table_privilege('service_role', 'public.gallery_instagram_publish_jobs', 'insert')
  and not has_table_privilege('service_role', 'public.gallery_instagram_publish_jobs', 'update')
  and not has_table_privilege('service_role', 'public.gallery_instagram_publish_jobs', 'delete')
  and has_table_privilege('service_role', 'public.gallery_instagram_publish_events', 'select')
  and not has_table_privilege('service_role', 'public.gallery_instagram_publish_events', 'insert')
  and not has_table_privilege('service_role', 'public.gallery_instagram_publish_events', 'update')
  and not has_table_privilege('service_role', 'public.gallery_instagram_publish_events', 'delete'),
  'service role can inspect Instagram queue and audit rows but cannot mutate them directly'
);
select matches(
  pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid = 'public.gallery_instagram_publish_jobs'::regclass
      and conname = 'gallery_instagram_publish_jobs_status_check'
  )),
  'reconcile_required',
  'Instagram job statuses include reconciliation quarantine'
);
select matches(
  pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid = 'public.gallery_instagram_publish_events'::regclass
      and conname = 'gallery_instagram_publish_events_action_check'
  )),
  'reconciliation_resolved_not_published',
  'Instagram events include durable reconciliation actions'
);
select matches(
  pg_get_functiondef('public.gallery_instagram_begin_publish(uuid,uuid,text,text,timestamptz,text,text)'::regprocedure),
  'confirmation_fingerprint',
  'claim requires the exact current moderator confirmation fingerprint'
);
select matches(
  pg_get_functiondef('public.gallery_instagram_publish_source(uuid)'::regprocedure),
  'gallery_social_publication_attestations',
  'publisher source resolution rechecks the current confirmation attestation'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.gallery_instagram_publish_jobs'::regclass
      and tgname = 'enforce_gallery_instagram_active_job_consent'
      and not tgisinternal
  ),
  'active Instagram job states have a final exact-contract trigger guard'
);
select matches(
  pg_get_functiondef('public.gallery_instagram_resolve_reconciliation(uuid,uuid,text,text,text,text)'::regprocedure),
  'external_evidence_required',
  'published reconciliation requires external evidence'
);
select ok(
  to_regprocedure('public.gallery_instagram_mark_shared_manually(uuid,uuid,text,text)') is null
  and to_regprocedure('public.gallery_instagram_mark_shared_manually(uuid,uuid,text,text,text,text)') is null,
  'manual-share completion RPCs are absent'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '61111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'instagram-consent-owner@example.invalid',
  '',
  now(),
  now(),
  now()
);

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, caption, category,
  upload_rights_confirmed,
  instagram_opt_in, instagram_opt_in_at, instagram_opt_in_source,
  instagram_opt_in_copy_version, instagram_opt_in_contract_version
) values (
  '62222222-2222-4222-8222-222222222221',
  '61111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111111/instagram-consent.jpg',
  'image/jpeg', 1000, 'Instagram fixture', 'Approved member image.', 'scenery',
  true,
  true, '2000-01-01 00:00:00+00', 'discord_slash_command', 'forged-client-version',
  '2026-07-website-public-instagram-publish-v2'
);

select ok(
  (select instagram_opt_in_at > '2000-01-02 00:00:00+00'::timestamptz
      and instagram_opt_in_source = 'website_upload'
      and instagram_opt_in_copy_version = '2026-07-website-public-instagram-publish-v2'
      and instagram_opt_in_contract_version = '2026-07-website-public-instagram-publish-v2'
      and instagram_consent_version = '2026-07-website-public-instagram-publish-v3'
      and upload_rights_contract_version = '2026-07-gallery-upload-rights-v1'
    from public.gallery_submissions
    where id = '62222222-2222-4222-8222-222222222221'),
  'database overwrites forged Instagram consent provenance with current website attestation'
);

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, caption, category,
  instagram_opt_in, instagram_opt_in_at, instagram_opt_in_source,
  instagram_opt_in_copy_version
) values (
  '62222222-2222-4222-8222-222222222223',
  '61111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111111/instagram-stale-client.jpg',
  'image/jpeg', 1000, 'Stale browser fixture', 'Gallery only until re-consented.', 'scenery',
  true, '2000-01-01 00:00:00+00', 'website_upload', '2026-06-website-upload-v1'
);

select ok(
  (select instagram_opt_in is true
      and instagram_opt_in_source = 'website_upload'
      and instagram_opt_in_copy_version = 'gallery-instagram-opt-in-unverified-v1'
      and instagram_opt_in_contract_version is null
    from public.gallery_submissions
    where id = '62222222-2222-4222-8222-222222222223'),
  'an older cached browser remains historical and ineligible without the exact v2 handshake'
);

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, caption, category,
  instagram_opt_in, instagram_opt_in_contract_version
) values (
  '62222222-2222-4222-8222-222222222224',
  '61111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111111/instagram-forged-contract.jpg',
  'image/jpeg', 1000, 'Forged handshake fixture', 'Gallery only.', 'scenery',
  true, 'attacker-selected-version'
);

select ok(
  (select instagram_opt_in_copy_version = 'gallery-instagram-opt-in-unverified-v1'
      and instagram_opt_in_contract_version is null
    from public.gallery_submissions
    where id = '62222222-2222-4222-8222-222222222224'),
  'an arbitrary browser contract value cannot forge the current v2 attestation'
);
select throws_ok(
  $$update public.gallery_submissions
    set instagram_opt_in_copy_version = 'rewritten'
    where id = '62222222-2222-4222-8222-222222222221'$$,
  '23514',
  'Instagram consent is immutable after submission.',
  'service-level updates cannot rewrite Instagram consent provenance'
);

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, caption, category,
  instagram_opt_in, instagram_opt_in_at, instagram_opt_in_source,
  instagram_opt_in_copy_version, instagram_opt_in_contract_version
) values (
  '62222222-2222-4222-8222-222222222222',
  '61111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111111/instagram-no-consent.jpg',
  'image/jpeg', 1000, 'No consent fixture', 'Gallery only.', 'scenery',
  false, now(), 'website_upload', 'forged-client-version',
  '2026-07-website-public-instagram-publish-v2'
);

select ok(
  (select instagram_opt_in is false
      and instagram_opt_in_at is null
      and instagram_opt_in_source is null
      and instagram_opt_in_copy_version is null
      and instagram_opt_in_contract_version is null
    from public.gallery_submissions
    where id = '62222222-2222-4222-8222-222222222222'),
  'database clears provenance when Instagram consent is not granted'
);

set local session_replication_role = replica;
insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, caption, category,
  status, instagram_opt_in, instagram_opt_in_at, instagram_opt_in_source,
  instagram_opt_in_copy_version, instagram_opt_in_contract_version
) values (
  '62222222-2222-4222-8222-222222222225',
  '61111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111111/instagram-draft-v2-null-contract.jpg',
  'image/jpeg', 1000, 'Draft v2 fixture', 'Must remain ineligible.', 'scenery',
  'approved', true, now(), 'website_upload',
  '2026-07-website-public-instagram-publish-v2', null
);
set local session_replication_role = origin;

insert into public.gallery_instagram_publish_jobs (
  id, submission_id, status, caption
) values (
  '63333333-3333-4333-8333-333333333333',
  '62222222-2222-4222-8222-222222222225',
  'queued',
  'Must not queue.'
);

select ok(
  (select status = 'ineligible'
      and (
        eligibility_reason like '%consent%'
        or eligibility_reason like '%derivative%'
      )
    from public.gallery_instagram_publish_jobs
    where id = '63333333-3333-4333-8333-333333333333'),
  'an earlier-draft row without the exact contract and derivative cannot enter the active Instagram queue'
);

set local session_replication_role = replica;
update public.gallery_instagram_publish_jobs
set
  status = 'queued',
  source_mime_type = 'image/jpeg',
  source_size_bytes = 1000,
  source_sha256 = repeat('a', 64),
  social_storage_object_id = '64444444-4444-4444-8444-444444444444',
  social_storage_object_updated_at = now(),
  social_mime_type = 'image/jpeg',
  social_size_bytes = 1000,
  social_width = 1000,
  social_height = 1000,
  social_sha256 = repeat('a', 64),
  social_sanitizer_version = 'gallery-social-jpeg-v1',
  social_metadata_policy = 'jfif-only-no-app-metadata-v1'
where id = '63333333-3333-4333-8333-333333333333';
set local session_replication_role = origin;
set local "request.jwt.claim.role" = 'service_role';

select is(
  public.gallery_instagram_begin_publish(
    '63333333-3333-4333-8333-333333333333',
    '61111111-1111-4111-8111-111111111111',
    'Must not publish.',
    'Must not publish.',
    (select updated_at from public.gallery_instagram_publish_jobs
      where id = '63333333-3333-4333-8333-333333333333'),
    repeat('0', 64),
    repeat('0', 64)
  ) ->> 'reason',
  'consent_or_derivative_invalid',
  'an earlier-draft v2 row with a null contract cannot acquire a publish lease'
);

set local session_replication_role = replica;
update public.gallery_instagram_publish_jobs
set status = 'publishing'
where id = '63333333-3333-4333-8333-333333333333';
set local session_replication_role = origin;

select is(
  public.gallery_instagram_publish_source(
    '63333333-3333-4333-8333-333333333333'
  ) ->> 'reason',
  'current_confirmation_or_consent_required',
  'an earlier-draft v2 row with a null contract cannot resolve publishable media'
);

select throws_ok(
  $$select public.gallery_instagram_finish_publish(
    '63333333-3333-4333-8333-333333333333',
    '61111111-1111-4111-8111-111111111111',
    'published',
    null,
    '12345',
    'https://www.instagram.com/p/not-published/',
    null,
    '{}'::jsonb
  )$$,
  '23514',
  'Current Instagram rights and consent are required.',
  'the final published-state transition rejects an earlier-draft v2 row with a null contract'
);

-- Simulate a publishing attempt that a consent/derivative rollout quarantined
-- after the provider request may already have succeeded.
set local session_replication_role = replica;
update public.gallery_instagram_publish_jobs
set
  status = 'reconcile_required',
  social_storage_object_id = null,
  social_storage_object_version = null,
  social_storage_object_updated_at = null,
  social_mime_type = null,
  social_size_bytes = null,
  social_width = null,
  social_height = null,
  social_sha256 = null,
  social_sanitizer_version = null,
  social_metadata_policy = null,
  last_error = 'Publish attempt predates the exact consent and derivative guards.'
where id = '63333333-3333-4333-8333-333333333333';
set local session_replication_role = origin;

select throws_ok(
  $$update public.gallery_instagram_publish_jobs
    set
      status = 'published',
      instagram_media_id = '12345',
      instagram_permalink = 'https://www.instagram.com/p/direct-update-blocked/'
    where id = '63333333-3333-4333-8333-333333333333'$$,
  '23514',
  'Current Instagram rights and consent are required.',
  'a direct update cannot use the legacy reconciliation exception'
);

select is(
  public.gallery_instagram_resolve_reconciliation(
    '63333333-3333-4333-8333-333333333333',
    '61111111-1111-4111-8111-111111111111',
    'confirmed_published',
    '6789012345',
    'https://www.instagram.com/mochirii_guild/',
    'This is a profile link rather than exact post evidence.'
  ) ->> 'reason',
  'external_evidence_required',
  'confirmed publication rejects a non-canonical Instagram post permalink'
);

create temporary table instagram_reconciliation_result (
  result jsonb not null
) on commit drop;

insert into instagram_reconciliation_result (result)
select public.gallery_instagram_resolve_reconciliation(
    '63333333-3333-4333-8333-333333333333',
    '61111111-1111-4111-8111-111111111111',
    'confirmed_published',
    '6789012345',
    'https://www.instagram.com/p/verified-provider-post/',
    'Moderator verified this exact provider post before reconciliation.'
  );

select ok(
  (select (result ->> 'committed')::boolean from instagram_reconciliation_result)
  and (
    select status = 'published'
      and instagram_media_id = '6789012345'
      and instagram_permalink = 'https://www.instagram.com/p/verified-provider-post/'
    from public.gallery_instagram_publish_jobs
    where id = '63333333-3333-4333-8333-333333333333'
  )
  and exists (
    select 1
    from public.gallery_instagram_publish_events
    where job_id = '63333333-3333-4333-8333-333333333333'
      and action = 'reconciliation_resolved_published'
      and details ->> 'guard_exception_used' = 'true'
      and details ->> 'consent_contract_current' = 'false'
      and details ->> 'social_derivative_bound' = 'false'
  )
  and not exists (
    select 1 from private.gallery_instagram_reconciliation_context
    where job_id = '63333333-3333-4333-8333-333333333333'
  ),
  'an audited confirmed-published reconciliation closes a quarantined legacy attempt'
);

truncate instagram_reconciliation_result;

update public.gallery_submissions
set status = 'approved'
where id = '62222222-2222-4222-8222-222222222223';

set local session_replication_role = replica;
insert into public.gallery_instagram_publish_jobs (
  id, submission_id, status, caption, attempt_count, last_error
) values (
  '63333333-3333-4333-8333-333333333334',
  '62222222-2222-4222-8222-222222222223',
  'reconcile_required',
  'Legacy attempted post.',
  1,
  'Publish attempt predates the derivative guard.'
);
set local session_replication_role = origin;

insert into instagram_reconciliation_result (result)
select public.gallery_instagram_resolve_reconciliation(
    '63333333-3333-4333-8333-333333333334',
    '61111111-1111-4111-8111-111111111111',
    'confirmed_not_published',
    null,
    null,
    'Moderator verified that no provider post exists.'
  );

select ok(
  (select (result ->> 'committed')::boolean from instagram_reconciliation_result)
  and (
    select status = 'failed'
      and instagram_media_id is null
      and instagram_permalink is null
    from public.gallery_instagram_publish_jobs
    where id = '63333333-3333-4333-8333-333333333334'
  )
  and exists (
    select 1
    from public.gallery_instagram_publish_events
    where job_id = '63333333-3333-4333-8333-333333333334'
      and action = 'reconciliation_resolved_not_published'
      and details ->> 'guard_exception_used' = 'true'
      and details ->> 'social_derivative_bound' = 'false'
  )
  and not exists (
    select 1 from private.gallery_instagram_reconciliation_context
    where job_id = '63333333-3333-4333-8333-333333333334'
  ),
  'an audited confirmed-not-published reconciliation closes a pre-derivative attempt'
);

drop table instagram_reconciliation_result;

update public.gallery_submissions
set status = 'approved'
where id = '62222222-2222-4222-8222-222222222221';

set local session_replication_role = replica;
insert into public.gallery_instagram_publish_jobs (
  id, submission_id, status, caption,
  source_mime_type, source_size_bytes, source_sha256,
  social_storage_object_id, social_storage_object_updated_at,
  social_mime_type, social_size_bytes, social_width, social_height,
  social_sha256, social_sanitizer_version, social_metadata_policy
) values (
  '63333333-3333-4333-8333-333333333335',
  '62222222-2222-4222-8222-222222222221',
  'queued',
  'A pretty gameplay showcase from Mōchirīī.',
  'image/jpeg', 1000, repeat('b', 64),
  '64444444-4444-4444-8444-444444444445', now(),
  'image/jpeg', 1000, 1000, 1000,
  repeat('b', 64), 'gallery-social-jpeg-v1', 'jfif-only-no-app-metadata-v1'
);
set local session_replication_role = origin;

select is(
  private.gallery_instagram_job_has_current_derivative(
    '63333333-3333-4333-8333-333333333335'
  ),
  false,
  'a queued job without an exact derivative is not publishable'
);

insert into storage.objects (id, bucket_id, name, owner, metadata) values
  (
    '65000000-0000-4000-8000-000000000001',
    'member-gallery',
    '61111111-1111-4111-8111-111111111111/instagram-consent.jpg',
    '61111111-1111-4111-8111-111111111111',
    '{"size":1000,"mimetype":"image/jpeg"}'
  ),
  (
    '64444444-4444-4444-8444-444444444445',
    'member-gallery',
    '_social/submissions/62222222-2222-4222-8222-222222222221/65555555-5555-4555-8555-555555555555.jpg',
    null,
    '{"size":1000,"mimetype":"image/jpeg"}'
  );

insert into private.gallery_source_validations (
  submission_id, storage_object_id, storage_bucket, storage_path,
  storage_object_version, storage_object_updated_at, source_mime_type,
  source_size_bytes, source_width, source_height, source_sha256,
  validator_version
) select
  '62222222-2222-4222-8222-222222222221',
  source.id,
  source.bucket_id,
  source.name,
  source.version,
  source.updated_at,
  'image/jpeg', 1000, 1000, 1000, repeat('c', 64), 'gallery-source-v1'
from storage.objects as source
where source.id = '65000000-0000-4000-8000-000000000001';

insert into private.gallery_social_derivatives (
  submission_id, storage_object_id, storage_bucket, storage_path,
  storage_object_version, storage_object_updated_at, mime_type, size_bytes,
  width, height, sha256, sanitizer_version, metadata_policy, created_by,
  source_storage_object_id, source_storage_object_version,
  source_storage_object_updated_at, source_sha256, derivation_method
) select
  '62222222-2222-4222-8222-222222222221',
  social.id,
  social.bucket_id,
  social.name,
  social.version,
  social.updated_at,
  'image/jpeg', 1000, 1000, 1000, repeat('b', 64),
  'gallery-social-jpeg-v1', 'jfif-only-no-app-metadata-v1',
  '61111111-1111-4111-8111-111111111111',
  source.id, source.version, source.updated_at, repeat('c', 64),
  'jpeg-metadata-strip-v1'
from storage.objects as social
cross join storage.objects as source
where social.id = '64444444-4444-4444-8444-444444444445'
  and source.id = '65000000-0000-4000-8000-000000000001';

set local session_replication_role = replica;
update public.gallery_instagram_publish_jobs as job
set
  status = 'queued',
  eligibility_reason = null,
  caption = 'A pretty gameplay showcase from Mōchirīī.',
  alt_text = null,
  source_mime_type = derivative.mime_type,
  source_size_bytes = derivative.size_bytes,
  source_sha256 = derivative.sha256,
  social_storage_object_id = derivative.storage_object_id,
  social_storage_object_version = derivative.storage_object_version,
  social_storage_object_updated_at = derivative.storage_object_updated_at,
  social_mime_type = derivative.mime_type,
  social_size_bytes = derivative.size_bytes,
  social_width = derivative.width,
  social_height = derivative.height,
  social_sha256 = derivative.sha256,
  social_sanitizer_version = derivative.sanitizer_version,
  social_metadata_policy = derivative.metadata_policy
from private.gallery_social_derivatives as derivative
where job.id = '63333333-3333-4333-8333-333333333335'
  and derivative.submission_id = job.submission_id;
set local session_replication_role = origin;

select throws_ok(
  $$delete from storage.objects
    where id = '64444444-4444-4444-8444-444444444445'$$,
  '42501',
  'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'direct SQL cannot bypass the Storage object deletion guard'
);

set local storage.allow_delete_query = 'true';
delete from storage.objects
where id = '64444444-4444-4444-8444-444444444445';
set local storage.allow_delete_query = 'false';

select is(
  private.gallery_instagram_job_has_current_derivative(
    '63333333-3333-4333-8333-333333333335'
  ),
  false,
  'a deleted frozen derivative object invalidates the Graph publish binding'
);

insert into storage.objects (
  id, bucket_id, name, owner, metadata, version, updated_at
)
select
  storage_object_id,
  storage_bucket,
  storage_path,
  null,
  jsonb_build_object('size', size_bytes, 'mimetype', mime_type),
  storage_object_version,
  storage_object_updated_at
from private.gallery_social_derivatives
where submission_id = '62222222-2222-4222-8222-222222222221';

set local session_replication_role = replica;
update storage.objects
set metadata = '{"size":999,"mimetype":"image/jpeg"}'::jsonb
where id = '64444444-4444-4444-8444-444444444445';
set local session_replication_role = origin;

select is(
  private.gallery_instagram_job_has_current_derivative(
    '63333333-3333-4333-8333-333333333335'
  ),
  false,
  'an overwritten frozen derivative object invalidates the Graph publish binding'
);

set local session_replication_role = replica;
update storage.objects
set
  metadata = '{"size":1000,"mimetype":"image/jpeg"}'::jsonb,
  updated_at = (
    select storage_object_updated_at
    from private.gallery_social_derivatives
    where submission_id = '62222222-2222-4222-8222-222222222221'
  )
where id = '64444444-4444-4444-8444-444444444445';
set local session_replication_role = origin;

select is(
  private.gallery_instagram_job_has_current_derivative(
    '63333333-3333-4333-8333-333333333335'
  ),
  true,
  'the restored exact frozen derivative remains eligible for reviewed Graph publishing'
);

select * from finish();
rollback;
