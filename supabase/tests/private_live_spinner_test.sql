BEGIN;
SELECT plan(59);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) VALUES (
  '99999999-9999-4999-8999-999999999999',
  'authenticated',
  'authenticated',
  'spinner-backend-test@example.invalid',
  '',
  now(),
  now(),
  now()
);

SELECT ok(to_regclass('public.spinner_live_state') IS NOT NULL, 'live state table exists');
SELECT ok(to_regclass('public.spinner_commands') IS NOT NULL, 'command table exists');
SELECT ok(to_regclass('public.spinner_draw_receipts') IS NOT NULL, 'receipt table exists');
SELECT ok(to_regclass('public.spinner_discord_outbox') IS NOT NULL, 'Discord outbox table exists');
SELECT ok(to_regclass('public.spinner_moderator_authorizations') IS NOT NULL, 'moderator authorization cache exists');

SELECT ok(
  (SELECT NOT attnotnull FROM pg_attribute
    WHERE attrelid = 'public.spinner_commands'::regclass AND attname = 'actor_id')
  AND (SELECT NOT attnotnull FROM pg_attribute
    WHERE attrelid = 'public.spinner_draw_receipts'::regclass AND attname = 'actor_id')
  AND (SELECT bool_and(confdeltype = 'n') FROM pg_constraint
    WHERE conrelid IN ('public.spinner_commands'::regclass, 'public.spinner_draw_receipts'::regclass)
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%actor_id%'),
  'moderator account deletion nulls historical actor references without deleting receipts'
);

SELECT has_index(
  'public',
  'spinner_commands',
  'spinner_commands_actor_id_idx',
  ARRAY['actor_id'],
  'command actor foreign-key lookups are indexed'
);

SELECT has_index(
  'public',
  'spinner_draw_receipts',
  'spinner_draw_receipts_actor_id_idx',
  ARRAY['actor_id'],
  'receipt actor foreign-key lookups are indexed'
);

SELECT has_index(
  'public',
  'spinner_live_state',
  'spinner_live_state_updated_by_idx',
  ARRAY['updated_by'],
  'live-state moderator foreign-key lookups are indexed'
);

SELECT ok(
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
    'public.spinner_live_state'::regclass,
    'public.spinner_commands'::regclass,
    'public.spinner_draw_receipts'::regclass,
    'public.spinner_discord_outbox'::regclass,
    'public.spinner_moderator_authorizations'::regclass
  )),
  'RLS is enabled on every authoritative spinner table'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.spinner_live_state', 'select')
  AND NOT has_table_privilege('anon', 'public.spinner_commands', 'select')
  AND NOT has_table_privilege('anon', 'public.spinner_draw_receipts', 'select')
  AND NOT has_table_privilege('anon', 'public.spinner_discord_outbox', 'select')
  AND NOT has_table_privilege('anon', 'public.spinner_moderator_authorizations', 'select'),
  'anonymous clients have no direct spinner table access'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.spinner_live_state', 'select')
  AND NOT has_table_privilege('authenticated', 'public.spinner_commands', 'select')
  AND NOT has_table_privilege('authenticated', 'public.spinner_draw_receipts', 'select')
  AND NOT has_table_privilege('authenticated', 'public.spinner_discord_outbox', 'select')
  AND NOT has_table_privilege('authenticated', 'public.spinner_moderator_authorizations', 'select'),
  'authenticated clients have no direct spinner table access'
);

SELECT ok(
  has_table_privilege('service_role', 'public.spinner_live_state', 'select')
  AND has_table_privilege('service_role', 'public.spinner_commands', 'select')
  AND has_table_privilege('service_role', 'public.spinner_draw_receipts', 'select')
  AND has_table_privilege('service_role', 'public.spinner_discord_outbox', 'select')
  AND has_table_privilege('service_role', 'public.spinner_moderator_authorizations', 'select'),
  'service role owns the authoritative spinner path'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.spinner_reserve_command(uuid,text,uuid,bigint,text)', 'execute'),
  'browser roles cannot reserve moderator commands'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.spinner_apply_command(uuid)', 'execute'),
  'browser roles cannot apply moderator commands'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.spinner_finalize_reveal()', 'execute'),
  'browser roles cannot finalize the live state directly'
);
SELECT ok(
  has_function_privilege('service_role', 'public.spinner_reserve_command(uuid,text,uuid,bigint,text)', 'execute')
  AND has_function_privilege('service_role', 'public.spinner_stage_command(uuid,jsonb)', 'execute')
  AND has_function_privilege('service_role', 'public.spinner_reject_unstaged_spin(uuid)', 'execute')
  AND has_function_privilege('service_role', 'public.spinner_apply_command(uuid)', 'execute')
  AND has_function_privilege('service_role', 'public.spinner_recover_commands()', 'execute')
  AND has_function_privilege('service_role', 'public.spinner_finalize_reveal()', 'execute')
  AND has_function_privilege('service_role', 'public.spinner_cleanup_expired(timestamp with time zone)', 'execute')
  AND has_function_privilege('service_role', 'public.spinner_claim_discord_outbox(uuid,integer)', 'execute')
  AND has_function_privilege('service_role', 'public.spinner_finish_discord_outbox_claim(uuid,uuid,text,text,text,timestamp with time zone)', 'execute'),
  'service role can run the transactional command functions'
);

SELECT is((SELECT count(*)::integer FROM public.spinner_live_state), 1, 'exactly one live state row is seeded');

SELECT ok(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'spinner_discord_outbox_channel_allowlist_check')
    LIKE '%1468667003366674721%',
  'the semantic raffle outbox is pinned to the approved channel'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.spinner_draw_receipts'::regclass
      AND tgname = 'spinner_draw_receipts_immutable'
      AND tgenabled <> 'D'
  ),
  'receipt immutability trigger is enabled'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
    WHERE conname IN (
      'spinner_commands_retention_check',
      'spinner_draw_receipts_retention_check',
      'spinner_discord_outbox_retention_check'
    )),
  3,
  'command, receipt, and outbox records retain a 30-day floor'
);

