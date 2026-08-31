BEGIN;
SELECT plan(31);

CREATE TEMP TABLE spinner_dispatch_probe (
  call_count integer NOT NULL DEFAULT 0
) ON COMMIT DROP;
INSERT INTO spinner_dispatch_probe DEFAULT VALUES;

CREATE OR REPLACE FUNCTION private.spinner_invoke_reaper_dispatcher()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE pg_temp.spinner_dispatch_probe
  SET call_count = call_count + 1;
  RETURN 1;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) VALUES (
  '91919191-9191-4919-8919-919191919191',
  'authenticated', 'authenticated', 'raffle-publication-test@example.invalid', '', now(), now(), now()
);

UPDATE public.member_profiles
SET display_name = 'Jade Lantern', member_status = 'active',
  has_required_discord_roles = true, discord_verified_at = now()
WHERE id = '91919191-9191-4919-8919-919191919191';

SELECT ok(to_regclass('public.spinner_raffle_result_publications') IS NOT NULL, 'official result bridge exists');
SELECT ok(to_regclass('public.spinner_raffle_result_revocations') IS NOT NULL, 'result revocation ledger exists');
SELECT ok(
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
    'public.spinner_raffle_result_publications'::regclass,
    'public.spinner_raffle_result_revocations'::regclass
  )),
  'RLS protects both result tables'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.spinner_raffle_result_publications', 'select')
  AND NOT has_table_privilege('authenticated', 'public.spinner_raffle_result_publications', 'select')
  AND NOT has_table_privilege('anon', 'public.spinner_raffle_result_revocations', 'select')
  AND NOT has_table_privilege('authenticated', 'public.spinner_raffle_result_revocations', 'select'),
  'browser roles cannot read either service-only result table'
);
SELECT ok(
  has_function_privilege('anon', 'public.get_latest_official_raffle_winner()', 'execute')
  AND has_function_privilege('authenticated', 'public.get_latest_official_raffle_winner()', 'execute'),
  'the minimal public result RPC is available to both viewer classes'
);
SELECT is(
  (SELECT count(*)::integer FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'draw_mode'
     AND table_name IN ('spinner_live_state', 'spinner_draw_receipts', 'spinner_discord_outbox')),
  3,
  'live state, receipts, and outbox persist server-authoritative draw mode'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.spinner_discord_outbox'::regclass
      AND tgname = 'spinner_discord_outbox_queue_dispatch'
      AND tgenabled <> 'D'
      AND (tgtype & 1) = 1
  ),
  'the Reaper dispatcher is bound to each surviving official outbox row'
);

INSERT INTO public.spinner_commands (
  command_id, action, actor_id, expected_revision, request_hash_sha256, status,
  staged_payload, completed_at
) VALUES (
  '10101010-1010-4010-8010-101010101010', 'spin',
  '91919191-9191-4919-8919-919191919191', 0, repeat('1', 64), 'applied', '{}'::jsonb, now()
);
INSERT INTO public.spinner_draw_receipts (
  draw_id, command_id, session_id, revision, actor_id, timestamp_iso,
  singapore_time, app_version, algorithm_version, roster_snapshot,
  roster_hash_sha256, rejection_limit, sampled_words, accepted_word,
  selected_index, winner, receipt
) VALUES (
  '11111111-1010-4010-8010-101010101010',
  '10101010-1010-4010-8010-101010101010',
  '12121212-1010-4010-8010-101010101010', 1,
  '91919191-9191-4919-8919-919191919191', now() - interval '3 hours',
  'Test draw', '1.0.0', 'uniform-uint32-rejection-v1',
  jsonb_build_object('version', 1, 'participants', jsonb_build_array(
    jsonb_build_object('version', 1, 'id', '13131313-1010-4010-8010-101010101010', 'displayName', 'Lotus'),
    jsonb_build_object('version', 1, 'id', '14141414-1010-4010-8010-101010101010', 'displayName', 'Jade Lantern')
  )),
  repeat('1', 64), 4294967296, jsonb_build_array(1), 1, 1,
  jsonb_build_object('version', 1, 'id', '14141414-1010-4010-8010-101010101010', 'displayName', 'Jade Lantern'),
  jsonb_build_object(
    'version', 1, 'drawMode', 'test',
    'drawId', '11111111-1010-4010-8010-101010101010',
    'winner', jsonb_build_object('version', 1, 'id', '14141414-1010-4010-8010-101010101010', 'displayName', 'Jade Lantern')
  )
);

