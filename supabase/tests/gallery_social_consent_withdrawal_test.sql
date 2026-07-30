begin;
select plan(41);

select has_table(
  'private', 'gallery_upload_rights_attestations',
  'upload-rights attestations are private'
);
select has_table(
  'private', 'gallery_social_consent_records',
  'destination consent records are private'
);
select has_table(
  'private', 'gallery_social_publication_attestations',
  'second-confirmation attestations are private'
);
select has_table(
  'private', 'gallery_social_withdrawal_events',
  'withdrawal events are private'
);
select has_table(
  'private', 'gallery_social_removal_requests',
  'external-removal requests are private'
);
select has_view(
  'public', 'gallery_social_withdrawal_status',
  'members receive only the safe withdrawal-status projection'
);

select ok(
  (select bool_and(relrowsecurity)
   from pg_class
   where oid in (
     'private.gallery_upload_rights_attestations'::regclass,
     'private.gallery_social_consent_records'::regclass,
     'private.gallery_social_publication_attestations'::regclass,
     'private.gallery_social_withdrawal_events'::regclass,
     'private.gallery_social_removal_requests'::regclass,
     'private.gallery_social_withdrawal_status_projection'::regclass
   )),
  'every new table has RLS enabled'
);
select is(
  (select count(*)::bigint
   from pg_policies
   where schemaname = 'private'
     and tablename = any(array[
       'gallery_upload_rights_attestations',
       'gallery_social_consent_records',
       'gallery_social_publication_attestations',
       'gallery_social_withdrawal_events',
       'gallery_social_removal_requests'
     ]::name[])
     and policyname = 'service_only_default_deny'
     and permissive = 'RESTRICTIVE'
     and cmd = 'ALL'
     and roles @> array['anon', 'authenticated']::name[]
     and qual = 'false'
     and with_check = 'false'),
  5::bigint,
  'private evidence tables have explicit restrictive client-deny policies'
);
select ok(
  (select bool_and(
     not has_table_privilege('anon', evidence_table, privilege_name)
     and not has_table_privilege(
       'authenticated', evidence_table, privilege_name
     )
   )
   from unnest(array[
     'private.gallery_upload_rights_attestations',
     'private.gallery_social_consent_records',
     'private.gallery_social_publication_attestations',
     'private.gallery_social_withdrawal_events',
     'private.gallery_social_removal_requests'
   ]) as evidence(evidence_table)
   cross join unnest(array[
     'select', 'insert', 'update', 'delete',
     'truncate', 'references', 'trigger'
   ]) as privilege(privilege_name))
  and (select bool_and(
     has_table_privilege('service_role', evidence_table, 'select')
     and not has_table_privilege('service_role', evidence_table, 'insert')
     and not has_table_privilege('service_role', evidence_table, 'update')
     and not has_table_privilege('service_role', evidence_table, 'delete')
     and not has_table_privilege('service_role', evidence_table, 'truncate')
     and not has_table_privilege('service_role', evidence_table, 'references')
     and not has_table_privilege('service_role', evidence_table, 'trigger')
   )
   from unnest(array[
     'private.gallery_upload_rights_attestations',
     'private.gallery_social_consent_records',
     'private.gallery_social_publication_attestations',
     'private.gallery_social_withdrawal_events',
     'private.gallery_social_removal_requests'
   ]) as evidence(evidence_table)),
  'private evidence denies clients and grants service role read-only access'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'private'
      and tablename = 'gallery_social_withdrawal_status_projection'
      and policyname = 'gallery_social_withdrawal_status_owner_select'
      and roles = array['authenticated'::name]
  )
  and coalesce((
    select array_to_string(reloptions, ',')
    from pg_class
    where oid = 'public.gallery_social_withdrawal_status'::regclass
  ), '') like '%security_invoker=true%',
  'safe projection uses owner RLS through a security-invoker view'
);
select ok(
  (select count(*) = 3
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'gallery_submissions'
     and column_name in (
       'upload_rights_confirmed',
       'instagram_consent_version',
       'facebook_page_consent_version'
     ))
  and has_column_privilege(
    'authenticated', 'public.gallery_submissions',
    'upload_rights_confirmed', 'insert'
  )
  and not has_column_privilege(
    'authenticated', 'public.gallery_submissions',
    'instagram_consent_version', 'insert'
  ),
  'browser supplies only the rights boolean; server owns versions and timestamps'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_current_social_jpeg_check'
      and pg_get_constraintdef(oid) like '%mime_type = ''image/jpeg''%'
  ),
  'current public-destination consent is limited to JPEG submissions'
);
select ok(
  to_regprocedure(
    'public.gallery_withdraw_social_publication_consent(uuid,text,uuid)'
  ) is not null
  and to_regprocedure(
    'public.gallery_withdraw_social_publication_consent(uuid,text,uuid,text)'
  ) is null
  and not has_function_privilege(
    'authenticated',
    'public.gallery_withdraw_social_publication_consent(uuid,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.gallery_withdraw_social_publication_consent(uuid,text,uuid)',
    'execute'
  ),
  'withdrawal has one exact service-only owner-checked interface'
);
select ok(
  to_regprocedure(
    'public.gallery_facebook_page_begin_publish(uuid,uuid,text)'
  ) is null
  and to_regprocedure(
    'public.gallery_instagram_begin_publish(uuid,uuid,text,text)'
  ) is null
  and to_regprocedure(
    'public.gallery_facebook_page_begin_publish(uuid,uuid,text,timestamptz,text,text)'
  ) is not null
  and to_regprocedure(
    'public.gallery_instagram_begin_publish(uuid,uuid,text,text,timestamptz,text,text)'
  ) is not null,
  'unbound claim interfaces are removed and both destinations require revision plus hashes'
);