SELECT ok(
  (SELECT pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conname = 'spinner_moderator_authorizations_window_check')
    LIKE '%00:05:00%',
  'cached moderator authority cannot outlive the five-minute revocation window'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'spinner_discord_outbox'
      AND indexname = 'spinner_discord_outbox_draw_channel_key'
  ),
  'one outbox row is keyed by draw and semantic channel'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND cmd = 'INSERT'
      AND policyname LIKE 'spinner%'
  ),
  'spinner viewers have no Realtime send policy'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.spinner_commands'::regclass
      AND attname = 'lease_expires_at'
      AND NOT attisdropped
  )
  AND EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'spinner_commands'
      AND indexname = 'spinner_commands_pending_lease_idx'
  ),
  'pending commands have an indexed recovery lease'
);

SELECT is(
  (SELECT count(*)::integer FROM cron.job
    WHERE jobname IN ('spinner-maintenance-every-5-seconds', 'spinner-cleanup-daily')),
  2,
  'automatic maintenance, delivery retries, and retention cleanup are scheduled'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.spinner_discord_outbox'::regclass
      AND tgname = 'spinner_discord_outbox_queue_dispatch'
      AND tgenabled <> 'D'
  ),
  'new draw outbox rows queue Reaper delivery immediately after commit'
);

SELECT ok(
  (public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'set_roster',
    '99999999-9999-4999-8999-999999999999',
    0,
    repeat('a', 64)
  ) ->> 'reserved')::boolean,
  'the first command reserves revision zero'
);

SELECT ok(
  (public.spinner_stage_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    jsonb_build_object('participants', '[]'::jsonb, 'rosterHashSha256', repeat('0', 64))
  ) ->> 'ok')::boolean,
  'a clear roster command can be staged'
);

SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
SELECT ok(
  (SELECT revision = 1 AND participants = '[]'::jsonb FROM public.spinner_live_state WHERE singleton_id = 1)
  AND (SELECT status = 'applied' FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'set_roster accepts zero participants and increments the revision once'
);

SELECT ok(
  (public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'set_roster',
    '99999999-9999-4999-8999-999999999999',
    0,
    repeat('a', 64)
  ) ->> 'status') = 'applied'
  AND (SELECT revision = 1 FROM public.spinner_live_state WHERE singleton_id = 1),
  'replaying an applied command returns its result without another revision'
);

SELECT public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'set_roster',
    '99999999-9999-4999-8999-999999999999',
    1,
    repeat('b', 64)
  );
SELECT public.spinner_stage_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    jsonb_build_object(
      'participants', jsonb_build_array(jsonb_build_object(
        'version', 1,
        'id', '11111111-1111-4111-8111-111111111111',
        'displayName', 'Lotus'
      )),
      'rosterHashSha256', repeat('1', 64)
    )
  );
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
SELECT ok(
  (SELECT revision = 2 AND jsonb_array_length(participants) = 1 FROM public.spinner_live_state WHERE singleton_id = 1)
  AND (SELECT status = 'applied' FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  'set_roster accepts one participant for editing while draw eligibility remains separate'
);

UPDATE public.spinner_live_state
SET start_rotation = 777, final_rotation = 777
WHERE singleton_id = 1;

SELECT public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'reset',
    '99999999-9999-4999-8999-999999999999',
    2,
    repeat('c', 64)
  );
SELECT public.spinner_stage_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    '{}'::jsonb
  );
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
SELECT ok(
  (
    SELECT revision = 3
      AND jsonb_array_length(participants) = 1
      AND start_rotation = 777
      AND final_rotation = 777
      AND draw_id IS NULL
      AND winner IS NULL
    FROM public.spinner_live_state
    WHERE singleton_id = 1
  ),
  'reset preserves the roster and resting wheel rotation while clearing prior draw state'
);

SELECT ok(
  (public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    'set_roster',
    '99999999-9999-4999-8999-999999999999',
    3,
    repeat('d', 64)
  ) ->> 'reserved')::boolean,
  'an unstaged command can be reserved before recovery'
);
UPDATE public.spinner_commands
SET created_at = now() - interval '2 minutes',
  lease_expires_at = now() - interval '1 minute'
WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
SELECT public.spinner_recover_commands();
SELECT ok(
  (SELECT action = 'set_roster'
      AND status = 'pending'
      AND staged_payload IS NULL
      AND error_code = 'unstaged_lease_expired'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
  'an expired unstaged non-spin command remains pending and explicitly reclaimable'
);
WITH replay AS MATERIALIZED (
  SELECT public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    'set_roster',
    '99999999-9999-4999-8999-999999999999',
    3,
    repeat('d', 64)
  ) AS result
)
SELECT ok(
  (SELECT (result ->> 'reserved')::boolean
      AND (result ->> 'recoveredReservation')::boolean
      AND result ->> 'status' = 'pending'
    FROM replay)
  AND (SELECT revision = 3 FROM public.spinner_live_state WHERE singleton_id = 1),
  'an exact-ID retry reclaims an expired unstaged command without changing live state'
);

SELECT public.spinner_stage_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    jsonb_build_object(
      'participants', jsonb_build_array(
        jsonb_build_object('version', 1, 'id', '11111111-1111-4111-8111-111111111111', 'displayName', 'Lotus'),
        jsonb_build_object('version', 1, 'id', '22222222-2222-4222-8222-222222222222', 'displayName', 'Jade')
      ),
      'rosterHashSha256', repeat('2', 64)
    )
  );
SELECT ok(
  (SELECT status = 'pending' AND staged_payload is not null
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
  'a recoverable roster replacement can be staged once'
);
UPDATE public.spinner_commands
SET created_at = now() - interval '2 minutes',
  lease_expires_at = now() - interval '1 minute'
WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
SELECT public.spinner_recover_commands();
SELECT ok(
  (SELECT revision = 4 AND jsonb_array_length(participants) = 2
    FROM public.spinner_live_state WHERE singleton_id = 1),
  'an expired staged command applies its frozen payload without resampling'
);

SELECT public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
    'spin',
    '99999999-9999-4999-8999-999999999999',
    4,
    repeat('e', 64)
  );
