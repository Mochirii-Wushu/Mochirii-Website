begin;
select plan(64);

select has_column('public', 'gallery_submissions', 'facebook_page_opt_in', 'Facebook Page consent boolean exists');
select has_column('public', 'gallery_submissions', 'facebook_page_opt_in_at', 'Facebook Page consent timestamp exists');
select has_column('public', 'gallery_submissions', 'facebook_page_opt_in_source', 'Facebook Page consent source exists');
select has_column('public', 'gallery_submissions', 'facebook_page_opt_in_copy_version', 'Facebook Page consent copy version exists');
select has_column('public', 'gallery_submissions', 'facebook_page_opt_in_contract_version', 'Facebook Page consent handshake version exists');
select has_table('public', 'gallery_facebook_page_publish_jobs', 'Facebook Page publish jobs exist');
select has_table('public', 'gallery_facebook_page_publish_events', 'Facebook Page publish events exist');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_facebook_page_opt_in_consistency_check'
      and convalidated
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_facebook_page_contract_version_check'
      and convalidated
  ),
  'Facebook Page consent consistency is validated'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.gallery_facebook_page_publish_jobs'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.gallery_facebook_page_publish_events'::regclass),
  'Facebook Page outbox tables have RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.gallery_facebook_page_publish_jobs', 'select')
  and not has_table_privilege('authenticated', 'public.gallery_facebook_page_publish_jobs', 'select')
  and not has_table_privilege('anon', 'public.gallery_facebook_page_publish_events', 'select')
  and not has_table_privilege('authenticated', 'public.gallery_facebook_page_publish_events', 'select')
  and has_table_privilege('service_role', 'public.gallery_facebook_page_publish_jobs', 'select')
  and has_table_privilege('service_role', 'public.gallery_facebook_page_publish_events', 'select')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_jobs', 'insert')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_jobs', 'update')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_jobs', 'delete')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_jobs', 'truncate')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_jobs', 'references')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_jobs', 'trigger')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_events', 'insert')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_events', 'update')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_events', 'delete')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_events', 'truncate')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_events', 'references')
  and not has_table_privilege('service_role', 'public.gallery_facebook_page_publish_events', 'trigger'),
  'Facebook Page outbox tables grant service role only the direct reads used by Edge code'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'gallery_facebook_page_publish_jobs'
      and policyname = 'service_only_default_deny'
      and permissive = 'RESTRICTIVE'
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'gallery_facebook_page_publish_events'
      and policyname = 'service_only_default_deny'
      and permissive = 'RESTRICTIVE'
  ),
  'Facebook Page outbox tables have explicit restrictive client policies'
);
select ok(
  not has_function_privilege('anon', 'public.gallery_facebook_page_begin_publish(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_facebook_page_begin_publish(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_facebook_page_begin_publish(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_facebook_page_publish_source(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_facebook_page_publish_source(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_facebook_page_quarantine_stale_publish_jobs()', 'execute')
  and has_function_privilege('service_role', 'public.gallery_facebook_page_quarantine_stale_publish_jobs()', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_facebook_page_finish_publish(uuid,uuid,text,text,text,text,text,jsonb,boolean)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_facebook_page_finish_publish(uuid,uuid,text,text,text,text,text,jsonb,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_facebook_page_resolve_reconciliation(uuid,uuid,text,text,text,text,text,boolean)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_facebook_page_resolve_reconciliation(uuid,uuid,text,text,text,text,text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.gallery_commit_moderation_with_social_derivative(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz,text,text,bigint,integer,integer,text,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.gallery_commit_moderation_with_social_derivative(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz,text,text,bigint,integer,integer,text,text,text,text)', 'execute'),
  'Facebook Page state transition RPCs are service-role only'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.gallery_commit_moderation_without_facebook_page(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz)',
    'execute'
  ),
  'service role cannot bypass the Facebook Page atomic outbox wrapper'
);
select ok(
  (select column_default = 'false' from information_schema.columns where table_schema = 'public' and table_name = 'gallery_submissions' and column_name = 'facebook_page_opt_in')
  and has_column_privilege('authenticated', 'public.gallery_submissions', 'facebook_page_opt_in', 'insert')
  and has_column_privilege('authenticated', 'public.gallery_submissions', 'facebook_page_opt_in_contract_version', 'insert')
  and not has_column_privilege('authenticated', 'public.gallery_submissions', 'facebook_page_opt_in_at', 'insert')
  and not has_column_privilege('authenticated', 'public.gallery_submissions', 'facebook_page_opt_in_source', 'insert')
  and not has_column_privilege('authenticated', 'public.gallery_submissions', 'facebook_page_opt_in_copy_version', 'insert'),
  'Facebook Page consent defaults off and only its boolean plus untrusted handshake claim are browser-writable'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  ('51111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'facebook-gallery-owner@example.invalid', '', now(), now(), now()),
  ('59999999-9999-4999-8999-999999999999', 'authenticated', 'authenticated', 'facebook-gallery-moderator@example.invalid', '', now(), now(), now());

update public.member_profiles
set member_status = 'active',
    has_required_discord_roles = true,
    discord_verified_at = now(),
    display_name = 'Facebook Gallery Member'
where id = '51111111-1111-4111-8111-111111111111';

insert into storage.objects (id, bucket_id, name, owner, metadata) values
  ('51000000-0000-4000-8000-000000000001', 'member-gallery', '51111111-1111-4111-8111-111111111111/facebook-source.jpg', '51111111-1111-4111-8111-111111111111', '{"size":1000,"mimetype":"image/jpeg"}'),
  ('52000000-0000-4000-8000-000000000001', 'member-gallery', '_approved/publications/53000000-0000-4000-8000-000000000001/display.webp', null, '{"size":900000,"mimetype":"image/webp"}'),
  ('52000000-0000-4000-8000-000000000002', 'member-gallery', '_approved/publications/53000000-0000-4000-8000-000000000001/revisions/53100000-0000-4000-8000-000000000001/thumbnail.webp', null, '{"size":70000,"mimetype":"image/webp"}'),
  ('52000000-0000-4000-8000-000000000009', 'member-gallery', '_social/submissions/52222222-2222-4222-8222-222222222221/53333333-3333-4333-8333-333333333331.jpg', null, '{"size":150000,"mimetype":"image/jpeg"}');

insert into public.gallery_submissions (
  id,
  user_id,
  storage_path,
  mime_type,
  size_bytes,
  title,
  caption,
  category,
  facebook_page_opt_in,
  facebook_page_opt_in_contract_version
) values (
  '52222222-2222-4222-8222-222222222221',
  '51111111-1111-4111-8111-111111111111',
  '51111111-1111-4111-8111-111111111111/facebook-source.jpg',
  'image/jpeg',
  1000,
  'Facebook Page fixture',
  'Approved member image.',
  'scenery',
  true,
  '2026-07-website-public-facebook-page-group-v2'
);

select ok(
  (select facebook_page_opt_in_at is not null
      and facebook_page_opt_in_source = 'website_upload'
      and facebook_page_opt_in_copy_version = '2026-07-website-public-facebook-page-group-v2'
      and facebook_page_opt_in_contract_version = '2026-07-website-public-facebook-page-group-v2'
    from public.gallery_submissions
    where id = '52222222-2222-4222-8222-222222222221'),
  'database attests Facebook Page consent timestamp, source, copy, and exact client handshake'
);
select throws_ok(
  $$update public.gallery_submissions
    set facebook_page_opt_in_at = '2000-01-01 00:00:00+00'::timestamptz
    where id = '52222222-2222-4222-8222-222222222221'$$,
  '23514',
  'Facebook Page consent is immutable after submission.',
  'service-level updates cannot rewrite frozen Facebook Page consent provenance'
);

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, category,
  status, reviewed_by, reviewed_at, facebook_page_opt_in
) values (
  '52222222-2222-4222-8222-222222222220',
  '51111111-1111-4111-8111-111111111111',
  '51111111-1111-4111-8111-111111111111/cached-client.jpg',
  'image/jpeg', 1000, 'Cached client fixture', 'scenery',
  'approved', '59999999-9999-4999-8999-999999999999', now(), true
);

select ok(
  (select facebook_page_opt_in_copy_version =
      'gallery-facebook-page-opt-in-unverified-v1'
      and facebook_page_opt_in_contract_version is null
    from public.gallery_submissions
    where id = '52222222-2222-4222-8222-222222222220'),
  'cached website clients without the exact handshake remain explicitly unverified'
);

insert into public.gallery_facebook_page_publish_jobs (
  submission_id, source_mime_type, source_size_bytes, source_sha256, queued_by
) values (
  '52222222-2222-4222-8222-222222222220',
  'image/jpeg', 1000, repeat('9', 64),
  '59999999-9999-4999-8999-999999999999'
);

select ok(
  (select status = 'ineligible'
      and eligibility_reason like '%exact current website consent contract handshake%'
    from public.gallery_facebook_page_publish_jobs
    where submission_id = '52222222-2222-4222-8222-222222222220'),
  'unverified cached consent cannot create a queued Facebook Page job'
);

set local "request.jwt.claim.role" = 'service_role';

select is(
  private.normalize_gallery_facebook_permalink(
    'https://m.facebook.com/story.php?story_fbid=12345&id=67890&utm_source=test'
  ),
  'https://www.facebook.com/story.php?story_fbid=12345&id=67890',
  'Facebook permalink normalization pins HTTPS www and removes tracking'
);

select ok(
  private.normalize_gallery_facebook_permalink('javascript:alert(1)') is null
  and private.normalize_gallery_facebook_permalink(
    'https://evil.facebook.com/1222888660907862/posts/987654321'
  ) is null
  and private.normalize_gallery_facebook_permalink(
    'https://facebook.com.example.test/1222888660907862/posts/987654321'
  ) is null
  and private.normalize_gallery_facebook_permalink(
    'https://user:pass@www.facebook.com/1222888660907862/posts/987654321'
  ) is null
  and private.normalize_gallery_facebook_permalink(
    'https://www.facebook.com/1222888660907862/posts/987654321#fragment'
  ) is null
  and private.normalize_gallery_facebook_permalink(
    'https://www.facebook.com/'
  ) is null
  and private.normalize_gallery_facebook_permalink(
    'https://www.facebook.com/profile.php?id=61592841711452'
  ) is null
  and private.normalize_gallery_facebook_permalink(
    'https://www.facebook.com/?story_fbid=12345&id=67890'
  ) is null,
  'unsafe, off-domain, credentialed, fragmented, homepage, profile, and query-only URLs are rejected'
);

select is(
  (public.gallery_commit_source_validation(
    '52222222-2222-4222-8222-222222222221',
    (select updated_at from public.gallery_submissions where id = '52222222-2222-4222-8222-222222222221'),
    '51000000-0000-4000-8000-000000000001',
    (select version from storage.objects where id = '51000000-0000-4000-8000-000000000001'),
    (select updated_at from storage.objects where id = '51000000-0000-4000-8000-000000000001'),
    'image/jpeg', 1000, 1080, 1080, repeat('a', 64)
  ) ->> 'committed')::boolean,
  true,
  'validated JPEG source evidence commits'
);

select throws_ok(
  $$select public.gallery_commit_moderation_with_social_derivative(
    '52222222-2222-4222-8222-222222222221',
    '59999999-9999-4999-8999-999999999999',
    'approved', null,
    '53000000-0000-4000-8000-000000000001',
    '_approved/publications/53000000-0000-4000-8000-000000000001/display.webp',
    'image/webp', 900000, 1920, 1080, repeat('c', 64),
    '53100000-0000-4000-8000-000000000001',
    '_approved/publications/53000000-0000-4000-8000-000000000001/revisions/53100000-0000-4000-8000-000000000001/thumbnail.webp',
    'image/webp', 70000, 640, 360, repeat('d', 64), null,
    (select updated_at from public.gallery_submissions where id = '52222222-2222-4222-8222-222222222221'),
    '_social/submissions/52222222-2222-4222-8222-222222222221/v1.jpg',
    'image/jpeg', 150000, 1080, 1080, repeat('f', 64),
    'gallery-social-jpeg-v1', 'jfif-only-no-app-metadata-v1', repeat('a', 64)
  )$$,
  '23514',
  'Invalid source-bound social derivative evidence.',
  'deterministic v1 paths cannot be substituted for an immutable revision path'
);

select throws_ok(
  $$select public.gallery_commit_moderation_with_social_derivative(
    '52222222-2222-4222-8222-222222222221',
    '59999999-9999-4999-8999-999999999999',
    'approved', null,
    '53000000-0000-4000-8000-000000000001',
    '_approved/publications/53000000-0000-4000-8000-000000000001/display.webp',
    'image/webp', 900000, 1920, 1080, repeat('c', 64),
    '53100000-0000-4000-8000-000000000001',
    '_approved/publications/53000000-0000-4000-8000-000000000001/revisions/53100000-0000-4000-8000-000000000001/thumbnail.webp',
    'image/webp', 70000, 640, 360, repeat('d', 64), null,
    (select updated_at from public.gallery_submissions where id = '52222222-2222-4222-8222-222222222221'),
    '_social/submissions/52222222-2222-4222-8222-222222222221/53333333-3333-4333-8333-333333333331.jpg',
    'image/jpeg', 150000, 1080, 1080, repeat('f', 64),
    'gallery-social-jpeg-v1', 'jfif-only-no-app-metadata-v1', repeat('b', 64)
  )$$,
  '23514',
  'The social derivative is not bound to the validated consented source.',
  'a substituted derivative source hash is rejected before approval'
);

select is(
  (public.gallery_commit_moderation_with_social_derivative(
    '52222222-2222-4222-8222-222222222221',
    '59999999-9999-4999-8999-999999999999',
    'approved', null,
    '53000000-0000-4000-8000-000000000001',
    '_approved/publications/53000000-0000-4000-8000-000000000001/display.webp',
    'image/webp', 900000, 1920, 1080, repeat('c', 64),
    '53100000-0000-4000-8000-000000000001',
    '_approved/publications/53000000-0000-4000-8000-000000000001/revisions/53100000-0000-4000-8000-000000000001/thumbnail.webp',
    'image/webp', 70000, 640, 360, repeat('d', 64), null,
    (select updated_at from public.gallery_submissions where id = '52222222-2222-4222-8222-222222222221'),
    '_social/submissions/52222222-2222-4222-8222-222222222221/53333333-3333-4333-8333-333333333331.jpg',
    'image/jpeg', 150000, 1080, 1080, repeat('f', 64),
    'gallery-social-jpeg-v1', 'jfif-only-no-app-metadata-v1', repeat('a', 64)
  ) ->> 'committed')::boolean,
  true,
  'approval and Facebook Page outbox commit atomically'
);
select is(
  (select status from public.gallery_submissions where id = '52222222-2222-4222-8222-222222222221'),
  'approved',
  'approval updates the submission'
);
select is(
  (public.gallery_commit_moderation(
    '52222222-2222-4222-8222-222222222221',
    '59999999-9999-4999-8999-999999999999',
    'approved', null,
    '53000000-0000-4000-8000-000000000001', null, null, null, null, null, null,
    '53100000-0000-4000-8000-000000000001', null, null, null, null, null, null, null,
    (select updated_at from public.gallery_submissions where id = '52222222-2222-4222-8222-222222222221')
  ) ->> 'reason'),
  'submission_not_pending',
  'duplicate approval is rejected before another outbox insert'
);
select is(
  (select status from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  'queued',
  'eligible JPEG approval queues the Facebook Page job'
);
select is(
  (select count(*)::bigint from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  1::bigint,
  'exactly one Facebook Page job exists per approved opted-in submission'
);
select is(
  (select count(*)::bigint from public.gallery_facebook_page_publish_events where submission_id = '52222222-2222-4222-8222-222222222221' and action = 'queued'),
  1::bigint,
  'atomic queue creation records one queued event'
);
select is(
  (select source_sha256 from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  repeat('f', 64),
  'Facebook Page job freezes the sanitized derivative digest'
);
select is(
  (select count(*)::bigint from public.gallery_instagram_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  0::bigint,
  'Facebook Page consent remains independent from Instagram consent'
);
select is(
  (public.gallery_facebook_page_publish_source(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221')
  ) ->> 'reason'),
  'job_not_publishing',
  'source evidence is unavailable before the publish lock'
);
select is(
  (public.gallery_facebook_page_begin_publish(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
    '59999999-9999-4999-8999-999999999999',
    'Moderator-adjusted Page message.'
  ) ->> 'committed')::boolean,
  true,
  'queued job atomically enters publishing'
);
select ok(
  (select status = 'publishing' and attempt_count = 1 and message = 'Moderator-adjusted Page message.' from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  'publish lock freezes the first attempt and message'
);
select is(
  (select count(*)::bigint from public.gallery_facebook_page_publish_events where submission_id = '52222222-2222-4222-8222-222222222221' and action = 'publishing'),
  1::bigint,
  'first lock records a publishing event'
);
select is(
  (public.gallery_facebook_page_publish_source(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221')
  ) ->> 'ok')::boolean,
  true,
  'locked job resolves exact current source evidence'
);
select is(
  (public.gallery_facebook_page_publish_source(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221')
  ) ->> 'sha256'),
  repeat('f', 64),
  'source RPC returns the frozen digest'
);
select is(
  (public.gallery_facebook_page_publish_source(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221')
  ) ->> 'object_name'),
  '_social/submissions/52222222-2222-4222-8222-222222222221/53333333-3333-4333-8333-333333333331.jpg',
  'source RPC returns the exact private derivative object path'
);
select is(
  (public.gallery_facebook_page_quarantine_stale_publish_jobs() ->> 'quarantined_count')::integer,
  0,
  'an active publish lease is not quarantined'
);
select is(
  (public.gallery_facebook_page_finish_publish(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
    '59999999-9999-4999-8999-999999999999',
    'failed', null, null, null, 'Meta rejected the image.', '{"status_code":400}'::jsonb
  ) ->> 'committed')::boolean,
  true,
  'known provider rejection atomically records failure'
);
select ok(
  (select status = 'failed' and last_error = 'Meta rejected the image.' and published_at is null from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  'failed outcome is retryable but not published'
);
select is(
  (select count(*)::bigint from public.gallery_facebook_page_publish_events where submission_id = '52222222-2222-4222-8222-222222222221' and action = 'failed'),
  1::bigint,
  'known failure records one audit event'
);
select is(
  (public.gallery_facebook_page_begin_publish(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
    '59999999-9999-4999-8999-999999999999', null
  ) ->> 'committed')::boolean,
  true,
  'failed job may begin one explicit retry'
);
select is(
  (select attempt_count from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  2,
  'retry increments the attempt count once'
);
select is(
  (select count(*)::bigint from public.gallery_facebook_page_publish_events where submission_id = '52222222-2222-4222-8222-222222222221' and action = 'retry'),
  1::bigint,
  'retry records its own audit event'
);
select lives_ok(
  $$update public.gallery_facebook_page_publish_jobs
    set attempt_started_at = clock_timestamp() - interval '16 minutes'
    where submission_id = '52222222-2222-4222-8222-222222222221'$$,
  'test fixture simulates an abandoned publish attempt'
);
select is(
  (public.gallery_facebook_page_quarantine_stale_publish_jobs() ->> 'quarantined_count')::integer,
  1,
  'an expired publish lease is quarantined for reconciliation'
);
select is(
  (select status from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  'reconcile_required',
  'ambiguous provider outcome is not retryable'
);
select ok(
  (select count(*) = 1
      and bool_and(details ->> 'reason' = 'stale_publish_lease')
      and bool_and(actor_id is null)
    from public.gallery_facebook_page_publish_events
    where submission_id = '52222222-2222-4222-8222-222222222221'
      and action = 'reconcile_required'),
  'stale-lease reconciliation requirement is durably audited'
);
select is(
  (public.gallery_facebook_page_begin_publish(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
    '59999999-9999-4999-8999-999999999999', null
  ) ->> 'reason'),
  'job_not_publishable',
  'reconcile-required job cannot be sent again'
);
select is(
  (select count(*)::bigint from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  1::bigint,
  'state transitions never duplicate the outbox job'
);
select throws_ok(
  $$select public.gallery_facebook_page_resolve_reconciliation(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
    '59999999-9999-4999-8999-999999999999',
    'confirmed_not_published', 'contradictory-photo-id', null, null,
    'No matching Page post exists.', false
  )$$,
  '22023',
  'Publication identifiers are not allowed when no Facebook Page post exists.',
  'not-published reconciliation rejects contradictory provider evidence'
);
select is(
  (public.gallery_facebook_page_resolve_reconciliation(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
    '59999999-9999-4999-8999-999999999999',
    'confirmed_not_published', null, null, null,
    'Inspected the Page activity and photo feed; no matching post exists.'
  ) ->> 'committed')::boolean,
  true,
  'moderator can explicitly resolve an inspected missing post'
);
select is(
  (select status from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
  'failed',
  'confirmed missing post returns the job to a retryable failed state'
);
select is(
  (public.gallery_facebook_page_begin_publish(
    (select id from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222221'),
    '59999999-9999-4999-8999-999999999999', null
  ) ->> 'committed')::boolean,
  true,
  'resolved missing post can be retried only through a new explicit publish lock'
);
select is(
  (select count(*)::bigint
    from public.gallery_facebook_page_publish_events
    where submission_id = '52222222-2222-4222-8222-222222222221'
      and action = 'reconciliation_resolved_not_published'
      and actor_id = '59999999-9999-4999-8999-999999999999'),
  1::bigint,
  'moderator resolution is durably attributed'
);

insert into storage.objects (id, bucket_id, name, owner, metadata) values
  (
    '51000000-0000-4000-8000-000000000002',
    'member-gallery',
    '51111111-1111-4111-8111-111111111111/facebook-reconcile-source.jpg',
    '51111111-1111-4111-8111-111111111111',
    '{"size":1000,"mimetype":"image/jpeg"}'
  ),
  (
    '52000000-0000-4000-8000-000000000010',
    'member-gallery',
    '_social/submissions/52222222-2222-4222-8222-222222222222/53333333-3333-4333-8333-333333333332.jpg',
    null,
    '{"size":150000,"mimetype":"image/jpeg"}'
  );

insert into public.gallery_submissions (
  id,
  user_id,
  storage_path,
  mime_type,
  size_bytes,
  title,
  category,
  status,
  reviewed_by,
  reviewed_at,
  facebook_page_opt_in,
  facebook_page_opt_in_contract_version
) values (
  '52222222-2222-4222-8222-222222222222',
  '51111111-1111-4111-8111-111111111111',
  '51111111-1111-4111-8111-111111111111/facebook-reconcile-source.jpg',
  'image/jpeg',
  1000,
  'Facebook Page reconciliation fixture',
  'scenery',
  'approved',
  '59999999-9999-4999-8999-999999999999',
  clock_timestamp(),
  true,
  '2026-07-website-public-facebook-page-group-v2'
);

insert into private.gallery_social_derivatives (
  submission_id, storage_object_id, storage_bucket, storage_path,
  storage_object_version, storage_object_updated_at, mime_type, size_bytes,
  width, height, sha256, sanitizer_version, metadata_policy, created_by,
  source_storage_object_id, source_storage_object_version,
  source_storage_object_updated_at, source_sha256, derivation_method
) select
  '52222222-2222-4222-8222-222222222222',
  object.id,
  object.bucket_id,
  object.name,
  object.version,
  object.updated_at,
  'image/jpeg', 150000, 1080, 1080, repeat('1', 64),
  'gallery-social-jpeg-v1', 'jfif-only-no-app-metadata-v1',
  '59999999-9999-4999-8999-999999999999',
  source.id, source.version, source.updated_at, repeat('2', 64),
  'jpeg-metadata-strip-v1'
from storage.objects as object
cross join storage.objects as source
where object.id = '52000000-0000-4000-8000-000000000010'
  and source.id = '51000000-0000-4000-8000-000000000002';

insert into public.gallery_facebook_page_publish_jobs (
  id,
  submission_id,
  status,
  source_mime_type,
  source_size_bytes,
  source_sha256,
  attempt_count,
  attempt_started_at,
  queued_by
) values (
  '54444444-4444-4444-8444-444444444444',
  '52222222-2222-4222-8222-222222222222',
  'publishing',
  'image/jpeg',
  1000,
  repeat('e', 64),
  1,
  clock_timestamp(),
  '59999999-9999-4999-8999-999999999999'
);

do $begin_reconciliation_fixture$
begin
  perform public.gallery_facebook_page_begin_publish(
    '54444444-4444-4444-8444-444444444444',
    '59999999-9999-4999-8999-999999999999',
    null
  );
end
$begin_reconciliation_fixture$;

select is(
  (public.gallery_facebook_page_finish_publish(
    '54444444-4444-4444-8444-444444444444',
    '59999999-9999-4999-8999-999999999999',
    'reconcile_required',
    'facebook-photo-lookup-id',
    'facebook-post-lookup-id',
    null,
    'The provider returned ids but the success audit was uncertain.',
    '{"failure_stage":"success_audit"}'::jsonb
  ) ->> 'committed')::boolean,
  true,
  'uncertain success with provider ids commits reconciliation evidence'
);
select ok(
  (select status = 'reconcile_required'
      and facebook_photo_id = 'facebook-photo-lookup-id'
      and facebook_post_id = 'facebook-post-lookup-id'
      and published_by is null
      and published_at is null
    from public.gallery_facebook_page_publish_jobs
    where id = '54444444-4444-4444-8444-444444444444'),
  'reconciliation job retains provider lookup ids without claiming publication'
);
select ok(
  (select details ->> 'facebook_photo_id' = 'facebook-photo-lookup-id'
      and details ->> 'facebook_post_id' = 'facebook-post-lookup-id'
    from public.gallery_facebook_page_publish_events
    where job_id = '54444444-4444-4444-8444-444444444444'
      and action = 'reconcile_required'),
  'reconciliation audit event retains provider lookup ids'
);
select is(
  (public.gallery_facebook_page_resolve_reconciliation(
    '54444444-4444-4444-8444-444444444444',
    '59999999-9999-4999-8999-999999999999',
    'confirmed_published',
    'facebook-photo-lookup-id',
    'facebook-post-lookup-id',
    'https://www.facebook.com/1222888660907862/posts/facebook-post-lookup-id',
    'Inspected the Page post but did not provide a server ownership proof.',
    false
  ) ->> 'reason'),
  'canonical_page_evidence_required',
  'published reconciliation fails closed without server-verified Page ownership'
);
select is(
  (public.gallery_facebook_page_resolve_reconciliation(
    '54444444-4444-4444-8444-444444444444',
    '59999999-9999-4999-8999-999999999999',
    'confirmed_published',
    'facebook-photo-lookup-id',
    'facebook-post-lookup-id',
    'https://www.facebook.com/1222888660907862/posts/facebook-post-lookup-id',
    'Inspected the Page post and verified both ids against the pinned Page.',
    true
  ) ->> 'committed')::boolean,
  true,
  'moderator can confirm a reconciled post from retained provider ids'
);
select ok(
  (select status = 'published'
      and facebook_photo_id = 'facebook-photo-lookup-id'
      and facebook_post_id = 'facebook-post-lookup-id'
      and published_by = '59999999-9999-4999-8999-999999999999'
      and published_at is not null
    from public.gallery_facebook_page_publish_jobs
    where id = '54444444-4444-4444-8444-444444444444'),
  'confirmed reconciled post becomes published without losing provider ids'
);
select is(
  (select count(*)::bigint
    from public.gallery_facebook_page_publish_events
    where job_id = '54444444-4444-4444-8444-444444444444'
      and action = 'reconciliation_resolved_published'
      and actor_id = '59999999-9999-4999-8999-999999999999'),
  1::bigint,
  'confirmed publication resolution is durably attributed'
);

insert into storage.objects (id, bucket_id, name, owner, metadata) values
  ('51000000-0000-4000-8000-000000000003', 'member-gallery', '51111111-1111-4111-8111-111111111111/instagram-only.jpg', '51111111-1111-4111-8111-111111111111', '{"size":1000,"mimetype":"image/jpeg"}'),
  ('52000000-0000-4000-8000-000000000003', 'member-gallery', '_approved/publications/53000000-0000-4000-8000-000000000003/display.webp', null, '{"size":900000,"mimetype":"image/webp"}'),
  ('52000000-0000-4000-8000-000000000004', 'member-gallery', '_approved/publications/53000000-0000-4000-8000-000000000003/revisions/53100000-0000-4000-8000-000000000003/thumbnail.webp', null, '{"size":70000,"mimetype":"image/webp"}'),
  ('51000000-0000-4000-8000-000000000004', 'member-gallery', '51111111-1111-4111-8111-111111111111/both-destinations.jpg', '51111111-1111-4111-8111-111111111111', '{"size":1000,"mimetype":"image/jpeg"}'),
  ('52000000-0000-4000-8000-000000000005', 'member-gallery', '_approved/publications/53000000-0000-4000-8000-000000000004/display.webp', null, '{"size":900000,"mimetype":"image/webp"}'),
  ('52000000-0000-4000-8000-000000000006', 'member-gallery', '_approved/publications/53000000-0000-4000-8000-000000000004/revisions/53100000-0000-4000-8000-000000000004/thumbnail.webp', null, '{"size":70000,"mimetype":"image/webp"}'),
  ('51000000-0000-4000-8000-000000000005', 'member-gallery', '51111111-1111-4111-8111-111111111111/no-destinations.jpg', '51111111-1111-4111-8111-111111111111', '{"size":1000,"mimetype":"image/jpeg"}'),
  ('52000000-0000-4000-8000-000000000007', 'member-gallery', '_approved/publications/53000000-0000-4000-8000-000000000005/display.webp', null, '{"size":900000,"mimetype":"image/webp"}'),
  ('52000000-0000-4000-8000-000000000008', 'member-gallery', '_approved/publications/53000000-0000-4000-8000-000000000005/revisions/53100000-0000-4000-8000-000000000005/thumbnail.webp', null, '{"size":70000,"mimetype":"image/webp"}'),
  ('52000000-0000-4000-8000-000000000011', 'member-gallery', '_social/submissions/52222222-2222-4222-8222-222222222223/53333333-3333-4333-8333-333333333333.jpg', null, '{"size":150000,"mimetype":"image/jpeg"}'),
  ('52000000-0000-4000-8000-000000000012', 'member-gallery', '_social/submissions/52222222-2222-4222-8222-222222222224/53333333-3333-4333-8333-333333333334.jpg', null, '{"size":150000,"mimetype":"image/jpeg"}');

insert into public.gallery_submissions (
  id, user_id, storage_path, mime_type, size_bytes, title, category,
  instagram_opt_in, instagram_opt_in_at, instagram_opt_in_source,
  instagram_opt_in_copy_version, instagram_opt_in_contract_version,
  facebook_page_opt_in, facebook_page_opt_in_contract_version
) values
  (
    '52222222-2222-4222-8222-222222222223',
    '51111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-111111111111/instagram-only.jpg',
    'image/jpeg', 1000, 'Instagram only fixture', 'scenery',
    true, now(), 'website_upload', 'gallery-instagram-opt-in-v1',
    '2026-07-website-public-instagram-publish-v2', false, null
  ),
  (
    '52222222-2222-4222-8222-222222222224',
    '51111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-111111111111/both-destinations.jpg',
    'image/jpeg', 1000, 'Both destinations fixture', 'scenery',
    true, now(), 'website_upload', 'gallery-instagram-opt-in-v1',
    '2026-07-website-public-instagram-publish-v2', true,
    '2026-07-website-public-facebook-page-group-v2'
  ),
  (
    '52222222-2222-4222-8222-222222222225',
    '51111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-111111111111/no-destinations.jpg',
    'image/jpeg', 1000, 'No destinations fixture', 'scenery',
    false, null, null, null, null, false, null
  );

do $consent_matrix$
declare
  fixture record;
  validation_result jsonb;
  moderation_result jsonb;
begin
  for fixture in
    select *
    from (values
      (
        '52222222-2222-4222-8222-222222222223'::uuid,
        '51000000-0000-4000-8000-000000000003'::uuid,
        '53000000-0000-4000-8000-000000000003'::uuid,
        '53100000-0000-4000-8000-000000000003'::uuid,
        '3'
      ),
      (
        '52222222-2222-4222-8222-222222222224'::uuid,
        '51000000-0000-4000-8000-000000000004'::uuid,
        '53000000-0000-4000-8000-000000000004'::uuid,
        '53100000-0000-4000-8000-000000000004'::uuid,
        '4'
      ),
      (
        '52222222-2222-4222-8222-222222222225'::uuid,
        '51000000-0000-4000-8000-000000000005'::uuid,
        '53000000-0000-4000-8000-000000000005'::uuid,
        '53100000-0000-4000-8000-000000000005'::uuid,
        '5'
      )
    ) as valueset(submission_id, source_object_id, publication_id, revision_id, suffix)
  loop
    validation_result := public.gallery_commit_source_validation(
      fixture.submission_id,
      (select updated_at from public.gallery_submissions where id = fixture.submission_id),
      fixture.source_object_id,
      (select version from storage.objects where id = fixture.source_object_id),
      (select updated_at from storage.objects where id = fixture.source_object_id),
      'image/jpeg', 1000, 1080, 1080, repeat(fixture.suffix, 64)
    );
    if coalesce((validation_result ->> 'committed')::boolean, false) is not true then
      raise exception 'Consent matrix source validation failed for %', fixture.submission_id;
    end if;

    moderation_result := public.gallery_commit_moderation_with_social_derivative(
      fixture.submission_id,
      '59999999-9999-4999-8999-999999999999',
      'approved', null,
      fixture.publication_id,
      format('_approved/publications/%s/display.webp', fixture.publication_id),
      'image/webp', 900000, 1920, 1080, repeat('c', 64),
      fixture.revision_id,
      format(
        '_approved/publications/%s/revisions/%s/thumbnail.webp',
        fixture.publication_id,
        fixture.revision_id
      ),
      'image/webp', 70000, 640, 360, repeat('d', 64), null,
      (select updated_at from public.gallery_submissions where id = fixture.submission_id),
      case when fixture.suffix = '4'
        then format(
          '_social/submissions/%s/53333333-3333-4333-8333-33333333333%s.jpg',
          fixture.submission_id,
          fixture.suffix
        )
        else null
      end,
      case when fixture.suffix = '4' then 'image/jpeg' else null end,
      case when fixture.suffix = '4' then 150000 else null end,
      case when fixture.suffix = '4' then 1080 else null end,
      case when fixture.suffix = '4' then 1080 else null end,
      case when fixture.suffix = '4' then repeat(fixture.suffix, 64) else null end,
      case when fixture.suffix = '4' then 'gallery-social-jpeg-v1' else null end,
      case when fixture.suffix = '4' then 'jfif-only-no-app-metadata-v1' else null end,
      case when fixture.suffix = '4' then repeat(fixture.suffix, 64) else null end
    );
    if coalesce((moderation_result ->> 'committed')::boolean, false) is not true then
      raise exception 'Consent matrix moderation failed for %', fixture.submission_id;
    end if;
  end loop;
end
$consent_matrix$;

select ok(
  (select count(*) = 1 from public.gallery_instagram_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222223')
  and (select status = 'ineligible' from public.gallery_instagram_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222223')
  and (select count(*) = 0 from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222223')
  and (select count(*) = 1 from public.gallery_instagram_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222224')
  and (select count(*) = 1 from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222224')
  and (select count(*) = 0 from public.gallery_instagram_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222225')
  and (select count(*) = 0 from public.gallery_facebook_page_publish_jobs where submission_id = '52222222-2222-4222-8222-222222222225'),
  'all four destination-consent combinations create only their authorized outboxes, and missing derivatives remain ineligible'
);

select * from finish();
rollback;