select is(
  public.gallery_social_copy_hash(
    'facebook_page', E'  Hello\r\nWorld  ', 'ignored alt'
  ),
  '8d2f3d00448d58d955d43afa7708fe0d29b1369752e422ff6da58de13659015e',
  'copy hash matches the cross-language JSON vector'
);
select is(
  public.gallery_social_confirmation_fingerprint(
    'facebook_page',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'queued',
    0,
    '2026-07-29 12:34:56.789+00'::timestamptz,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '8d2f3d00448d58d955d43afa7708fe0d29b1369752e422ff6da58de13659015e'
  ),
  'c88acb25a93ed93c8de4935594e911e6f665d9c57db750a5d69f85e5459c883a',
  'confirmation fingerprint matches the cross-language JSON vector'
);
select is(
  public.gallery_social_confirmation_fingerprint(
    'instagram',
    '63333333-3333-4333-8333-333333333333',
    'queued',
    0,
    '2026-07-29 12:34:56.123456+00'::timestamptz,
    '61111111-1111-4111-8111-111111111111',
    'd06ebe3f2589609d258c76abeca0403c9f61f4d31e58a3233a808dbffe348485'
  ),
  '74003118ae20aa1086cd77150becd5586164b5a3492a37279488866858837d0d',
  'six-digit offset timestamps canonicalize to the shared UTC-millisecond fingerprint'
);
select ok(
  private.gallery_social_copy_has_url('Visit mochirii.com for details.')
  and private.gallery_social_copy_has_url('https://example.invalid/path')
  and private.gallery_social_copy_has_url('www.example.invalid'),
  'URL-like provider copy is rejected regardless of scheme'
);
select ok(
  private.gallery_social_copy_has_url(
    'A pretty Wushu land showcase from the guild.'
  ) is false,
  'URL-free guild copy remains eligible'
);