SELECT public.spinner_stage_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
    jsonb_build_object(
      'receipt', jsonb_build_object(
        'version', 1,
        'drawMode', 'official',
        'drawId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
        'timestampIso', now(),
        'singaporeTime', '26 Jul 2026, 20:34:56 SGT',
        'appVersion', '1.0.0',
        'algorithmVersion', 'uniform-uint32-rejection-v1',
        'rosterSnapshot', jsonb_build_object(
          'version', 1,
          'participants', jsonb_build_array(
            jsonb_build_object('version', 1, 'id', '11111111-1111-4111-8111-111111111111', 'displayName', 'Lotus'),
            jsonb_build_object('version', 1, 'id', '22222222-2222-4222-8222-222222222222', 'displayName', 'Jade')
          )
        ),
        'rosterHashSha256', repeat('2', 64),
        'rejectionLimit', 4294967296,
        'sampledWords', jsonb_build_array(1),
        'acceptedWord', 1,
        'selectedIndex', 1,
        'winner', jsonb_build_object('version', 1, 'id', '22222222-2222-4222-8222-222222222222', 'displayName', 'Jade')
      ),
      'startAt', now() + interval '2 seconds',
      'revealAt', now() + interval '6.8 seconds',
      'durationMs', 4800,
      'startRotation', 777,
      'finalRotation', 2757,
      'discordChannelKey', 'raffle_spins',
      'discordChannelId', '1468667003366674721',
      'discordStartPayload', jsonb_build_object(
        'content', 'Mōchirīī raffle timing test',
        'nonce', 'bbbbbbbbbbbbbbbbbbbbbbbbc',
        'enforce_nonce', true,
        'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
      ),
      'discordResultPayload', jsonb_build_object(
        'content', 'Mōchirīī raffle timing result',
        'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
      )
    )
  );
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5');
SELECT ok(
  (SELECT status = 'rejected' AND error_code = 'invalid_receipt'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5')
  AND (SELECT revision = 4 FROM public.spinner_live_state WHERE singleton_id = 1)
  AND NOT EXISTS (SELECT 1 FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'),
  'the released two-second lead is rejected by the forward timing rule'
);

CREATE TEMP TABLE spinner_v2_required_key_fixture (
  payload jsonb NOT NULL,
  state_before jsonb NOT NULL
) ON COMMIT DROP;
INSERT INTO spinner_v2_required_key_fixture
SELECT
  jsonb_build_object(
    'version', 2,
    'receipt', jsonb_build_object(
      'version', 2,
      'drawMode', 'official',
      'drawId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1',
      'timestampIso', '2019-12-01T00:00:00.000Z',
      'singaporeTime', '01 Dec 2019, 08:00:00 SGT',
      'appVersion', '2.0.0',
      'algorithmVersion', 'uniform-elimination-uint32-rejection-v2',
      'rosterSnapshot', jsonb_build_object(
        'version', 1,
        'participants', jsonb_build_array(
          jsonb_build_object('version', 1, 'id', '11111111-1111-4111-8111-111111111111', 'displayName', 'Lotus'),
          jsonb_build_object('version', 1, 'id', '22222222-2222-4222-8222-222222222222', 'displayName', 'Jade')
        )
      ),
      'rosterHashSha256', repeat('2', 64),
      'planHashSha256', '6ecfd9467152e92322d874341ad9214b76d37fcd87253259eb0b90bf5651b3a1',
      'durationMs', 5000,
      'startAt', '2019-12-01T00:01:00.000Z',
      'revealAt', '2019-12-01T00:01:05.000Z',
      'startRotation', 180,
      'finalRotation', 2340,
      'rounds', jsonb_build_array(jsonb_build_object(
        'roundIndex', 0,
        'activeCount', 2,
        'selectedIndex', 0,
        'eliminatedId', '11111111-1111-4111-8111-111111111111',
        'eliminatedParticipant', jsonb_build_object(
          'version', 1,
          'id', '11111111-1111-4111-8111-111111111111',
          'displayName', 'Lotus'
        ),
        'rejectionLimit', 4294967296,
        'sampledWords', jsonb_build_array(0),
        'acceptedWord', 0,
        'startedAt', '2019-12-01T00:01:00.000Z',
        'revealAt', '2019-12-01T00:01:05.000Z',
        'startRotation', 180,
        'finalRotation', 2520
      )),
      'selectedIndex', 1,
      'winner', jsonb_build_object(
        'version', 1,
        'id', '22222222-2222-4222-8222-222222222222',
        'displayName', 'Jade'
      )
    ),
    'planHashSha256', '6ecfd9467152e92322d874341ad9214b76d37fcd87253259eb0b90bf5651b3a1',
    'rounds', jsonb_build_array(jsonb_build_object(
      'roundIndex', 0,
      'activeCount', 2,
      'selectedIndex', 0,
      'eliminatedId', '11111111-1111-4111-8111-111111111111',
      'eliminatedParticipant', jsonb_build_object(
        'version', 1,
        'id', '11111111-1111-4111-8111-111111111111',
        'displayName', 'Lotus'
      ),
      'rejectionLimit', 4294967296,
      'sampledWords', jsonb_build_array(0),
      'acceptedWord', 0,
      'startedAt', '2019-12-01T00:01:00.000Z',
      'revealAt', '2019-12-01T00:01:05.000Z',
      'startRotation', 180,
      'finalRotation', 2520
    )),
    'startAt', '2019-12-01T00:01:00.000Z',
    'revealAt', '2019-12-01T00:01:05.000Z',
    'durationMs', 5000,
    'startRotation', 180,
    'finalRotation', 2340,
    'animationManifest', '{}'::jsonb,
    'animationManifestHashSha256', repeat('9', 64),
    'discordChannelKey', 'raffle_spins',
    'discordChannelId', '1468667003366674721',
    'discordStartPayload', jsonb_build_object(
      'content', 'Required-key regression draw',
      'nonce', 'bbbbbbbbbbbbbbbbbbbbbbbc1',
      'enforce_nonce', true,
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
    ),
    'discordResultPayload', jsonb_build_object(
      'content', 'Required-key regression result',
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
    )
  ),
  to_jsonb(state_row)
FROM public.spinner_live_state state_row
WHERE singleton_id = 1;

SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1', 'spin',
  '99999999-9999-4999-8999-999999999999', 4, repeat('1', 64)
);
SELECT public.spinner_stage_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1',
  (SELECT payload - 'discordResultPayload' FROM spinner_v2_required_key_fixture)
);
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1');
SELECT ok(
  (SELECT status = 'rejected' AND error_code = 'invalid_receipt'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND (SELECT to_jsonb(state_row) = fixture.state_before
    FROM public.spinner_live_state state_row
    CROSS JOIN spinner_v2_required_key_fixture fixture
    WHERE state_row.singleton_id = 1),
  'a staged v2 envelope missing one required key is rejected without receipt, outbox, or state mutation'
);

SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac2', 'spin',
  '99999999-9999-4999-8999-999999999999', 4, repeat('2', 64)
);
SELECT public.spinner_stage_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac2',
  (SELECT jsonb_set(payload, '{receipt}', (payload -> 'receipt') - 'singaporeTime')
   FROM spinner_v2_required_key_fixture)
);
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac2');
SELECT ok(
  (SELECT status = 'rejected' AND error_code = 'invalid_receipt'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac2')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND (SELECT to_jsonb(state_row) = fixture.state_before
    FROM public.spinner_live_state state_row
    CROSS JOIN spinner_v2_required_key_fixture fixture
    WHERE state_row.singleton_id = 1),
  'a v2 receipt missing one required key is rejected without receipt, outbox, or state mutation'
);