SELECT is(
  (SELECT draw_mode FROM public.spinner_draw_receipts WHERE draw_id = '11111111-1010-4010-8010-101010101010'),
  'test',
  'the receipt trigger persists test mode from the immutable receipt'
);

INSERT INTO public.spinner_discord_outbox (
  draw_id, channel_key, channel_id, start_payload, result_payload, reveal_after
) VALUES (
  '11111111-1010-4010-8010-101010101010', 'raffle_spins', '1468667003366674721',
  jsonb_build_object(
    'content', 'test', 'nonce', '1111111111111111111111111', 'enforce_nonce', true,
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  jsonb_build_object(
    'content', 'test',
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  now() - interval '2 hours'
);

SELECT is(
  (SELECT count(*)::integer FROM public.spinner_discord_outbox WHERE draw_id = '11111111-1010-4010-8010-101010101010'),
  0,
  'test mode creates no guild-delivery outbox row'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.spinner_media_jobs WHERE draw_id = '11111111-1010-4010-8010-101010101010')
  AND NOT EXISTS (SELECT 1 FROM public.spinner_raffle_result_publications WHERE source_draw_id = '11111111-1010-4010-8010-101010101010'),
  'test mode creates no media or public-result side effects'
);

UPDATE public.spinner_live_state
SET phase = 'spinning', draw_id = '11111111-1010-4010-8010-101010101010',
  started_at = now() - interval '1 minute', reveal_at = now() + interval '1 minute',
  duration_ms = 4800, selected_index = 1,
  participants = jsonb_build_array(
    jsonb_build_object('version', 1, 'id', '13131313-1010-4010-8010-101010101010', 'displayName', 'Lotus'),
    jsonb_build_object('version', 1, 'id', '14141414-1010-4010-8010-101010101010', 'displayName', 'Jade Lantern')
  ),
  roster_hash_sha256 = repeat('1', 64),
  start_rotation = 0, final_rotation = 540,
  winner = jsonb_build_object('version', 1, 'id', '14141414-1010-4010-8010-101010101010', 'displayName', 'Jade Lantern')
WHERE singleton_id = 1;
SELECT is(
  (SELECT draw_mode FROM public.spinner_live_state WHERE singleton_id = 1),
  'test',
  'the shared viewer snapshot derives its test label from the durable receipt'
);
UPDATE public.spinner_live_state
SET phase = 'idle', draw_id = null, started_at = null, reveal_at = null,
  duration_ms = 0, selected_index = null, winner = null
WHERE singleton_id = 1;

INSERT INTO public.spinner_commands (
  command_id, action, actor_id, expected_revision, request_hash_sha256, status,
  staged_payload, completed_at
) VALUES (
  '20202020-2020-4020-8020-202020202020', 'spin',
  '91919191-9191-4919-8919-919191919191', 0, repeat('2', 64), 'applied', '{}'::jsonb, now()
);
INSERT INTO public.spinner_draw_receipts (
  draw_id, command_id, session_id, revision, actor_id, timestamp_iso,
  singapore_time, app_version, algorithm_version, roster_snapshot,
  roster_hash_sha256, rejection_limit, sampled_words, accepted_word,
  selected_index, winner, receipt
) VALUES (
  '21212121-2020-4020-8020-202020202020',
  '20202020-2020-4020-8020-202020202020',
  '22222222-2020-4020-8020-202020202020', 2,
  '91919191-9191-4919-8919-919191919191', '2026-06-27 15:29:29.763+00'::timestamptz,
  'Official draw', '1.0.0', 'uniform-uint32-rejection-v1',
  jsonb_build_object('version', 1, 'participants', jsonb_build_array(
    jsonb_build_object('version', 1, 'id', '23232323-2020-4020-8020-202020202020', 'displayName', 'Lotus'),
    jsonb_build_object('version', 1, 'id', '24242424-2020-4020-8020-202020202020', 'displayName', 'J')
  )),
  repeat('2', 64), 4294967296, jsonb_build_array(1), 1, 1,
  jsonb_build_object('version', 1, 'id', '24242424-2020-4020-8020-202020202020', 'displayName', 'J'),
  jsonb_build_object(
    'version', 1, 'drawMode', 'official',
    'drawId', '21212121-2020-4020-8020-202020202020',
    'winner', jsonb_build_object('version', 1, 'id', '24242424-2020-4020-8020-202020202020', 'displayName', 'J')
  )
);
INSERT INTO public.spinner_discord_outbox (
  draw_id, channel_key, channel_id, start_payload, result_payload, reveal_after
) VALUES (
  '21212121-2020-4020-8020-202020202020', 'raffle_spins', '1468667003366674721',
  jsonb_build_object(
    'content', 'official', 'nonce', '2121212120202020202020202', 'enforce_nonce', true,
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  jsonb_build_object(
    'content', 'official',
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  '2026-06-27 15:32:34.563+00'::timestamptz
);

UPDATE pg_temp.spinner_dispatch_probe SET call_count = 0;
INSERT INTO public.spinner_discord_outbox (
  draw_id, channel_key, channel_id, start_payload, result_payload, reveal_after
) VALUES (
  '11111111-1010-4010-8010-101010101010', 'raffle_spins', '1468667003366674721',
  jsonb_build_object(
    'content', 'test', 'nonce', '1111111111111111111111111', 'enforce_nonce', true,
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  jsonb_build_object(
    'content', 'test',
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  now() - interval '2 hours'
);

SELECT is(
  (SELECT call_count FROM pg_temp.spinner_dispatch_probe),
  0,
  'a test spin cannot wake delivery for a pre-existing ready official row'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.spinner_raffle_result_publications
    WHERE source_draw_id = '21212121-2020-4020-8020-202020202020'
      AND source_mode = 'official' AND published_at = reveal_at
  ),
  'an official draw reserves one Singapore monthly result at its authoritative reveal time'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_latest_official_raffle_winner()),
  1,
  'a revealed official result is public independently of external guild delivery'
);

UPDATE public.spinner_discord_outbox
SET phase = 'completed', completed_at = now(), updated_at = now()
WHERE draw_id = '21212121-2020-4020-8020-202020202020';

SELECT ok(
  (SELECT publication.published_at = publication.reveal_at
     AND outbox.phase = 'completed'
   FROM public.spinner_raffle_result_publications publication
   JOIN public.spinner_discord_outbox outbox ON outbox.draw_id = publication.source_draw_id
   WHERE publication.source_draw_id = '21212121-2020-4020-8020-202020202020'),
  'guild delivery completion does not rewrite the immutable official result'
);
SELECT is(
  (SELECT public_label FROM public.get_latest_official_raffle_winner()),
  'Winner Confirmed',
  'the public result uses the exact privacy-safe label'
);
SELECT is(
  (SELECT display_name FROM public.get_latest_official_raffle_winner()),
  NULL,
  'an anonymous viewer receives no guild display name'
);

SELECT set_config('request.jwt.claim.sub', '91919191-9191-4919-8919-919191919191', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT display_name FROM public.get_latest_official_raffle_winner()),
  'J',
  'a current verified guild member receives a one-character stored guild display name'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);

SELECT is(
  (SELECT proc.proargnames
   FROM pg_proc proc
   JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
   WHERE namespace.nspname = 'public'
     AND proc.proname = 'get_latest_official_raffle_winner'
     AND proc.pronargs = 0),
  ARRAY['public_label', 'cycle_month', 'selected_at', 'display_name']::text[],
  'the RPC contract exposes no draw ID, member ID, receipt, roster, or hash'
);

INSERT INTO public.spinner_commands (
  command_id, action, actor_id, expected_revision, request_hash_sha256, status,
  staged_payload, completed_at
) VALUES (
  '30303030-3030-4030-8030-303030303030', 'spin',
  '91919191-9191-4919-8919-919191919191', 0, repeat('3', 64), 'applied', '{}'::jsonb, now()
);
INSERT INTO public.spinner_draw_receipts (
  draw_id, command_id, session_id, revision, actor_id, timestamp_iso,
  singapore_time, app_version, algorithm_version, roster_snapshot,
  roster_hash_sha256, rejection_limit, sampled_words, accepted_word,
  selected_index, winner, receipt
) SELECT
  '31313131-3030-4030-8030-303030303030',
  '30303030-3030-4030-8030-303030303030',
  '32323232-3030-4030-8030-303030303030', 3,
  actor_id, timestamp_iso + interval '1 minute', singapore_time,
  app_version, algorithm_version, roster_snapshot, repeat('3', 64),
  rejection_limit, sampled_words, accepted_word, selected_index, winner,
  jsonb_set(receipt, '{drawId}', to_jsonb('31313131-3030-4030-8030-303030303030'::text))
FROM public.spinner_draw_receipts WHERE draw_id = '21212121-2020-4020-8020-202020202020';

SELECT throws_ok(
  $$
    INSERT INTO public.spinner_discord_outbox (
      draw_id, channel_key, channel_id, start_payload, result_payload, reveal_after
    ) SELECT
      '31313131-3030-4030-8030-303030303030', channel_key, channel_id,
      jsonb_set(start_payload, '{nonce}', '"3131313130303030303030303"'::jsonb),
      result_payload, reveal_after
    FROM public.spinner_discord_outbox
    WHERE draw_id = '21212121-2020-4020-8020-202020202020'
  $$,
  '23514',
  'This Singapore raffle month already has an official result.',
  'a second official result in the same Singapore month fails closed'
);

SELECT throws_ok(
  $$
    INSERT INTO public.spinner_raffle_result_publications (
      source_draw_id, cycle_month, source_mode, approved_by
    ) VALUES (
      '11111111-1010-4010-8010-101010101010',
      date_trunc('month', (now() - interval '3 hours') at time zone 'Asia/Singapore')::date,
      'official', '91919191-9191-4919-8919-919191919191'
    )
  $$,
  '23514',
  'Test draws cannot become official raffle results.',
  'a test receipt cannot be promoted through a direct insert'
);

SELECT throws_ok(
  $$
    UPDATE public.spinner_raffle_result_publications
    SET winner_display_name = 'Changed'
    WHERE source_draw_id = '21212121-2020-4020-8020-202020202020'
  $$,
  '55000',
  'Official raffle publication records are immutable.',
  'the selected public result cannot be rewritten'
);

INSERT INTO public.spinner_raffle_result_revocations (
  source_draw_id, reason_code, revoked_by
) VALUES (
  '21212121-2020-4020-8020-202020202020', 'reviewed_suppression',
  '91919191-9191-4919-8919-919191919191'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_latest_official_raffle_winner()),
  0,
  'an append-only reviewed revocation suppresses the result'
);
SELECT throws_ok(
  $$
    DELETE FROM public.spinner_raffle_result_revocations
    WHERE source_draw_id = '21212121-2020-4020-8020-202020202020'
  $$,
  '55000',
  'Official raffle publication records are immutable.',
  'a revocation cannot be erased'
);

INSERT INTO public.spinner_commands (
  command_id, action, actor_id, expected_revision, request_hash_sha256, status,
  staged_payload, completed_at
) VALUES (
  '40404040-4040-4040-8040-404040404040', 'spin',
  '91919191-9191-4919-8919-919191919191', 0, repeat('4', 64), 'applied', '{}'::jsonb,
  '2026-07-27 15:29:29.763+00'::timestamptz
);

ALTER TABLE public.spinner_draw_receipts DISABLE TRIGGER spinner_draw_receipts_set_draw_mode;
INSERT INTO public.spinner_draw_receipts (
  draw_id, command_id, session_id, revision, actor_id, timestamp_iso,
  singapore_time, app_version, algorithm_version, roster_snapshot,
  roster_hash_sha256, rejection_limit, sampled_words, accepted_word,
  selected_index, winner, receipt, created_at, expires_at
) VALUES (
  '41414141-4040-4040-8040-404040404040',
  '40404040-4040-4040-8040-404040404040',
  '42424242-4040-4040-8040-404040404040', 4,
  '91919191-9191-4919-8919-919191919191',
  '2026-07-27 15:29:29.763+00'::timestamptz,
  '27 Jul 2026, 23:29:29 SGT', '1.0.0', 'uniform-uint32-rejection-v1',
  jsonb_build_object('version', 1, 'participants', jsonb_build_array(
    jsonb_build_object('version', 1, 'id', '43434343-4040-4040-8040-404040404040', 'displayName', 'Lotus'),
    jsonb_build_object('version', 1, 'id', '44444444-4040-4040-8040-404040404040', 'displayName', 'Sya')
  )),
  repeat('4', 64), 4294967296, jsonb_build_array(1), 1, 1,
  jsonb_build_object('version', 1, 'id', '44444444-4040-4040-8040-404040404040', 'displayName', 'Sya'),
  jsonb_build_object(
    'version', 1,
    'drawId', '41414141-4040-4040-8040-404040404040',
    'winner', jsonb_build_object('version', 1, 'id', '44444444-4040-4040-8040-404040404040', 'displayName', 'Sya')
  ),
  '2026-07-27 15:29:29.763+00'::timestamptz,
  '2026-09-01 00:00:00+00'::timestamptz
);
ALTER TABLE public.spinner_draw_receipts ENABLE TRIGGER spinner_draw_receipts_set_draw_mode;

ALTER TABLE public.spinner_discord_outbox DISABLE TRIGGER spinner_discord_outbox_prepare_draw_mode;
INSERT INTO public.spinner_discord_outbox (
  draw_id, channel_key, channel_id, phase, start_payload, result_payload,
  reveal_after, created_at, updated_at, completed_at, expires_at
) VALUES (
  '41414141-4040-4040-8040-404040404040', 'raffle_spins', '1468667003366674721', 'completed',
  jsonb_build_object(
    'content', 'Reviewed historical draw', 'nonce', '4141414140404040404040404', 'enforce_nonce', true,
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  jsonb_build_object(
    'content', 'Reviewed historical result',
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
  ),
  '2026-07-27 15:32:34.563+00'::timestamptz,
  '2026-07-27 15:29:29.763+00'::timestamptz,
  '2026-07-27 15:32:39.181748+00'::timestamptz,
  '2026-07-27 15:32:39.181748+00'::timestamptz,
  '2026-09-01 00:00:00+00'::timestamptz
);
ALTER TABLE public.spinner_discord_outbox ENABLE TRIGGER spinner_discord_outbox_prepare_draw_mode;

SELECT is(
  (SELECT count(*)::integer
   FROM public.spinner_draw_receipts receipt
   JOIN public.spinner_discord_outbox outbox ON outbox.draw_id = receipt.draw_id
   WHERE receipt.draw_mode = 'unclassified'
     AND outbox.draw_mode = 'unclassified'
     AND outbox.channel_key = 'raffle_spins'
     AND outbox.phase = 'completed'
     AND receipt.actor_id is not null
     AND receipt.timestamp_iso = '2026-07-27 15:29:29.763+00'::timestamptz
     AND outbox.reveal_after = '2026-07-27 15:32:34.563+00'::timestamptz
     AND outbox.completed_at = '2026-07-27 15:32:39.181748+00'::timestamptz
     AND receipt.winner ->> 'displayName' = 'Sya'),
  1,
  'the reviewed historical evidence resolves to exactly one authoritative receipt'
);
INSERT INTO public.spinner_raffle_result_publications (
  source_draw_id, cycle_month, source_mode, approved_by
)
SELECT
  receipt.draw_id,
  date_trunc('month', receipt.timestamp_iso at time zone 'Asia/Singapore')::date,
  'legacy-reviewed',
  receipt.actor_id
FROM public.spinner_draw_receipts receipt
JOIN public.spinner_discord_outbox outbox ON outbox.draw_id = receipt.draw_id
WHERE receipt.draw_mode = 'unclassified'
  AND outbox.draw_mode = 'unclassified'
  AND outbox.channel_key = 'raffle_spins'
  AND outbox.phase = 'completed'
  AND receipt.actor_id is not null
  AND receipt.timestamp_iso = '2026-07-27 15:29:29.763+00'::timestamptz
  AND outbox.reveal_after = '2026-07-27 15:32:34.563+00'::timestamptz
  AND outbox.completed_at = '2026-07-27 15:32:39.181748+00'::timestamptz
  AND receipt.winner ->> 'displayName' = 'Sya';
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.spinner_raffle_result_publications
    WHERE source_draw_id = '41414141-4040-4040-8040-404040404040'
      AND cycle_month = '2026-07-01'::date
      AND source_mode = 'legacy-reviewed'
      AND selected_at = '2026-07-27 15:29:29.763+00'::timestamptz
      AND reveal_at = '2026-07-27 15:32:34.563+00'::timestamptz
      AND published_at = '2026-07-27 15:32:39.181748+00'::timestamptz
      AND winner_display_name = 'Sya'
  ),
  'the reviewed backfill derives its draw ID, Singapore month, authority, and publication evidence'
);
SELECT is(
  (SELECT public_label FROM public.get_latest_official_raffle_winner()),
  'Winner Confirmed',
  'the reviewed winner is the latest public result with the generic label'
);
SELECT is(
  (SELECT display_name FROM public.get_latest_official_raffle_winner()),
  NULL,
  'the reviewed winner name remains hidden from signed-out visitors'
);
SELECT set_config('request.jwt.claim.sub', '91919191-9191-4919-8919-919191919191', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT display_name FROM public.get_latest_official_raffle_winner()),
  'Sya',
  'a verified guild member receives the reviewed winner display name'
);
RESET ROLE;