insert into auth.users (
  id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  (
    '71111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated',
    'withdrawal-owner@example.invalid', '', now(), now(), now()
  ),
  (
    '72222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated',
    'withdrawal-other@example.invalid', '', now(), now(), now()
  ),
  (
    '73333333-3333-4333-8333-333333333333',
    'authenticated', 'authenticated',
    'withdrawal-moderator@example.invalid', '', now(), now(), now()
  );

set local session_replication_role = replica;

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, category,
  upload_rights_confirmed, upload_rights_attested_at,
  upload_rights_contract_version,
  instagram_opt_in, instagram_opt_in_at, instagram_opt_in_source,
  instagram_opt_in_copy_version, instagram_opt_in_contract_version,
  instagram_consent_version,
  facebook_page_opt_in, facebook_page_opt_in_at,
  facebook_page_opt_in_source, facebook_page_opt_in_copy_version,
  facebook_page_opt_in_contract_version, facebook_page_consent_version
) values
  (
    '74444444-4444-4444-8444-444444444441',
    '71111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111/queued.jpg',
    'image/jpeg', 1000, 'Queued withdrawal', 'scenery',
    true, now(), '2026-07-gallery-upload-rights-v1',
    true, now(), 'website_upload',
    '2026-07-website-public-instagram-publish-v2',
    '2026-07-website-public-instagram-publish-v2',
    '2026-07-website-public-instagram-publish-v3',
    true, now(), 'website_upload',
    '2026-07-website-public-facebook-page-group-v2',
    '2026-07-website-public-facebook-page-group-v2',
    '2026-07-website-public-facebook-page-group-v3'
  ),
  (
    '74444444-4444-4444-8444-444444444442',
    '71111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111/publishing.jpg',
    'image/jpeg', 1000, 'Publishing withdrawal', 'scenery',
    true, now(), '2026-07-gallery-upload-rights-v1',
    false, null, null, null, null, null,
    true, now(), 'website_upload',
    '2026-07-website-public-facebook-page-group-v2',
    '2026-07-website-public-facebook-page-group-v2',
    '2026-07-website-public-facebook-page-group-v3'
  ),
  (
    '74444444-4444-4444-8444-444444444443',
    '71111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111/published.jpg',
    'image/jpeg', 1000, 'Published withdrawal', 'scenery',
    true, now(), '2026-07-gallery-upload-rights-v1',
    false, null, null, null, null, null,
    true, now(), 'website_upload',
    '2026-07-website-public-facebook-page-group-v2',
    '2026-07-website-public-facebook-page-group-v2',
    '2026-07-website-public-facebook-page-group-v3'
  ),
  (
    '74444444-4444-4444-8444-444444444444',
    '71111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111/before-queue.jpg',
    'image/jpeg', 1000, 'Before queue withdrawal', 'scenery',
    true, now(), '2026-07-gallery-upload-rights-v1',
    false, null, null, null, null, null,
    true, now(), 'website_upload',
    '2026-07-website-public-facebook-page-group-v2',
    '2026-07-website-public-facebook-page-group-v2',
    '2026-07-website-public-facebook-page-group-v3'
  );

insert into private.gallery_upload_rights_attestations (
  submission_id, member_id, contract_version, attested_at
)
select
  id, user_id, '2026-07-gallery-upload-rights-v1',
  upload_rights_attested_at
from public.gallery_submissions
where id between
  '74444444-4444-4444-8444-444444444441'::uuid
  and '74444444-4444-4444-8444-444444444444'::uuid;

insert into private.gallery_social_consent_records (
  submission_id, member_id, destination, consent_version, consented_at,
  source_storage_object_id, source_storage_object_updated_at, source_sha256,
  derivative_storage_object_id, derivative_storage_object_updated_at,
  derivative_sha256
)
select
  submission.id,
  submission.user_id,
  destination.name,
  case destination.name
    when 'instagram' then '2026-07-website-public-instagram-publish-v3'
    else '2026-07-website-public-facebook-page-group-v3'
  end,
  coalesce(
    submission.instagram_opt_in_at,
    submission.facebook_page_opt_in_at
  ),
  gen_random_uuid(), now(), repeat('a', 64),
  gen_random_uuid(), now(), repeat('b', 64)
from public.gallery_submissions as submission
cross join lateral (
  select 'facebook_page'::text as name
  union all
  select 'instagram'::text
  where submission.instagram_opt_in is true
) as destination
where submission.id between
  '74444444-4444-4444-8444-444444444441'::uuid
  and '74444444-4444-4444-8444-444444444444'::uuid;