UPDATE public.spinner_live_state
SET participants = jsonb_set(participants, '{0}', (participants -> 0) - 'displayName'),
  roster_hash_sha256 = 'eb08fd27f97164ea1875e19e1f18de49c3c4d19c272693a917f66b86dd03c23d'
WHERE singleton_id = 1;
CREATE TEMP TABLE spinner_v2_missing_participant_state AS
SELECT to_jsonb(state_row) AS state_before
FROM public.spinner_live_state state_row
WHERE singleton_id = 1;

SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac3', 'spin',
  '99999999-9999-4999-8999-999999999999', 4, repeat('3', 64)
);
WITH source AS (
  SELECT
    payload,
    (payload #> '{receipt,rosterSnapshot,participants,0}') - 'displayName' AS participant,
    (payload #> '{receipt,rounds,0,eliminatedParticipant}') - 'displayName' AS eliminated_participant
  FROM spinner_v2_required_key_fixture
), mutant AS (
  SELECT jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(payload, '{receipt,rosterSnapshot,participants,0}', participant),
            '{receipt,rosterHashSha256}',
            to_jsonb('eb08fd27f97164ea1875e19e1f18de49c3c4d19c272693a917f66b86dd03c23d'::text)
          ),
          '{receipt,planHashSha256}',
          to_jsonb('874a50d21e6192113588760f247d3b6f77217d32adb9c3143efc0698a7a10ba2'::text)
        ),
        '{planHashSha256}',
        to_jsonb('874a50d21e6192113588760f247d3b6f77217d32adb9c3143efc0698a7a10ba2'::text)
      ),
      '{receipt,rounds,0,eliminatedParticipant}', eliminated_participant
    ),
    '{rounds,0,eliminatedParticipant}', eliminated_participant
  ) AS payload
  FROM source
)
SELECT public.spinner_stage_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac3', payload)
FROM mutant;
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac3');
SELECT ok(
  (SELECT status = 'rejected' AND error_code = 'invalid_receipt'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac3')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND (SELECT to_jsonb(state_row) = baseline.state_before
    FROM public.spinner_live_state state_row
    CROSS JOIN spinner_v2_missing_participant_state baseline
    WHERE state_row.singleton_id = 1),
  'a roster participant missing one required key is rejected without receipt, outbox, or state mutation'
);
UPDATE public.spinner_live_state
SET participants = (SELECT payload #> '{receipt,rosterSnapshot,participants}'
    FROM spinner_v2_required_key_fixture),
  roster_hash_sha256 = repeat('2', 64)
WHERE singleton_id = 1;

SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac4', 'spin',
  '99999999-9999-4999-8999-999999999999', 4, repeat('4', 64)
);
WITH source AS (
  SELECT payload, (payload #> '{receipt,rounds,0}') - 'eliminatedId' AS round
  FROM spinner_v2_required_key_fixture
), mutant AS (
  SELECT jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(payload, '{receipt,rounds,0}', round),
        '{rounds,0}', round
      ),
      '{receipt,planHashSha256}',
      to_jsonb('b1b8a7786162f7f8d0d4c1070b568d051145c5fbc04e129f99d71898c998c4a1'::text)
    ),
    '{planHashSha256}',
    to_jsonb('b1b8a7786162f7f8d0d4c1070b568d051145c5fbc04e129f99d71898c998c4a1'::text)
  ) AS payload
  FROM source
)
SELECT public.spinner_stage_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac4', payload)
FROM mutant;
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac4');
SELECT ok(
  (SELECT status = 'rejected' AND error_code = 'invalid_receipt'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac4')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND (SELECT to_jsonb(state_row) = fixture.state_before
    FROM public.spinner_live_state state_row
    CROSS JOIN spinner_v2_required_key_fixture fixture
    WHERE state_row.singleton_id = 1),
  'a full v2 round missing one required key is rejected without receipt, outbox, or state mutation'
);

SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac5', 'spin',
  '99999999-9999-4999-8999-999999999999', 4, repeat('5', 64)
);
SELECT public.spinner_stage_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac5',
  (SELECT jsonb_set(
      payload,
      '{receipt,timestampIso}',
      to_jsonb('not-a-timestamp'::text)
    )
   FROM spinner_v2_required_key_fixture)
);
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac5');
SELECT ok(
  (SELECT status = 'rejected' AND error_code = 'invalid_receipt'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac5')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1')
  AND (SELECT to_jsonb(state_row) = fixture.state_before
    FROM public.spinner_live_state state_row
    CROSS JOIN spinner_v2_required_key_fixture fixture
    WHERE state_row.singleton_id = 1),
  'a v2 malformed timestamp is categorically rejected without receipt, outbox, or state mutation'
);

SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0',
  'spin',
  '99999999-9999-4999-8999-999999999999',
  4,
  repeat('0', 64)
);
SELECT public.spinner_stage_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0',
  jsonb_build_object(
    'receipt', jsonb_build_object(
      'version', 1,
      'drawMode', 'official',
      'drawId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba0',
      'timestampIso', '2020-01-01T00:00:00.000Z',
      'singaporeTime', '01 Jan 2020, 08:00:00 SGT',
      'appVersion', '1.0.0',
      'algorithmVersion', 'uniform-uint32-rejection-v1',
      'rosterSnapshot', jsonb_build_object(
        'version', 1,
        'participants', jsonb_build_array(
          jsonb_build_object('version', 1, 'id', '11111111-1111-4111-8111-111111111111', 'displayName', 'Lotus'),
          jsonb_build_object('version', 1, 'id', '22222222-2222-4222-8222-222222222222', 'displayName', 'Jade')
        )
      ),
      'rosterHashSha256', repeat('2', 64),
      'rejectionLimit', 4294967296,
      'sampledWords', jsonb_build_array(1),
      'acceptedWord', 1,
      'selectedIndex', 1,
      'winner', jsonb_build_object(
        'version', 1,
        'id', '22222222-2222-4222-8222-222222222222',
        'displayName', 'Jade'
      )
    ),
    'startAt', '2020-01-01T00:03:00.000Z',
    'revealAt', '2020-01-01T00:03:04.800Z',
    'durationMs', 4800,
    'startRotation', 0,
    'finalRotation', 2340,
    'discordChannelKey', 'raffle_spins',
    'discordChannelId', '1468667003366674721',
    'discordStartPayload', jsonb_build_object(
      'content', 'Mōchirīī released v1 compatibility draw',
      'nonce', 'bbbbbbbbbbbbbbbbbbbbbbba0',
      'enforce_nonce', true,
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
    ),
    'discordResultPayload', jsonb_build_object(
      'content', 'Mōchirīī released v1 compatibility result',
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
    )
  )
);
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0');
SELECT ok(
  (SELECT status = 'applied'
      AND response_snapshot ->> 'version' = '1'
      AND response_receipt ->> 'version' = '1'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0')
  AND (SELECT algorithm_version = 'uniform-uint32-rejection-v1'
      AND rejection_limit = 4294967296
      AND sampled_words = jsonb_build_array(1)
      AND accepted_word = 1
      AND elimination_plan is null
      AND plan_hash_sha256 is null
    FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba0')
  AND EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba0'
      AND draw_mode = 'official'
      AND reveal_after = '2020-01-01T00:03:04.800Z'::timestamptz),
  'an already-staged released v1 command remains resumable with its three-minute proof and v1 snapshot'
);
SELECT public.spinner_finalize_reveal();

CREATE TEMP TABLE spinner_v1_invalid_datetime_state AS
SELECT to_jsonb(state_row) AS state_before
FROM public.spinner_live_state state_row
WHERE singleton_id = 1;
SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac6', 'spin',
  '99999999-9999-4999-8999-999999999999', 6, repeat('6', 64)
);
SELECT public.spinner_stage_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac6',
  (SELECT jsonb_set(
      jsonb_set(
        staged_payload,
        '{receipt,drawId}',
        to_jsonb('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbac6'::text)
      ),
      '{receipt,timestampIso}',
      to_jsonb('not-a-timestamp'::text)
    )
   FROM public.spinner_commands
   WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0')
);
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac6');
SELECT ok(
  (SELECT status = 'rejected' AND error_code = 'invalid_receipt'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac6')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbac6')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbac6')
  AND (SELECT to_jsonb(state_row) = baseline.state_before
    FROM public.spinner_live_state state_row
    CROSS JOIN spinner_v1_invalid_datetime_state baseline
    WHERE state_row.singleton_id = 1),
  'a staged v1 malformed timestamp is categorically rejected without receipt, outbox, or state mutation'
);

SELECT public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
    'spin',
    '99999999-9999-4999-8999-999999999999',
    6,
    repeat('f', 64)
  );
