BEGIN;
SELECT plan(17);

SELECT ok(
  has_schema_privilege('authenticated', 'private', 'usage')
  AND has_schema_privilege('service_role', 'private', 'usage'),
  'nonce migration preserves established private schema usage'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'private.member_has_gallery_upload_access(uuid)',
    'execute'
  )
  AND has_function_privilege(
    'authenticated',
    'private.member_gallery_original_mutation_allowed(uuid,text,text,boolean)',
    'execute'
  ),
  'nonce migration preserves existing authenticated Gallery helper execution'
);

SELECT has_table(
  'private',
  'discord_gallery_ingest_nonces',
  'private Discord gallery ingest nonce table exists'
);
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_class
   WHERE oid = 'private.discord_gallery_ingest_nonces'::regclass),
  'nonce table enables and forces RLS'
);
SELECT ok(
  (
    SELECT count(*) = 1
      AND bool_and(permissive = 'RESTRICTIVE')
      AND bool_and(cmd = 'ALL')
    FROM pg_policies
    WHERE schemaname = 'private'
      AND tablename = 'discord_gallery_ingest_nonces'
      AND policyname = 'discord_gallery_ingest_nonces_default_deny'
  ),
  'nonce table has one explicit restrictive default-deny policy'
);
SELECT ok(
  NOT has_table_privilege('anon', 'private.discord_gallery_ingest_nonces', 'select')
  AND NOT has_table_privilege('authenticated', 'private.discord_gallery_ingest_nonces', 'select')
  AND NOT has_table_privilege('service_role', 'private.discord_gallery_ingest_nonces', 'select'),
  'browser and service roles have no direct nonce table access'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.consume_discord_gallery_ingest_nonce(text,text,timestamp with time zone)',
    'execute'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.consume_discord_gallery_ingest_nonce(text,text,timestamp with time zone)',
    'execute'
  )
  AND has_function_privilege(
    'service_role',
    'public.consume_discord_gallery_ingest_nonce(text,text,timestamp with time zone)',
    'execute'
  ),
  'only service role can call the nonce consumer'
);

GRANT EXECUTE ON FUNCTION public.consume_discord_gallery_ingest_nonce(
  text,
  text,
  timestamptz
) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', '', true);
SELECT throws_ok(
  $$SELECT public.consume_discord_gallery_ingest_nonce(
    'primary',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    statement_timestamp() + interval '65 seconds'
  )$$,
  '42501',
  'gallery_ingest_service_role_required',
  'nonce consumer internal guard rejects an absent role claim'
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_ok(
  $$SELECT public.consume_discord_gallery_ingest_nonce(
    'primary',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    statement_timestamp() + interval '65 seconds'
  )$$,
  '42501',
  'gallery_ingest_service_role_required',
  'nonce consumer internal guard rejects a non-service role claim'
);
RESET ROLE;

REVOKE ALL ON FUNCTION public.consume_discord_gallery_ingest_nonce(
  text,
  text,
  timestamptz
) FROM authenticated;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT ok(
  public.consume_discord_gallery_ingest_nonce(
    'primary',
    '0123456789abcdef0123456789abcdef',
    statement_timestamp() + interval '65 seconds'
  ),
  'first nonce consumption succeeds'
);
SELECT ok(
  NOT public.consume_discord_gallery_ingest_nonce(
    'primary',
    '0123456789abcdef0123456789abcdef',
    statement_timestamp() + interval '65 seconds'
  ),
  'same key and nonce cannot be replayed'
);
SELECT ok(
  public.consume_discord_gallery_ingest_nonce(
    'next',
    '0123456789abcdef0123456789abcdef',
    statement_timestamp() + interval '65 seconds'
  ),
  'a rotating key has an independent nonce namespace'
);
SELECT ok(
  NOT public.consume_discord_gallery_ingest_nonce(
    'Primary',
    '0123456789abcdef0123456789abcdef',
    statement_timestamp() + interval '65 seconds'
  ),
  'invalid key identifiers fail closed'
);
SELECT ok(
  NOT public.consume_discord_gallery_ingest_nonce(
    'primary',
    'short',
    statement_timestamp() + interval '65 seconds'
  ),
  'invalid nonces fail closed'
);
SELECT ok(
  NOT public.consume_discord_gallery_ingest_nonce(
    'primary',
    '11111111111111111111111111111111',
    statement_timestamp() - interval '10 seconds'
  ),
  'expired nonce leases fail closed'
);
SELECT ok(
  NOT public.consume_discord_gallery_ingest_nonce(
    'primary',
    '22222222222222222222222222222222',
    statement_timestamp() + interval '4 minutes'
  ),
  'overlong nonce leases fail closed'
);
SELECT ok(
  NOT public.consume_discord_gallery_ingest_nonce(
    'primary',
    '33333333333333333333333333333333',
    null::timestamptz
  ),
  'null nonce leases fail closed deterministically'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