SELECT public.spinner_reserve_command(
  '50505050-5050-4050-8050-505050505050',
  'set_roster',
  '91919191-9191-4919-8919-919191919191',
  0,
  repeat('5', 64)
);
SELECT public.spinner_stage_command(
  '50505050-5050-4050-8050-505050505050',
  jsonb_build_object(
    'participants', jsonb_build_array(
      jsonb_build_object('version', 1, 'id', '53535353-5050-4050-8050-505050505051', 'displayName', 'Lotus'),
      jsonb_build_object('version', 1, 'id', '53535353-5050-4050-8050-505050505052', 'displayName', 'Jade Lantern'),
      jsonb_build_object('version', 1, 'id', '53535353-5050-4050-8050-505050505053', 'displayName', 'Moon')
    ),
    'rosterHashSha256', 'eae909f14328dc6599a66f7fd445ce5b6884c29570887dfb151776fe176a4e57'
  )
);
SELECT public.spinner_apply_command('50505050-5050-4050-8050-505050505050');

SELECT public.spinner_reserve_command(
  '51515151-5050-4050-8050-505050505050',
  'spin',
  '91919191-9191-4919-8919-919191919191',
  1,
  repeat('6', 64)
);
WITH fixture AS (
  SELECT
    jsonb_build_array(
      jsonb_build_object('version', 1, 'id', '53535353-5050-4050-8050-505050505051', 'displayName', 'Lotus'),
      jsonb_build_object('version', 1, 'id', '53535353-5050-4050-8050-505050505052', 'displayName', 'Jade Lantern'),
      jsonb_build_object('version', 1, 'id', '53535353-5050-4050-8050-505050505053', 'displayName', 'Moon')
    ) AS participants,
    jsonb_build_array(
      jsonb_build_object(
        'roundIndex', 0,
        'activeCount', 3,
        'selectedIndex', 1,
        'eliminatedId', '53535353-5050-4050-8050-505050505052',
        'eliminatedParticipant', jsonb_build_object(
          'version', 1,
          'id', '53535353-5050-4050-8050-505050505052',
          'displayName', 'Jade Lantern'
        ),
        'rejectionLimit', 4294967295,
        'sampledWords', jsonb_build_array(4),
        'acceptedWord', 4,
        'startedAt', '2026-08-31T02:01:00.000Z',
        'revealAt', '2026-08-31T02:01:05.000Z',
        'startRotation', 0,
        'finalRotation', 2400
      ),
      jsonb_build_object(
        'roundIndex', 1,
        'activeCount', 2,
        'selectedIndex', 1,
        'eliminatedId', '53535353-5050-4050-8050-505050505053',
        'eliminatedParticipant', jsonb_build_object(
          'version', 1,
          'id', '53535353-5050-4050-8050-505050505053',
          'displayName', 'Moon'
        ),
        'rejectionLimit', 4294967296,
        'sampledWords', jsonb_build_array(1),
        'acceptedWord', 1,
        'startedAt', '2026-08-31T02:01:05.000Z',
        'revealAt', '2026-08-31T02:01:10.000Z',
        'startRotation', 240,
        'finalRotation', 2700
      )
    ) AS rounds
), receipt AS (
  SELECT
    rounds,
    jsonb_build_object(
      'version', 2,
      'drawMode', 'official',
      'drawId', '54545454-5050-4050-8050-505050505050',
      'timestampIso', '2026-08-31T02:00:00.000Z',
      'singaporeTime', '31 Aug 2026, 10:00:00 SGT',
      'appVersion', '2.0.0',
      'algorithmVersion', 'uniform-elimination-uint32-rejection-v2',
      'rosterSnapshot', jsonb_build_object('version', 1, 'participants', participants),
      'rosterHashSha256', 'eae909f14328dc6599a66f7fd445ce5b6884c29570887dfb151776fe176a4e57',
      'planHashSha256', '21d538f460780456f54fa098e52aae689e212521fe03ec55c20bd8822f25bb20',
      'durationMs', 5000,
      'startAt', '2026-08-31T02:01:00.000Z',
      'revealAt', '2026-08-31T02:01:10.000Z',
      'startRotation', 0,
      'finalRotation', 2160,
      'rounds', rounds,
      'selectedIndex', 0,
      'winner', participants -> 0
    ) AS value
  FROM fixture
)
SELECT public.spinner_stage_command(
  '51515151-5050-4050-8050-505050505050',
  jsonb_build_object(
    'version', 2,
    'receipt', value,
    'planHashSha256', '21d538f460780456f54fa098e52aae689e212521fe03ec55c20bd8822f25bb20',
    'rounds', rounds,
    'startAt', '2026-08-31T02:01:00.000Z',
    'revealAt', '2026-08-31T02:01:10.000Z',
    'durationMs', 5000,
    'startRotation', 0,
    'finalRotation', 2160,
    'animationManifest', jsonb_build_object(
      'version', 1,
      'styleVersion', 'mochirii-raffle-film-v1',
      'width', 1280,
      'height', 720,
      'durationMs', 10600,
      'drawId', '54545454-5050-4050-8050-505050505050',
      'startAt', '2026-08-31T02:01:00.000Z',
      'revealAt', '2026-08-31T02:01:10.000Z',
      'startRotation', 0,
      'finalRotation', 2160,
      'rosterHashSha256', 'eae909f14328dc6599a66f7fd445ce5b6884c29570887dfb151776fe176a4e57',
      'participants', jsonb_build_array(
        jsonb_build_object('version', 1, 'number', 1, 'label', '1. Lotus'),
        jsonb_build_object('version', 1, 'number', 2, 'label', '2. Jade Lantern'),
        jsonb_build_object('version', 1, 'number', 3, 'label', '3. Moon')
      ),
      'selectedIndex', 0,
      'winner', jsonb_build_object(
        'version', 1,
        'number', 1,
        'displayName', 'Lotus'
      ),
      'visualSeedSha256', '5d44e5cc3ddcb7be75ceb04922eefac352ab9e7804b762a94284a091abf9f95f'
    ),
    'animationManifestHashSha256', '2164b43d3c7173ca80d3fd7661057052110ec9f32a9c2dae08d2f78d68fff12c',
    'discordChannelKey', 'raffle_spins',
    'discordChannelId', '1468667003366674721',
    'discordStartPayload', jsonb_build_object(
      'content', 'Mōchirīī official elimination sequence',
      'nonce', '5454545450505050505050505',
      'enforce_nonce', true,
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
    ),
    'discordResultPayload', jsonb_build_object(
      'content', 'Mōchirīī official survivor confirmed.',
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', '[]'::jsonb, 'roles', '[]'::jsonb, 'replied_user', false)
    )
  )
)
FROM receipt;
SELECT public.spinner_apply_command('51515151-5050-4050-8050-505050505050');