SELECT public.spinner_stage_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
    jsonb_build_object(
      'version', 2,
      'receipt', jsonb_build_object(
        'version', 2,
        'drawMode', 'official',
        'drawId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'timestampIso', '2020-02-01T00:00:00.000Z',
        'singaporeTime', '01 Feb 2020, 08:00:00 SGT',
        'appVersion', '2.0.0',
        'algorithmVersion', 'uniform-elimination-uint32-rejection-v2',
        'rosterSnapshot', jsonb_build_object(
          'version', 1,
          'participants', jsonb_build_array(
            jsonb_build_object('version', 1, 'id', '11111111-1111-4111-8111-111111111111', 'displayName', 'Lotus'),
            jsonb_build_object('version', 1, 'id', '22222222-2222-4222-8222-222222222222', 'displayName', 'Jade')
          )
        ),
        'rosterHashSha256', repeat('2', 64),
        'planHashSha256', 'c5e45700a5d5ab339499e02f34cd3893b2bc22559bb26531eb0cb6d4cf10a4d1',
        'durationMs', 5000,
        'startAt', '2020-02-01T00:01:00.000Z',
        'revealAt', '2020-02-01T00:01:05.000Z',
        'startRotation', 180,
        'finalRotation', 2340,
        'rounds', jsonb_build_array(jsonb_build_object(
          'roundIndex', 0,
          'activeCount', 2,
          'selectedIndex', 0,
          'eliminatedId', '11111111-1111-4111-8111-111111111111',
          'eliminatedParticipant', jsonb_build_object(
            'version', 1,
            'id', '11111111-1111-4111-8111-111111111111',
            'displayName', 'Lotus'
          ),
          'rejectionLimit', 4294967296,
          'sampledWords', jsonb_build_array(0),
          'acceptedWord', 0,
          'startedAt', '2020-02-01T00:01:00.000Z',
          'revealAt', '2020-02-01T00:01:05.000Z',
          'startRotation', 180,
          'finalRotation', 2520
        )),
        'selectedIndex', 1,
        'winner', jsonb_build_object('version', 1, 'id', '22222222-2222-4222-8222-222222222222', 'displayName', 'Jade')
      ),
      'planHashSha256', 'c5e45700a5d5ab339499e02f34cd3893b2bc22559bb26531eb0cb6d4cf10a4d1',
      'rounds', jsonb_build_array(jsonb_build_object(
        'roundIndex', 0,
        'activeCount', 2,
        'selectedIndex', 0,
        'eliminatedId', '11111111-1111-4111-8111-111111111111',
        'eliminatedParticipant', jsonb_build_object(
          'version', 1,
          'id', '11111111-1111-4111-8111-111111111111',
          'displayName', 'Lotus'
        ),
        'rejectionLimit', 4294967296,
        'sampledWords', jsonb_build_array(0),
        'acceptedWord', 0,
        'startedAt', '2020-02-01T00:01:00.000Z',
        'revealAt', '2020-02-01T00:01:05.000Z',
        'startRotation', 180,
        'finalRotation', 2520
      )),
      'startAt', '2020-02-01T00:01:00.000Z',
      'revealAt', '2020-02-01T00:01:05.000Z',
      'durationMs', 5000,
      'startRotation', 180,
      'finalRotation', 2340,
      'animationManifest', jsonb_build_object('version', 1),
      'animationManifestHashSha256', repeat('9', 64),
      'discordChannelKey', 'raffle_spins',
      'discordChannelId', '1468667003366674721',
      'discordStartPayload', jsonb_build_object(
        'content', format(
          E'A Mōchirīī monthly guild raffle begins <t:%s:R>.\nWatch the moonwheel live: https://mochirii.com/account?open=live-draw',
          floor(extract(epoch from '2020-02-01T00:01:00.000Z'::timestamptz))::bigint
        ),
        'nonce', 'bbbbbbbbbbbbbbbbbbbbbbbbb',
        'enforce_nonce', true,
        'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
      ),
      'discordResultPayload', jsonb_build_object(
        'content', 'Mōchirīī raffle complete.',
        'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
      )
    )
  );
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6');
SELECT ok(
  (SELECT status = 'applied' FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6')
  AND (SELECT phase = 'start_pending' AND next_attempt_at <= now()
      AND reveal_after = '2020-02-01T00:01:05.000Z'::timestamptz
    FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'a v2 spin persists the fixed one-minute lead and five-second round before delivery'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  AND EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_media_jobs
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'malformed optional media cannot roll back the draw or primary message outbox'
);

SELECT ok(
  (SELECT timestamp_iso = '2020-02-01T00:00:00.000Z'::timestamptz
      AND timestamp_iso = (receipt ->> 'timestampIso')::timestamptz
      AND algorithm_version = 'uniform-elimination-uint32-rejection-v2'
      AND rejection_limit is null AND sampled_words is null AND accepted_word is null
      AND jsonb_array_length(elimination_plan) = 1
      AND plan_hash_sha256 = receipt ->> 'planHashSha256'
    FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  AND (SELECT started_at = '2020-02-01T00:01:00.000Z'::timestamptz
      AND reveal_at = '2020-02-01T00:01:05.000Z'::timestamptz
      AND duration_ms = 5000
    FROM public.spinner_live_state WHERE singleton_id = 1),
  'the v2 receipt stores its full proof while live state stores the compact elimination plan'
);

SELECT ok(
  (SELECT response_snapshot -> 'winner' = 'null'::jsonb
      AND response_snapshot -> 'selectedIndex' = 'null'::jsonb
      AND jsonb_array_length(response_snapshot -> 'rounds') = 1
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),
  'the spinning v2 command exposes its compact round plan without revealing the final survivor early'
);

UPDATE public.spinner_discord_outbox
SET attempt_count = 20,
  claim_token = null,
  claim_expires_at = null
WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT * FROM public.spinner_claim_discord_outbox(
  'abababab-abab-4bab-8bab-abababababab',
  10
);
SELECT ok(
  (SELECT phase = 'failed' AND last_error_code = 'delivery_attempts_exhausted'
    FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'an exhausted delivery is failed deterministically instead of violating its attempt bound'
);

UPDATE public.spinner_live_state
SET started_at = now() - interval '6 seconds',
  reveal_at = now() - interval '1 second'
WHERE singleton_id = 1;
SELECT public.spinner_finalize_reveal();
WITH replay AS MATERIALIZED (
  SELECT public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
    'spin',
    '99999999-9999-4999-8999-999999999999',
    6,
    repeat('f', 64)
  ) AS result
)
SELECT ok(
  (SELECT result -> 'snapshot' ->> 'phase' = 'revealed'
      AND result -> 'snapshot' -> 'winner' ->> 'displayName' = 'Jade'
    FROM replay),
  'an applied spin replay returns the current revealed winner without changing revision'
);

CREATE TEMP TABLE spinner_test_mode_side_effect_baseline (
  outbox_count bigint NOT NULL,
  media_count bigint NOT NULL,
  publication_count bigint NOT NULL,
  test_cycle_publication_count bigint NOT NULL
) ON COMMIT DROP;
INSERT INTO spinner_test_mode_side_effect_baseline
SELECT
  (SELECT count(*) FROM public.spinner_discord_outbox),
  (SELECT count(*) FROM public.spinner_media_jobs),
  (SELECT count(*) FROM public.spinner_raffle_result_publications),
  (SELECT count(*) FROM public.spinner_raffle_result_publications
    WHERE cycle_month = '2020-03-01'::date);

SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
  'spin',
  '99999999-9999-4999-8999-999999999999',
  8,
  repeat('9', 64)
);
SELECT public.spinner_stage_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
  jsonb_build_object(
    'version', 2,
    'receipt', jsonb_build_object(
      'version', 2,
      'drawMode', 'test',
      'drawId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe',
      'timestampIso', '2020-03-01T01:00:00.000Z',
      'singaporeTime', '01 Mar 2020, 09:00:00 SGT',
      'appVersion', '2.0.0',
      'algorithmVersion', 'uniform-elimination-uint32-rejection-v2',
      'rosterSnapshot', jsonb_build_object(
        'version', 1,
        'participants', jsonb_build_array(
          jsonb_build_object('version', 1, 'id', '11111111-1111-4111-8111-111111111111', 'displayName', 'Lotus'),
          jsonb_build_object('version', 1, 'id', '22222222-2222-4222-8222-222222222222', 'displayName', 'Jade')
        )
      ),
      'rosterHashSha256', repeat('2', 64),
      'planHashSha256', '933d1b7765e5c7f2d23f52e09f2d9cf693286ce8a7c11e46abc1ea4eeee7d518',
      'durationMs', 5000,
      'startAt', '2020-03-01T01:01:00.000Z',
      'revealAt', '2020-03-01T01:01:05.000Z',
      'startRotation', 180,
      'finalRotation', 2340,
      'rounds', jsonb_build_array(jsonb_build_object(
        'roundIndex', 0,
        'activeCount', 2,
        'selectedIndex', 0,
        'eliminatedId', '11111111-1111-4111-8111-111111111111',
        'eliminatedParticipant', jsonb_build_object(
          'version', 1,
          'id', '11111111-1111-4111-8111-111111111111',
          'displayName', 'Lotus'
        ),
        'rejectionLimit', 4294967296,
        'sampledWords', jsonb_build_array(0),
        'acceptedWord', 0,
        'startedAt', '2020-03-01T01:01:00.000Z',
        'revealAt', '2020-03-01T01:01:05.000Z',
        'startRotation', 180,
        'finalRotation', 2520
      )),
      'selectedIndex', 1,
      'winner', jsonb_build_object(
        'version', 1,
        'id', '22222222-2222-4222-8222-222222222222',
        'displayName', 'Jade'
      )
    ),
    'planHashSha256', '933d1b7765e5c7f2d23f52e09f2d9cf693286ce8a7c11e46abc1ea4eeee7d518',
    'rounds', jsonb_build_array(jsonb_build_object(
      'roundIndex', 0,
      'activeCount', 2,
      'selectedIndex', 0,
      'eliminatedId', '11111111-1111-4111-8111-111111111111',
      'eliminatedParticipant', jsonb_build_object(
        'version', 1,
        'id', '11111111-1111-4111-8111-111111111111',
        'displayName', 'Lotus'
      ),
      'rejectionLimit', 4294967296,
      'sampledWords', jsonb_build_array(0),
      'acceptedWord', 0,
      'startedAt', '2020-03-01T01:01:00.000Z',
      'revealAt', '2020-03-01T01:01:05.000Z',
      'startRotation', 180,
      'finalRotation', 2520
    )),
    'startAt', '2020-03-01T01:01:00.000Z',
    'revealAt', '2020-03-01T01:01:05.000Z',
    'durationMs', 5000,
    'startRotation', 180,
    'finalRotation', 2340,
    'animationManifest', jsonb_build_object(
      'version', 1,
      'styleVersion', 'mochirii-raffle-film-v1',
      'width', 1280,
      'height', 720,
      'durationMs', 10600,
      'drawId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe',
      'startAt', '2020-03-01T01:01:00.000Z',
      'revealAt', '2020-03-01T01:01:05.000Z',
      'startRotation', 180,
      'finalRotation', 2340,
      'rosterHashSha256', repeat('2', 64),
      'participants', jsonb_build_array(
        jsonb_build_object('version', 1, 'number', 1, 'label', '1. Lotus'),
        jsonb_build_object('version', 1, 'number', 2, 'label', '2. Jade')
      ),
      'selectedIndex', 1,
      'winner', jsonb_build_object(
        'version', 1,
        'number', 2,
        'displayName', 'Jade'
      ),
      'visualSeedSha256', 'bfe89c772e87dcd9d4773dcb84fdfe08104b040aa24fb00a624e9ef8636883eb'
    ),
    'animationManifestHashSha256', 'ed480a7239cf0dc48ba27e492cc4181786e96b68cf395013dd81a3097a042d82',
    'discordChannelKey', 'raffle_spins',
    'discordChannelId', '1468667003366674721',
    'discordStartPayload', jsonb_build_object(
      'content', 'Mōchirīī private test sequence',
      'nonce', 'bbbbbbbbbbbbbbbbbbbbbbbbe',
      'enforce_nonce', true,
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
    ),
    'discordResultPayload', jsonb_build_object(
      'content', 'Mōchirīī private test complete.',
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
    )
  )
);
SELECT public.spinner_apply_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9');
SELECT ok(
  (SELECT status = 'applied' AND response_receipt ->> 'drawMode' = 'test'
      AND response_snapshot -> 'winner' = 'null'::jsonb
      AND response_snapshot -> 'selectedIndex' = 'null'::jsonb
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9')
  AND (SELECT draw_mode = 'test' AND phase = 'spinning'
      AND duration_ms = 5000 AND jsonb_array_length(elimination_plan) = 1
    FROM public.spinner_live_state WHERE singleton_id = 1)
  AND (SELECT draw_mode = 'test' AND selected_index = 1
      AND winner ->> 'displayName' = 'Jade'
    FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe'),
  'the actual staged test-mode v2 sequence uses the same final-survivor contract'
);
SELECT ok(
  (SELECT count(*) FROM public.spinner_discord_outbox) =
    (SELECT outbox_count FROM spinner_test_mode_side_effect_baseline)
  AND (SELECT count(*) FROM public.spinner_media_jobs) =
    (SELECT media_count FROM spinner_test_mode_side_effect_baseline)
  AND (SELECT count(*) FROM public.spinner_raffle_result_publications) =
    (SELECT publication_count FROM spinner_test_mode_side_effect_baseline)
  AND (SELECT count(*) FROM public.spinner_raffle_result_publications
      WHERE cycle_month = '2020-03-01'::date) =
    (SELECT test_cycle_publication_count FROM spinner_test_mode_side_effect_baseline)
  AND NOT EXISTS (SELECT 1 FROM public.spinner_discord_outbox
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_media_jobs
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_raffle_result_publications
    WHERE source_draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe'),
  'the actual test-mode apply creates zero outbox, media, public-result, or monthly side effects'
);

INSERT INTO public.spinner_commands (
  command_id, action, actor_id, expected_revision, request_hash_sha256, status,
  created_at, lease_expires_at, completed_at, expires_at
) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'spin',
  '99999999-9999-4999-8999-999999999999', 0, repeat('3', 64), 'applied',
  now() - interval '31 days', now() - interval '30 days', now() - interval '31 days', now() - interval '1 day'
);
INSERT INTO public.spinner_draw_receipts (
  draw_id, command_id, session_id, revision, actor_id, timestamp_iso,
  singapore_time, app_version, algorithm_version, roster_snapshot,
  roster_hash_sha256, rejection_limit, sampled_words, accepted_word,
  selected_index, winner, receipt, created_at, expires_at
) VALUES (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1,
  '99999999-9999-4999-8999-999999999999', now() - interval '31 days',
  '25 Jun 2026, 20:34:56 SGT', '1.0.0', 'uniform-uint32-rejection-v1',
  jsonb_build_object('version', 1, 'participants', jsonb_build_array(
    jsonb_build_object('version', 1, 'id', '11111111-1111-4111-8111-111111111111', 'displayName', 'Lotus'),
    jsonb_build_object('version', 1, 'id', '22222222-2222-4222-8222-222222222222', 'displayName', 'Jade')
  )),
  repeat('3', 64), 4294967296, jsonb_build_array(0), 0, 0,
  jsonb_build_object('version', 1, 'id', '11111111-1111-4111-8111-111111111111', 'displayName', 'Lotus'),
  jsonb_build_object('version', 1, 'drawMode', 'official', 'drawId', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  now() - interval '31 days', now() - interval '1 day'
);
INSERT INTO public.spinner_discord_outbox (
  draw_id, channel_key, channel_id, phase, start_payload, result_payload,
  reveal_after, created_at, updated_at, completed_at, expires_at
) VALUES (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'raffle_spins', '1468667003366674721', 'completed',
  jsonb_build_object(
    'content', 'Expired draw', 'nonce', 'ddddddddddddddddddddddddd', 'enforce_nonce', true,
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  jsonb_build_object(
    'content', 'Expired result',
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  now() - interval '31 days', now() - interval '31 days', now() - interval '31 days',
  now() - interval '31 days', now() - interval '1 day'
);
UPDATE public.spinner_live_state
SET draw_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
WHERE singleton_id = 1;
SELECT public.spinner_cleanup_expired();
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.spinner_discord_outbox WHERE draw_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_draw_receipts WHERE draw_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_commands WHERE command_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'retention cleanup removes expired evidence after 30 days even when the live stage still points at that draw'
);

SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
  'spin',
  '99999999-9999-4999-8999-999999999999',
  9,
  repeat('7', 64)
);
UPDATE public.spinner_commands
SET created_at = now() - interval '2 minutes',
  lease_expires_at = now() - interval '1 minute'
WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
SELECT public.spinner_recover_commands();
WITH replay AS MATERIALIZED (
  SELECT public.spinner_reserve_command(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
    'spin',
    '99999999-9999-4999-8999-999999999999',
    9,
    repeat('7', 64)
  ) AS result
)
SELECT ok(
  (SELECT result ->> 'reserved' = 'false'
      AND result ->> 'status' = 'rejected'
      AND result ->> 'error' = 'spin_result_not_durable'
    FROM replay),
  'a persisted spin reservation lost before staging is terminal so its exact command ID cannot resample'
);

SELECT public.spinner_reserve_command(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
  'spin',
  '99999999-9999-4999-8999-999999999999',
  9,
  repeat('8', 64)
);
SELECT public.spinner_reject_unstaged_spin(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8'
);
SELECT ok(
  (SELECT status = 'rejected' AND error_code = 'spin_result_not_durable'
    FROM public.spinner_commands
    WHERE command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8'),
  'an Edge failure terminalizes an unstaged spin so retry requires a new command ID'
);

INSERT INTO public.spinner_moderator_authorizations (user_id, verified_at, expires_at)
VALUES (
  '99999999-9999-4999-8999-999999999999',
  now() - interval '10 minutes',
  now() - interval '5 minutes'
);
SELECT public.spinner_cleanup_expired();
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.spinner_moderator_authorizations
    WHERE user_id = '99999999-9999-4999-8999-999999999999'),
  'expired moderator authority is removed by bounded retention cleanup'
);

INSERT INTO public.spinner_moderator_authorizations (user_id, verified_at, expires_at)
VALUES (
  '99999999-9999-4999-8999-999999999999',
  now(),
  now() + interval '5 minutes'
);

DELETE FROM auth.users WHERE id = '99999999-9999-4999-8999-999999999999';
SELECT ok(
  NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '99999999-9999-4999-8999-999999999999')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_commands WHERE actor_id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.spinner_draw_receipts WHERE actor_id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.spinner_moderator_authorizations)
  AND EXISTS (SELECT 1 FROM public.spinner_draw_receipts
    WHERE draw_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'deleting a moderator account nulls actor references while retaining immutable draw evidence'
);

SELECT * FROM finish();
ROLLBACK;