insert into public.gallery_facebook_page_publish_jobs (
  id, submission_id, status, message,
  source_mime_type, source_size_bytes, source_sha256,
  destination_page_id,
  social_storage_object_id, social_storage_object_updated_at,
  social_mime_type, social_size_bytes, social_width, social_height,
  social_sha256, social_sanitizer_version, social_metadata_policy,
  queued_by, published_by, published_at,
  facebook_post_id, facebook_permalink
) values
  (
    '75555555-5555-4555-8555-555555555551',
    '74444444-4444-4444-8444-444444444441',
    'queued', 'Queued copy', 'image/jpeg', 1000, repeat('b', 64),
    'facebook_page', gen_random_uuid(), now(),
    'image/jpeg', 1000, 1080, 1080, repeat('b', 64),
    'gallery-social-jpeg-v1', 'jfif-only-no-app-metadata-v1',
    '73333333-3333-4333-8333-333333333333', null, null, null, null
  ),
  (
    '75555555-5555-4555-8555-555555555552',
    '74444444-4444-4444-8444-444444444442',
    'publishing', 'Publishing copy', 'image/jpeg', 1000, repeat('b', 64),
    'facebook_page', gen_random_uuid(), now(),
    'image/jpeg', 1000, 1080, 1080, repeat('b', 64),
    'gallery-social-jpeg-v1', 'jfif-only-no-app-metadata-v1',
    '73333333-3333-4333-8333-333333333333', null, null, null, null
  ),
  (
    '75555555-5555-4555-8555-555555555553',
    '74444444-4444-4444-8444-444444444443',
    'published', 'Published copy', 'image/jpeg', 1000, repeat('b', 64),
    'facebook_page', gen_random_uuid(), now(),
    'image/jpeg', 1000, 1080, 1080, repeat('b', 64),
    'gallery-social-jpeg-v1', 'jfif-only-no-app-metadata-v1',
    '73333333-3333-4333-8333-333333333333',
    '73333333-3333-4333-8333-333333333333', now(),
    'synthetic-post-id',
    'https://www.facebook.com/facebook_page/posts/synthetic-post-id'
  );

insert into public.gallery_instagram_publish_jobs (
  id, submission_id, status, caption, alt_text,
  source_mime_type, source_size_bytes, source_sha256,
  social_storage_object_id, social_storage_object_updated_at,
  social_mime_type, social_size_bytes, social_width, social_height,
  social_sha256, social_sanitizer_version, social_metadata_policy,
  queued_by
) values (
  '76666666-6666-4666-8666-666666666666',
  '74444444-4444-4444-8444-444444444441',
  'queued', 'Independent Instagram copy', 'Member image alt text',
  'image/jpeg', 1000, repeat('b', 64),
  gen_random_uuid(), now(), 'image/jpeg', 1000, 1080, 1080,
  repeat('b', 64), 'gallery-social-jpeg-v1',
  'jfif-only-no-app-metadata-v1',
  '73333333-3333-4333-8333-333333333333'
);

set local session_replication_role = origin;
set local "request.jwt.claim.role" = 'service_role';

select throws_ok(
  $$select public.gallery_withdraw_social_publication_consent(
    '74444444-4444-4444-8444-444444444444',
    'facebook_page',
    '72222222-2222-4222-8222-222222222222'
  )$$,
  '42501',
  'Submission owner required.',
  'a different member cannot withdraw the owner consent'
);

select is(
  public.gallery_withdraw_social_publication_consent(
    '74444444-4444-4444-8444-444444444441',
    'facebook_page',
    '71111111-1111-4111-8111-111111111111'
  ) ->> 'action',
  'canceled',
  'queued destination withdrawal is atomic cancellation'
);
select is(
  (select status from public.gallery_facebook_page_publish_jobs
   where id = '75555555-5555-4555-8555-555555555551'),
  'canceled',
  'queued Facebook job is no longer publishable'
);
select is(
  (select status from public.gallery_instagram_publish_jobs
   where id = '76666666-6666-4666-8666-666666666666'),
  'queued',
  'withdrawing Facebook does not change the Instagram destination'
);
select is(
  (select count(*)::bigint
   from private.gallery_social_withdrawal_events
   where submission_id = '74444444-4444-4444-8444-444444444441'
     and destination = 'facebook_page'),
  1::bigint,
  'one immutable withdrawal event is recorded'
);
select is(
  public.gallery_withdraw_social_publication_consent(
    '74444444-4444-4444-8444-444444444441',
    'facebook_page',
    '71111111-1111-4111-8111-111111111111'
  ) ->> 'action',
  'canceled',
  'repeated withdrawal is idempotent'
);
select is(
  (select count(*)::bigint
   from private.gallery_social_withdrawal_events
   where submission_id = '74444444-4444-4444-8444-444444444441'
     and destination = 'facebook_page'),
  1::bigint,
  'idempotent withdrawal does not duplicate evidence'
);
select is(
  (select state from private.gallery_social_withdrawal_status_projection
   where submission_id = '74444444-4444-4444-8444-444444444441'
     and destination = 'facebook_page'),
  'canceled',
  'safe member projection records canceled state'
);