SELECT ok(
  (SELECT status = 'applied' FROM public.spinner_commands
    WHERE command_id = '51515151-5050-4050-8050-505050505050')
  AND (SELECT algorithm_version = 'uniform-elimination-uint32-rejection-v2'
      AND selected_index = 0
      AND winner ->> 'displayName' = 'Lotus'
      AND rejection_limit is null AND sampled_words is null AND accepted_word is null
      AND jsonb_array_length(elimination_plan) = 2
      AND elimination_plan -> 0 ->> 'eliminatedId' = '53535353-5050-4050-8050-505050505052'
      AND elimination_plan -> 1 ->> 'eliminatedId' = '53535353-5050-4050-8050-505050505053'
      AND plan_hash_sha256 = '21d538f460780456f54fa098e52aae689e212521fe03ec55c20bd8822f25bb20'
    FROM public.spinner_draw_receipts
    WHERE draw_id = '54545454-5050-4050-8050-505050505050')
  AND (SELECT duration_ms = 5000
      AND started_at = '2026-08-31T02:01:00.000Z'::timestamptz
      AND reveal_at = '2026-08-31T02:01:10.000Z'::timestamptz
      AND winner ->> 'displayName' = 'Lotus'
    FROM public.spinner_live_state WHERE singleton_id = 1),
  'the actual official v2 apply eliminates two entrants in contiguous five-second rounds and retains one survivor'
);
SELECT ok(
  (SELECT source_mode = 'official'
      AND cycle_month = '2026-08-01'::date
      AND selected_at = '2026-08-31T02:00:00.000Z'::timestamptz
      AND reveal_at = '2026-08-31T02:01:10.000Z'::timestamptz
      AND published_at = reveal_at
      AND winner_display_name = 'Lotus'
    FROM public.spinner_raffle_result_publications
    WHERE source_draw_id = '54545454-5050-4050-8050-505050505050')
  AND (SELECT reveal_after = '2026-08-31T02:01:10.000Z'::timestamptz
      AND result_payload ->> 'content' = 'Mōchirīī official survivor confirmed.'
    FROM public.spinner_discord_outbox
    WHERE draw_id = '54545454-5050-4050-8050-505050505050'),
  'official publication and delivery bind only the final survivor after the last round'
);

SELECT * FROM finish();
ROLLBACK;
