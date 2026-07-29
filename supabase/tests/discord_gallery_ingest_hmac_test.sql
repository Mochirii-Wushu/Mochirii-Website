BEGIN;
SELECT plan(12);

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

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