select is(
  public.gallery_withdraw_social_publication_consent(
    '74444444-4444-4444-8444-444444444442',
    'facebook_page',
    '71111111-1111-4111-8111-111111111111'
  ) ->> 'action',
  'quarantined',
  'publishing withdrawal enters reconciliation quarantine'
);
select is(
  (select status from public.gallery_facebook_page_publish_jobs
   where id = '75555555-5555-4555-8555-555555555552'),
  'reconcile_required',
  'ambiguous job cannot retry after withdrawal'
);
select is(
  public.gallery_withdraw_social_publication_consent(
    '74444444-4444-4444-8444-444444444442',
    'facebook_page',
    '71111111-1111-4111-8111-111111111111'
  ) ->> 'requires_moderator_inspection',
  'true',
  'quarantined withdrawal requires moderator inspection'
);
select is(
  public.gallery_facebook_page_resolve_reconciliation(
    '75555555-5555-4555-8555-555555555552',
    '73333333-3333-4333-8333-333333333333',
    'confirmed_published',
    null,
    'late-race-post',
    'https://www.facebook.com/mochirii.guild/posts/late-race-post',
    'Official Page inspection confirmed the ambiguous request published.',
    true
  ) ->> 'committed',
  'true',
  'late reconciliation can record a provider success after withdrawal'
);
select is(
  (select count(*)::bigint
   from private.gallery_social_removal_requests
   where submission_id = '74444444-4444-4444-8444-444444444442'
     and destination = 'facebook_page'),
  1::bigint,
  'late provider success after withdrawal atomically creates a removal request'
);

select is(
  public.gallery_withdraw_social_publication_consent(
    '74444444-4444-4444-8444-444444444443',
    'facebook_page',
    '71111111-1111-4111-8111-111111111111'
  ) ->> 'action',
  'removal_requested',
  'published withdrawal creates a removal request without claiming deletion'
);
select is(
  public.gallery_withdraw_social_publication_consent(
    '74444444-4444-4444-8444-444444444443',
    'facebook_page',
    '71111111-1111-4111-8111-111111111111'
  ) ->> 'removal_request_created',
  'true',
  'published withdrawal reports the durable removal request'
);
select is(
  (select count(*)::bigint
   from private.gallery_social_removal_requests
   where submission_id = '74444444-4444-4444-8444-444444444443'),
  1::bigint,
  'one removal request is retained'
);
select is(
  (select status from public.gallery_facebook_page_publish_jobs
   where id = '75555555-5555-4555-8555-555555555553'),
  'published',
  'withdrawal never pretends the external published copy was removed'
);

select is(
  public.gallery_withdraw_social_publication_consent(
    '74444444-4444-4444-8444-444444444444',
    'facebook_page',
    '71111111-1111-4111-8111-111111111111'
  ) ->> 'action',
  'withdrawn_before_queue',
  'consent can be withdrawn before moderation creates a job'
);
select is(
  public.gallery_withdraw_social_publication_consent(
    '74444444-4444-4444-8444-444444444444',
    'facebook_page',
    '71111111-1111-4111-8111-111111111111'
  ) -> 'job_status',
  'null'::jsonb,
  'before-queue withdrawal reports no job state'
);

insert into public.gallery_facebook_page_publish_jobs (
  id, submission_id, status, message,
  source_mime_type, source_size_bytes, source_sha256, queued_by
) values (
  '75555555-5555-4555-8555-555555555554',
  '74444444-4444-4444-8444-444444444444',
  'queued', 'Must remain ineligible',
  'image/jpeg', 1000, repeat('b', 64),
  '73333333-3333-4333-8333-333333333333'
);
select is(
  (select status from public.gallery_facebook_page_publish_jobs
   where id = '75555555-5555-4555-8555-555555555554'),
  'ineligible',
  'a moderation queue race after withdrawal cannot recreate a publishable job'
);

select throws_ok(
  $$update private.gallery_social_consent_records
    set consent_version = 'changed'
    where submission_id = '74444444-4444-4444-8444-444444444441'
      and destination = 'facebook_page'$$,
  '23514',
  'Gallery consent and publication audit records are immutable.',
  'original destination consent evidence cannot be rewritten'
);
select ok(
  not has_table_privilege(
    'anon', 'public.gallery_facebook_page_publish_jobs', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'public.gallery_instagram_publish_events', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'private.gallery_social_removal_requests', 'select'
  ),
  'queue, event, and removal evidence stays unavailable to browser roles'
);

select * from finish();
rollback;
