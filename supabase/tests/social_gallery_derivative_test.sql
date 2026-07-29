begin;

select plan(12);

select has_table(
  'private',
  'gallery_social_derivatives',
  'immutable social derivative evidence exists in the private schema'
);

select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'private.gallery_social_derivatives'::regclass)
  and not has_table_privilege(
    'anon', 'private.gallery_social_derivatives', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'private.gallery_social_derivatives', 'select'
  )
  and not has_table_privilege(
    'service_role', 'private.gallery_social_derivatives', 'select'
  ),
  'social evidence has no browser or direct service-role table access'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Block browser access to social derivatives'
      and permissive = 'RESTRICTIVE'
      and roles @> array['anon', 'authenticated']::name[]
  ),
  'the reserved social object prefix is explicitly browser-denied'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.gallery_commit_moderation_with_social_derivative(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz,text,text,bigint,integer,integer,text,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.gallery_commit_moderation_with_social_derivative(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz,text,text,bigint,integer,integer,text,text,text,text)',
    'execute'
  ),
  'only the service role can atomically attest a moderation derivative'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'private.gallery_social_derivatives'::regclass
      and conname = 'gallery_social_derivatives_path_check'
      and convalidated
      and pg_get_constraintdef(oid) like '%[0-9a-f]{8}%'
      and pg_get_constraintdef(oid) not like '%v1.jpg%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'private.gallery_social_derivatives'::regclass
      and conname = 'gallery_social_derivatives_dimensions_check'
      and convalidated
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'private.gallery_social_derivatives'::regclass
      and conname = 'gallery_social_derivatives_metadata_policy_check'
      and convalidated
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'private.gallery_social_derivatives'::regclass
      and conname = 'gallery_social_derivatives_derivation_method_check'
      and convalidated
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'gallery_social_derivatives'
      and column_name = 'source_storage_object_id'
      and is_nullable = 'NO'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'gallery_social_derivatives'
      and column_name = 'source_sha256'
      and is_nullable = 'NO'
  )
  and pg_get_functiondef(
    'public.gallery_commit_moderation_with_social_derivative(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz,text,text,bigint,integer,integer,text,text,text,text)'::regprocedure
  ) like '%source_sha256 = p_social_source_sha256%'
  and pg_get_functiondef(
    'public.gallery_commit_moderation_with_social_derivative(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz,text,text,bigint,integer,integer,text,text,text,text)'::regprocedure
  ) like '%source_validation.storage_object_id%'
  and pg_get_functiondef(
    'public.gallery_commit_moderation_with_social_derivative(uuid,uuid,text,text,uuid,text,text,bigint,integer,integer,text,uuid,text,text,bigint,integer,integer,text,uuid,timestamptz,text,text,bigint,integer,integer,text,text,text,text)'::regprocedure
  ) like '%facebook_page_opt_in_contract_version%'
  ,
  'derivative path, feed dimensions, metadata policy, and exact consented-source binding are constrained'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gallery_facebook_page_publish_jobs'
      and column_name = 'social_storage_object_id'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gallery_instagram_publish_jobs'
      and column_name = 'social_storage_object_id'
  ),
  'both destination jobs freeze the derivative object identity'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.gallery_facebook_page_publish_jobs'::regclass
      and conname = 'gallery_facebook_page_publish_jobs_destination_check'
      and pg_get_constraintdef(oid) like '%1222888660907862%'
  ),
  'every Facebook job is constrained to the official Page id'
);

select matches(
  pg_get_functiondef('private.attest_gallery_facebook_page_consent()'::regprocedure),
  'claimed_contract_version',
  'new Facebook consent requires the exact client/server contract handshake'
);

select ok(
  pg_get_functiondef(
    'public.gallery_facebook_page_begin_publish(uuid,uuid,text)'::regprocedure
  ) like '%2026-07-website-public-facebook-page-group-v2%'
  and pg_get_functiondef(
    'public.gallery_facebook_page_begin_publish(uuid,uuid,text)'::regprocedure
  ) like '%facebook_page_opt_in_contract_version%'
  and pg_get_functiondef(
    'public.gallery_facebook_page_begin_publish(uuid,uuid,text)'::regprocedure
  ) like '%1222888660907862%',
  'Facebook claim rechecks current consent and the pinned destination'
);

select matches(
  pg_get_functiondef(
    'public.gallery_instagram_begin_publish(uuid,uuid,text,text)'::regprocedure
  ),
  '2026-07-website-public-instagram-publish-v2',
  'Instagram claim rechecks current explicit public-account consent'
);

select ok(
  pg_get_functiondef(
    'public.gallery_facebook_page_publish_source(uuid)'::regprocedure
  ) like '%private.gallery_social_derivatives%'
  and pg_get_functiondef(
    'public.gallery_facebook_page_publish_source(uuid)'::regprocedure
  ) like '%[0-9a-f]{8}%'
  and pg_get_functiondef(
    'public.gallery_instagram_publish_source(uuid)'::regprocedure
  ) like '%private.gallery_social_derivatives%'
  and pg_get_functiondef(
    'public.gallery_facebook_page_publish_source(uuid)'::regprocedure
  ) not like '%private.gallery_source_validations%'
  and pg_get_functiondef(
    'public.gallery_instagram_publish_source(uuid)'::regprocedure
  ) not like '%private.gallery_source_validations%',
  'both publishers resolve only the frozen sanitized derivative'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'private.gallery_social_derivatives'::regclass
      and tgname = 'reject_gallery_social_derivative_update'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgrelid = 'public.gallery_facebook_page_publish_jobs'::regclass
      and tgname = 'guard_gallery_facebook_page_job_binding'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgrelid = 'public.gallery_instagram_publish_jobs'::regclass
      and tgname = 'guard_gallery_instagram_job_binding'
      and not tgisinternal
  ),
  'derivative evidence and destination-job bindings are immutable'
);

select * from finish();
rollback;
