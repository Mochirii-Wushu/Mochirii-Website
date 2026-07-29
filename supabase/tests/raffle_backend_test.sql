begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(99);

-- Every prize-draw relation is service-owned. Browser and authenticated JWT
-- roles must use the narrow Edge Function contracts instead of direct SQL.
select ok(
  (
    select count(*) = 10 and bool_and(classes.relrowsecurity)
    from unnest(array[
      'raffle_cycles',
      'raffle_entries',
      'raffle_bonus_awards',
      'raffle_draws',
      'raffle_draw_results',
      'raffle_audit_events',
      'raffle_provider_configs',
      'raffle_fulfillment_jobs',
      'raffle_provider_events',
      'raffle_rule_snapshots'
    ]) as expected(name)
    join pg_class classes on classes.oid = to_regclass('public.' || expected.name)
  ),
  'all raffle tables exist with RLS enabled'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as roles(name)
    cross join unnest(array[
      'raffle_cycles',
      'raffle_entries',
      'raffle_bonus_awards',
      'raffle_draws',
      'raffle_draw_results',
      'raffle_audit_events',
      'raffle_provider_configs',
      'raffle_fulfillment_jobs',
      'raffle_provider_events',
      'raffle_rule_snapshots'
    ]) as relations(name)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privileges(name)
    where has_table_privilege(
      roles.name,
      'public.' || relations.name,
      privileges.name
    )
  ),
  'anon and authenticated have no raffle table privileges'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'raffle_cycles',
      'raffle_entries',
      'raffle_bonus_awards',
      'raffle_draws',
      'raffle_draw_results',
      'raffle_audit_events',
      'raffle_provider_configs',
      'raffle_fulfillment_jobs',
      'raffle_provider_events'
    ]) as relations(name)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privileges(name)
    where not has_table_privilege(
      'service_role',
      'public.' || relations.name,
      privileges.name
    )
  ),
  'service_role retains required raffle table privileges'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as roles(name)
    cross join unnest(array[
      'public.open_raffle_cycle(uuid,uuid,timestamptz)',
      'public.review_raffle_entry_eligibility(uuid,uuid,text,text,uuid,timestamptz)',
      'public.manage_raffle_bonus_award(uuid,uuid,text,text,text,boolean,text,uuid,timestamptz)',
      'public.submit_raffle_bonus_alternative(uuid,uuid,uuid,text,text,timestamptz)',
      'public.manage_raffle_member_entry(uuid,uuid,uuid,text,text,boolean,boolean,timestamptz)',
      'public.freeze_raffle_ledger(uuid,uuid,text,timestamptz)',
      'public.record_raffle_ledger_hash(uuid,text,uuid,timestamptz)',
      'public.complete_raffle_draw(uuid,text,text,text,text,jsonb,uuid,timestamptz)',
      'public.record_raffle_private_notice(uuid,uuid,uuid,timestamptz)',
      'public.claim_raffle_draw_result(uuid,uuid,text)',
      'public.review_raffle_claim_tax(uuid,text,uuid,timestamptz)',
      'public.review_raffle_claim_clearance(uuid,text,uuid,timestamptz)',
      'public.complete_raffle_manual_in_game(uuid,integer,uuid,timestamptz)',
      'public.release_raffle_digital_fulfillment(uuid,text,text[],uuid,timestamptz)',
      'public.claim_raffle_fulfillment_jobs(text,integer,integer)',
      'public.decline_raffle_draw_result(uuid,uuid)',
      'public.complete_raffle_fulfillment_job(uuid,text,text,text,text,text,text,timestamptz)',
      'public.unlock_raffle_reward_link(uuid,integer,uuid,timestamptz)',
      'public.reserve_raffle_reward_link(uuid,uuid,timestamptz)',
      'public.claim_raffle_provider_events(text,integer,integer)',
      'public.complete_raffle_provider_event(uuid,text,text,text,timestamptz)',
      'public.apply_raffle_provider_reward_state(uuid,text,text,text,text)',
      'public.consume_raffle_leaderboard_nonce(uuid,text,timestamptz)',
      'public.get_current_raffle_leaderboard(uuid)',
      'public.archive_raffle_rules_snapshot(text,jsonb,text,uuid,timestamptz)',
      'public.advance_raffle_claim_schedule(uuid,timestamptz)'
    ]) as routines(signature)
    where has_function_privilege(roles.name, routines.signature, 'EXECUTE')
  ),
  'anon and authenticated cannot execute any of the 26 service RPCs'
);

select ok(
  not exists (
    select 1
    from pg_proc routine
    cross join lateral aclexplode(
      coalesce(routine.proacl, acldefault('f', routine.proowner))
    ) privilege
    where routine.oid in (
      select to_regprocedure(signature)::oid
      from unnest(array[
        'public.open_raffle_cycle(uuid,uuid,timestamptz)',
        'public.review_raffle_entry_eligibility(uuid,uuid,text,text,uuid,timestamptz)',
        'public.manage_raffle_bonus_award(uuid,uuid,text,text,text,boolean,text,uuid,timestamptz)',
        'public.submit_raffle_bonus_alternative(uuid,uuid,uuid,text,text,timestamptz)',
        'public.manage_raffle_member_entry(uuid,uuid,uuid,text,text,boolean,boolean,timestamptz)',
        'public.freeze_raffle_ledger(uuid,uuid,text,timestamptz)',
        'public.record_raffle_ledger_hash(uuid,text,uuid,timestamptz)',
        'public.complete_raffle_draw(uuid,text,text,text,text,jsonb,uuid,timestamptz)',
        'public.record_raffle_private_notice(uuid,uuid,uuid,timestamptz)',
        'public.claim_raffle_draw_result(uuid,uuid,text)',
        'public.review_raffle_claim_tax(uuid,text,uuid,timestamptz)',
        'public.review_raffle_claim_clearance(uuid,text,uuid,timestamptz)',
        'public.complete_raffle_manual_in_game(uuid,integer,uuid,timestamptz)',
        'public.release_raffle_digital_fulfillment(uuid,text,text[],uuid,timestamptz)',
        'public.claim_raffle_fulfillment_jobs(text,integer,integer)',
        'public.decline_raffle_draw_result(uuid,uuid)',
        'public.complete_raffle_fulfillment_job(uuid,text,text,text,text,text,text,timestamptz)',
        'public.unlock_raffle_reward_link(uuid,integer,uuid,timestamptz)',
        'public.reserve_raffle_reward_link(uuid,uuid,timestamptz)',
        'public.claim_raffle_provider_events(text,integer,integer)',
        'public.complete_raffle_provider_event(uuid,text,text,text,timestamptz)',
        'public.apply_raffle_provider_reward_state(uuid,text,text,text,text)',
        'public.consume_raffle_leaderboard_nonce(uuid,text,timestamptz)',
        'public.get_current_raffle_leaderboard(uuid)',
        'public.archive_raffle_rules_snapshot(text,jsonb,text,uuid,timestamptz)',
        'public.advance_raffle_claim_schedule(uuid,timestamptz)'
      ]) routines(signature)
    )
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no execute ACL on any of the 26 service RPC overloads'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'public.open_raffle_cycle(uuid,uuid,timestamptz)',
      'public.review_raffle_entry_eligibility(uuid,uuid,text,text,uuid,timestamptz)',
      'public.manage_raffle_bonus_award(uuid,uuid,text,text,text,boolean,text,uuid,timestamptz)',
      'public.submit_raffle_bonus_alternative(uuid,uuid,uuid,text,text,timestamptz)',
      'public.manage_raffle_member_entry(uuid,uuid,uuid,text,text,boolean,boolean,timestamptz)',
      'public.freeze_raffle_ledger(uuid,uuid,text,timestamptz)',
      'public.record_raffle_ledger_hash(uuid,text,uuid,timestamptz)',
      'public.complete_raffle_draw(uuid,text,text,text,text,jsonb,uuid,timestamptz)',
      'public.record_raffle_private_notice(uuid,uuid,uuid,timestamptz)',
      'public.claim_raffle_draw_result(uuid,uuid,text)',
      'public.review_raffle_claim_tax(uuid,text,uuid,timestamptz)',
      'public.review_raffle_claim_clearance(uuid,text,uuid,timestamptz)',
      'public.complete_raffle_manual_in_game(uuid,integer,uuid,timestamptz)',
      'public.release_raffle_digital_fulfillment(uuid,text,text[],uuid,timestamptz)',
      'public.claim_raffle_fulfillment_jobs(text,integer,integer)',
      'public.decline_raffle_draw_result(uuid,uuid)',
      'public.complete_raffle_fulfillment_job(uuid,text,text,text,text,text,text,timestamptz)',
      'public.unlock_raffle_reward_link(uuid,integer,uuid,timestamptz)',
      'public.reserve_raffle_reward_link(uuid,uuid,timestamptz)',
      'public.claim_raffle_provider_events(text,integer,integer)',
      'public.complete_raffle_provider_event(uuid,text,text,text,timestamptz)',
      'public.apply_raffle_provider_reward_state(uuid,text,text,text,text)',
      'public.consume_raffle_leaderboard_nonce(uuid,text,timestamptz)',
      'public.get_current_raffle_leaderboard(uuid)',
      'public.archive_raffle_rules_snapshot(text,jsonb,text,uuid,timestamptz)',
      'public.advance_raffle_claim_schedule(uuid,timestamptz)'
    ]) as routines(signature)
    where not has_function_privilege(
      'service_role',
      routines.signature,
      'EXECUTE'
    )
  ),
  'service_role can execute all 26 raffle service RPCs'
);

select ok(
  not has_table_privilege(
    'service_role',
    'private.raffle_leaderboard_nonces',
    'SELECT'
  ),
  'the service role cannot read the private replay ledger directly'
);

select ok(
  has_table_privilege('service_role', 'public.raffle_rule_snapshots', 'SELECT')
    and not has_table_privilege('service_role', 'public.raffle_rule_snapshots', 'INSERT')
    and not has_table_privilege('service_role', 'public.raffle_rule_snapshots', 'UPDATE')
    and not has_table_privilege('service_role', 'public.raffle_rule_snapshots', 'DELETE'),
  'service_role can read archived rules but can write them only through the reviewed RPC'
);

select has_index(
  'public',
  'raffle_cycles',
  'raffle_cycles_rules_snapshot_idx',
  array['rules_version', 'rules_version_url', 'rules_content_hash'],
  'cycle-to-rules snapshot lookups use the covering foreign-key index'
);

select has_index(
  'public',
  'raffle_rule_snapshots',
  'raffle_rule_snapshots_reviewed_by_idx',
  array['reviewed_by'],
  'rules snapshot reviewer references use a covering index'
);

select has_index(
  'public',
  'raffle_fulfillment_jobs',
  'raffle_fulfillment_jobs_result_cycle_idx',
  array['draw_result_id', 'cycle_id'],
  'fulfillment result-cycle references use a covering index'
);

select ok(
  (
    select count(*) = 2 and bool_and(
      minimum_reward_value_cents = 1000
      and maximum_reward_value_cents = 5000
      and reward_currency = 'USD'
      and cycle_cost_ceiling_cents = 5000
      and balance_reserve_cents = 5000
      and balance_ceiling_cents = 10000
    )
    from public.raffle_provider_configs
    where environment in ('sandbox', 'production')
  ),
  'provider defaults bind the $10-$50 prize range and exact cost controls'
);

select throws_like(
  $$update public.raffle_provider_configs
    set minimum_reward_value_cents = 900
    where environment = 'sandbox'$$,
  '%raffle_provider_configs_values_check%',
  'provider minimum cannot drift below $10'
);

select throws_like(
  $$update public.raffle_provider_configs
    set maximum_reward_value_cents = 5100
    where environment = 'sandbox'$$,
  '%raffle_provider_configs_values_check%',
  'provider maximum cannot drift above $50'
);

select throws_like(
  $$update public.raffle_provider_configs
    set reward_currency = 'EUR'
    where environment = 'sandbox'$$,
  '%raffle_provider_configs_values_check%',
  'provider currency cannot drift from USD'
);

select throws_like(
  $$update public.raffle_provider_configs
    set cycle_cost_ceiling_cents = 4999
    where environment = 'sandbox'$$,
  '%raffle_provider_configs_values_check%',
  'provider cycle all-in ceiling is exactly $50'
);

select throws_like(
  $$update public.raffle_provider_configs
    set balance_reserve_cents = 4999
    where environment = 'sandbox'$$,
  '%raffle_provider_configs_values_check%',
  'provider reserve is exactly $50'
);

select throws_like(
  $$update public.raffle_provider_configs
    set balance_ceiling_cents = 9999
    where environment = 'sandbox'$$,
  '%raffle_provider_configs_values_check%',
  'provider balance ceiling is exactly $100'
);

select lives_ok(
  $$insert into public.raffle_cycles (
      id, public_cycle_id, opens_at, closes_at, draw_at, expires_at,
      rules_version, rules_version_url, reward_value_cents,
      cycle_cost_ceiling_cents, sponsor_display_name, public_reward_label
    ) values (
      '10000000-0000-4000-8000-000000000010', 'test-prize-10',
      '2026-06-01 00:00:00+00', '2026-06-27 23:45:00+00',
      '2026-06-28 00:00:00+00', '2026-07-28 00:00:00+00',
      'test-v1', '/raffle#drawing-rules-test-v1', 1000, 5000,
      'Reviewed test sponsor',
      'One $10 digital gift card or eligible in-game gift, plus two Mochirii community honors.'
    )$$,
  'a $10 whole-dollar cycle is valid'
);

select lives_ok(
  $$insert into public.raffle_cycles (
      id, public_cycle_id, opens_at, closes_at, draw_at, expires_at,
      rules_version, rules_version_url, reward_value_cents,
      cycle_cost_ceiling_cents, public_reward_label
    ) values (
      '10000000-0000-4000-8000-000000000025', 'test-prize-25',
      '2026-06-01 00:00:00+00', '2026-07-04 23:45:00+00',
      '2026-07-05 00:00:00+00', '2026-08-04 00:00:00+00',
      'test-v1', '/raffle#drawing-rules-test-v1', 2500, 5000,
      'One $25 digital gift card or eligible in-game gift, plus two Mochirii community honors.'
    )$$,
  'a $25 whole-dollar cycle is valid'
);

select lives_ok(
  $$insert into public.raffle_cycles (
      id, public_cycle_id, opens_at, closes_at, draw_at, expires_at,
      rules_version, rules_version_url, reward_value_cents,
      cycle_cost_ceiling_cents, public_reward_label
    ) values (
      '10000000-0000-4000-8000-000000000050', 'test-prize-50',
      '2026-06-01 00:00:00+00', '2026-07-11 23:45:00+00',
      '2026-07-12 00:00:00+00', '2026-08-11 00:00:00+00',
      'test-v1', '/raffle#drawing-rules-test-v1', 5000, 5000,
      'One $50 digital gift card or eligible in-game gift, plus two Mochirii community honors.'
    )$$,
  'a $50 whole-dollar cycle is valid'
);

select throws_like(
  $$insert into public.raffle_cycles (
      public_cycle_id, opens_at, closes_at, draw_at, expires_at,
      rules_version, rules_version_url, reward_value_cents,
      cycle_cost_ceiling_cents, public_reward_label
    ) values (
      'test-prize-09', '2026-06-01 00:00:00+00',
      '2026-07-18 23:45:00+00', '2026-07-19 00:00:00+00',
      '2026-08-18 00:00:00+00', 'test-v1', '/raffle#drawing-rules-test-v1',
      900, 5000,
      'One $9 digital gift card or eligible in-game gift, plus two Mochirii community honors.'
    )$$,
  '%raffle_cycles_cost_limits_check%',
  'a $9 cycle is rejected'
);

select throws_like(
  $$insert into public.raffle_cycles (
      public_cycle_id, opens_at, closes_at, draw_at, expires_at,
      rules_version, rules_version_url, reward_value_cents,
      cycle_cost_ceiling_cents, public_reward_label
    ) values (
      'test-prize-fraction', '2026-06-01 00:00:00+00',
      '2026-07-18 23:45:00+00', '2026-07-19 00:00:00+00',
      '2026-08-18 00:00:00+00', 'test-v1', '/raffle#drawing-rules-test-v1',
      1050, 5000,
      'One $10.5 digital gift card or eligible in-game gift, plus two Mochirii community honors.'
    )$$,
  '%raffle_cycles_cost_limits_check%',
  'a fractional-dollar cycle is rejected'
);

select throws_like(
  $$insert into public.raffle_cycles (
      public_cycle_id, opens_at, closes_at, draw_at, expires_at,
      rules_version, rules_version_url, reward_value_cents,
      cycle_cost_ceiling_cents, public_reward_label
    ) values (
      'test-prize-51', '2026-06-01 00:00:00+00',
      '2026-07-18 23:45:00+00', '2026-07-19 00:00:00+00',
      '2026-08-18 00:00:00+00', 'test-v1', '/raffle#drawing-rules-test-v1',
      5100, 5000,
      'One $51 digital gift card or eligible in-game gift, plus two Mochirii community honors.'
    )$$,
  '%raffle_cycles_cost_limits_check%',
  'a $51 cycle is rejected'
);

select throws_like(
  $$insert into public.raffle_cycles (
      public_cycle_id, opens_at, closes_at, draw_at, expires_at,
      rules_version, rules_version_url, reward_value_cents,
      cycle_cost_ceiling_cents, public_reward_label
    ) values (
      'test-cost-cap-drift', '2026-06-01 00:00:00+00',
      '2026-07-18 23:45:00+00', '2026-07-19 00:00:00+00',
      '2026-08-18 00:00:00+00', 'test-v1', '/raffle#drawing-rules-test-v1',
      1000, 4999,
      'One $10 digital gift card or eligible in-game gift, plus two Mochirii community honors.'
    )$$,
  '%raffle_cycles_cost_limits_check%',
  'a cycle cannot drift from the exact $50 all-in ceiling'
);

select ok(
  (
    select claim_window_days = 7
      and award_window_days = 30
      and minimum_eligible_entrants = 3
      and base_entries = 1
      and max_bonus_entries = 9
      and max_entries = 10
      and sponsor_display_name = 'Reviewed test sponsor'
      and not sponsor_approved
      and not rules_approved
      and not country_matrix_approved
      and not reward_approved
      and not privacy_approved
      and not tax_approved
      and not operations_approved
    from public.raffle_cycles
    where id = '10000000-0000-4000-8000-000000000010'
  ),
  'new cycles use reviewed timing and entry defaults with every activation gate closed'
);

select lives_ok(
  $$update public.raffle_cycles
    set status = 'blocked'
    where id = '10000000-0000-4000-8000-000000000010'$$,
  'a draft cycle can enter the blocked state'
);

select throws_like(
  $$update public.raffle_cycles
    set reward_value_cents = 2000,
        public_reward_label = 'One $20 digital gift card or eligible in-game gift, plus two Mochirii community honors.'
    where id = '10000000-0000-4000-8000-000000000010'$$,
  '%raffle_cycle_contract_is_immutable%',
  'a non-draft cycle prize contract is immutable'
);

-- A real auth row exercises the existing member-profile trigger and gives the
-- fixture a genuine FK target without bypassing production constraints.
insert into auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '20000000-0000-4000-8000-000000000001',
  'raffle-backend-test@example.invalid', '{}'::jsonb, '{}'::jsonb,
  '2026-07-18 00:00:00+00', '2026-07-18 00:00:00+00'
);

update public.member_profiles
set member_status = 'active',
    has_required_discord_roles = true,
    discord_verified_at = '2026-07-18 00:00:00+00'
where id = '20000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.archive_raffle_rules_snapshot(
      'test-v1',
      '{"title":"Reviewed test rules","sections":[{"heading":"Eligibility","body":"Verified test members only."}]}'::jsonb,
      repeat('a', 40),
      '20000000-0000-4000-8000-000000000001',
      '2026-07-18 00:00:00+00'
    )$$,
  'reviewed official rules are archived through the service boundary'
);

select is(
  (
    public.archive_raffle_rules_snapshot(
      'test-v1',
      '{"title":"Reviewed test rules","sections":[{"heading":"Eligibility","body":"Verified test members only."}]}'::jsonb,
      repeat('a', 40),
      '20000000-0000-4000-8000-000000000001',
      '2026-07-18 00:01:00+00'
    )->>'duplicate'
  )::boolean,
  true,
  'an identical rules archive retry is idempotent'
);

select throws_like(
  $$select public.archive_raffle_rules_snapshot(
      'test-v1',
      '{"title":"Conflicting rules"}'::jsonb,
      repeat('a', 40),
      '20000000-0000-4000-8000-000000000001',
      '2026-07-18 00:02:00+00'
    )$$,
  '%raffle_rules_snapshot_conflict%',
  'an existing rules version cannot be replaced with different content'
);

select throws_like(
  $$update public.raffle_rule_snapshots
    set canonical_rules = '{"title":"Changed"}'::jsonb
    where rules_version = 'test-v1'$$,
  '%raffle_rule_snapshot_is_immutable%',
  'an archived rules snapshot cannot be updated'
);

select throws_like(
  $$delete from public.raffle_rule_snapshots
    where rules_version = 'test-v1'$$,
  '%raffle_rule_snapshot_is_immutable%',
  'an archived rules snapshot cannot be deleted'
);

select throws_like(
  $$insert into public.raffle_cycles (
      public_cycle_id, opens_at, closes_at, draw_at, expires_at,
      rules_version, rules_version_url, rules_content_hash
    ) values (
      'test-unarchived-rules',
      '2026-06-01 00:00:00+00', '2026-07-18 23:45:00+00',
      '2026-07-19 00:00:00+00', '2026-08-18 00:00:00+00',
      'test-v1', '/raffle#drawing-rules-test-v1', repeat('f', 64)
    )$$,
  '%raffle_cycles_rules_snapshot_fk%',
  'a cycle cannot bind an unarchived rules digest'
);

set local role service_role;
select throws_like(
  $$insert into public.raffle_rule_snapshots (
      rules_version, canonical_rules, rules_content_hash, source_commit_sha,
      reviewed_by, reviewed_at
    ) values (
      'bypass-v1', '{"title":"Bypass"}'::jsonb, repeat('d', 64),
      repeat('b', 40), '20000000-0000-4000-8000-000000000001', now()
    )$$,
  '%permission denied for table raffle_rule_snapshots%',
  'service-role table access cannot bypass the rules archive RPC'
);
reset role;

insert into public.raffle_draws (
  id, cycle_id, ledger_salt, entrant_count, total_entry_count
) values
  (
    '30000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000010', repeat('1', 32), 3, 15
  ),
  (
    '30000000-0000-4000-8000-000000000025',
    '10000000-0000-4000-8000-000000000025', repeat('2', 32), 3, 15
  ),
  (
    '30000000-0000-4000-8000-000000000050',
    '10000000-0000-4000-8000-000000000050', repeat('3', 32), 3, 15
  );

insert into public.raffle_draw_results (
  id, draw_id, cycle_id, member_id, result_kind, selection_order,
  entry_ordinal, pseudonymous_member_id
) values
  (
    '40000000-0000-4000-8000-000000000010',
    '30000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000010',
    '20000000-0000-4000-8000-000000000001',
    'paid_winner', 1, 1, repeat('4', 64)
  ),
  (
    '40000000-0000-4000-8000-000000000025',
    '30000000-0000-4000-8000-000000000025',
    '10000000-0000-4000-8000-000000000025',
    '20000000-0000-4000-8000-000000000001',
    'paid_winner', 1, 1, repeat('5', 64)
  ),
  (
    '40000000-0000-4000-8000-000000000050',
    '30000000-0000-4000-8000-000000000050',
    '10000000-0000-4000-8000-000000000050',
    '20000000-0000-4000-8000-000000000001',
    'paid_winner', 1, 1, repeat('6', 64)
  );

select lives_ok(
  $$insert into public.raffle_fulfillment_jobs (
      id, draw_result_id, cycle_id, provider_config_id, provider_configuration_hash,
      campaign_id, external_id, country_code, reward_value_cents,
      reward_currency, all_in_cost_cap_cents, product_ids
    ) values (
      '50000000-0000-4000-8000-000000000025',
      '40000000-0000-4000-8000-000000000025',
      '10000000-0000-4000-8000-000000000025',
      (select id from public.raffle_provider_configs where environment = 'sandbox'),
      repeat('a', 64), 'campaign-v1',
      'mochirii-mpd-40000000-0000-4000-8000-000000000025-v1',
      'US', 2500, 'USD', 5000, array['product-25']::text[]
    )$$,
  'a $25 fulfillment job snapshots the exact $50 all-in ceiling'
);

select is(
  (
    select all_in_cost_cap_cents
    from public.raffle_fulfillment_jobs
    where id = '50000000-0000-4000-8000-000000000025'
  ),
  5000,
  'the fulfillment job persists its exact all-in cap snapshot'
);

select throws_like(
  $$insert into public.raffle_fulfillment_jobs (
      draw_result_id, cycle_id, provider_config_id, provider_configuration_hash,
      campaign_id, external_id, country_code, reward_value_cents,
      all_in_cost_cap_cents, product_ids
    ) values (
      '40000000-0000-4000-8000-000000000010',
      '10000000-0000-4000-8000-000000000010',
      (select id from public.raffle_provider_configs where environment = 'sandbox'),
      repeat('a', 64), 'campaign-v1',
      'mochirii-mpd-40000000-0000-4000-8000-000000000010-v1',
      'US', 900, 5000, array['product-10']::text[]
    )$$,
  '%raffle_fulfillment_jobs_value_check%',
  'a $9 fulfillment job is rejected'
);

select throws_like(
  $$insert into public.raffle_fulfillment_jobs (
      draw_result_id, cycle_id, provider_config_id, provider_configuration_hash,
      campaign_id, external_id, country_code, reward_value_cents,
      all_in_cost_cap_cents, product_ids
    ) values (
      '40000000-0000-4000-8000-000000000010',
      '10000000-0000-4000-8000-000000000010',
      (select id from public.raffle_provider_configs where environment = 'sandbox'),
      repeat('a', 64), 'campaign-v1',
      'mochirii-mpd-40000000-0000-4000-8000-000000000011-v1',
      'US', 1050, 5000, array['product-10']::text[]
    )$$,
  '%raffle_fulfillment_jobs_value_check%',
  'a fractional-dollar fulfillment job is rejected'
);

select throws_like(
  $$insert into public.raffle_fulfillment_jobs (
      draw_result_id, cycle_id, provider_config_id, provider_configuration_hash,
      campaign_id, external_id, country_code, reward_value_cents,
      all_in_cost_cap_cents, product_ids
    ) values (
      '40000000-0000-4000-8000-000000000010',
      '10000000-0000-4000-8000-000000000010',
      (select id from public.raffle_provider_configs where environment = 'sandbox'),
      repeat('a', 64), 'campaign-v1',
      'mochirii-mpd-40000000-0000-4000-8000-000000000012-v1',
      'US', 5100, 5000, array['product-10']::text[]
    )$$,
  '%raffle_fulfillment_jobs_value_check%',
  'a $51 fulfillment job is rejected'
);

select throws_like(
  $$insert into public.raffle_fulfillment_jobs (
      draw_result_id, cycle_id, provider_config_id, provider_configuration_hash,
      campaign_id, external_id, country_code, reward_value_cents,
      all_in_cost_cap_cents, product_ids
    ) values (
      '40000000-0000-4000-8000-000000000010',
      '10000000-0000-4000-8000-000000000010',
      (select id from public.raffle_provider_configs where environment = 'sandbox'),
      repeat('a', 64), 'campaign-v1',
      'mochirii-mpd-40000000-0000-4000-8000-000000000013-v1',
      'US', 1000, 4999, array['product-10']::text[]
    )$$,
  '%raffle_fulfillment_jobs_value_check%',
  'a fulfillment job cannot drift from the exact $50 all-in ceiling'
);

select throws_like(
  $$update public.raffle_fulfillment_jobs
    set reward_value_cents = 2600
    where id = '50000000-0000-4000-8000-000000000025'$$,
  '%raffle_fulfillment_snapshot_is_immutable%',
  'a fulfillment job gross prize snapshot is immutable'
);

select throws_like(
  $$update public.raffle_fulfillment_jobs
    set all_in_cost_cap_cents = 4999
    where id = '50000000-0000-4000-8000-000000000025'$$,
  '%raffle_fulfillment_snapshot_is_immutable%',
  'a fulfillment job all-in cap snapshot is immutable'
);

select throws_like(
  $$update public.raffle_fulfillment_jobs
    set cycle_id = '10000000-0000-4000-8000-000000000010'
    where id = '50000000-0000-4000-8000-000000000025'$$,
  '%raffle_fulfillment_snapshot_is_immutable%',
  'a fulfillment job cycle binding is immutable'
);

-- Manual fulfillment exercises the cross-table prize floor, exact $50 ceiling,
-- auditable final cost, retry idempotency, and immutable completion record.
insert into public.raffle_cycles (
  id, public_cycle_id, status, opens_at, closes_at, draw_at, expires_at,
  rules_version, rules_version_url, rules_content_hash,
  privacy_version, privacy_content_hash,
  country_matrix_version, country_matrix_hash, approved_country_codes,
  reward_value_cents, cycle_cost_ceiling_cents, public_reward_label,
  in_game_reward_enabled, in_game_privacy_reviewed_at,
  in_game_privacy_reviewed_by,
  sponsor_display_name, sponsor_approved, rules_approved,
  country_matrix_approved, reward_approved, privacy_approved,
  tax_approved, operations_approved
) values (
  '10000000-0000-4000-8000-000000000125', 'test-manual-25', 'drawn',
  '2026-06-14 00:00:00+00', '2026-07-18 23:45:00+00',
  '2026-07-19 00:00:00+00', '2026-08-18 00:00:00+00',
  'test-v1', '/raffle#drawing-rules-test-v1',
  (select rules_content_hash from public.raffle_rule_snapshots where rules_version = 'test-v1'),
  'test-v1', repeat('b', 64), 'test-v1', repeat('c', 64), array['US'],
  2500, 5000,
  'One $25 digital gift card or eligible in-game gift, plus two Mochirii community honors.',
  true, '2026-07-18 00:00:00+00',
  '20000000-0000-4000-8000-000000000001',
  'Reviewed test sponsor', true, true, true, true, true, true, true
);

insert into public.raffle_draws (
  id, cycle_id, status, ledger_salt, ledger_hash, seed_hex, seed_hash,
  entrant_count, total_entry_count, frozen_at, drawn_at
) values (
  '30000000-0000-4000-8000-000000000125',
  '10000000-0000-4000-8000-000000000125', 'drawn', repeat('7', 32),
  repeat('d', 64), repeat('e', 64), repeat('f', 64), 3, 15,
  '2026-07-18 23:45:00+00', '2026-07-19 00:00:00+00'
);

insert into public.raffle_draw_results (
  id, draw_id, cycle_id, member_id, result_kind, selection_order,
  entry_ordinal, pseudonymous_member_id, status,
  claim_opened_at, claim_deadline, claimed_at, reward_route,
  tax_status, tax_reviewed_at, tax_reviewed_by, tax_review_reason_code,
  membership_clearance_status, membership_reviewed_at,
  membership_reviewed_by, membership_review_reason_code,
  fraud_clearance_status, fraud_reviewed_at, fraud_reviewed_by,
  fraud_review_reason_code, fulfillment_status
) values (
  '40000000-0000-4000-8000-000000000125',
  '30000000-0000-4000-8000-000000000125',
  '10000000-0000-4000-8000-000000000125',
  '20000000-0000-4000-8000-000000000001',
  'paid_winner', 1, 1, repeat('8', 64), 'claimed',
  '2026-07-19 00:00:00+00', '2026-07-26 00:00:00+00',
  '2026-07-20 00:00:00+00', 'in_game',
  'not_required', '2026-07-20 00:00:00+00',
  '20000000-0000-4000-8000-000000000001', 'tax_not_required',
  'cleared', '2026-07-20 00:00:00+00',
  '20000000-0000-4000-8000-000000000001', 'membership_cleared',
  'cleared', '2026-07-20 00:00:00+00',
  '20000000-0000-4000-8000-000000000001', 'fraud_cleared', 'manual'
);

select throws_like(
  $$select public.complete_raffle_manual_in_game(
      '40000000-0000-4000-8000-000000000125', 2400,
      '20000000-0000-4000-8000-000000000001',
      '2026-07-20 01:00:00+00'
    )$$,
  '%manual_fulfillment_cost_invalid%',
  'manual all-in cost cannot be below the frozen gross prize'
);

select throws_like(
  $$select public.complete_raffle_manual_in_game(
      '40000000-0000-4000-8000-000000000125', 5100,
      '20000000-0000-4000-8000-000000000001',
      '2026-07-20 01:00:00+00'
    )$$,
  '%manual_fulfillment_cost_invalid%',
  'manual all-in cost cannot exceed the exact $50 ceiling'
);

select lives_ok(
  $$select public.complete_raffle_manual_in_game(
      '40000000-0000-4000-8000-000000000125', 3000,
      '20000000-0000-4000-8000-000000000001',
      '2026-07-20 01:00:00+00'
    )$$,
  'manual fulfillment records a valid $30 final all-in cost'
);

select is(
  (
    select manual_all_in_cost_cents
    from public.raffle_draw_results
    where id = '40000000-0000-4000-8000-000000000125'
  ),
  3000,
  'manual fulfillment persists the exact approved final all-in cost'
);

select is(
  (
    public.complete_raffle_manual_in_game(
      '40000000-0000-4000-8000-000000000125', 3000,
      '20000000-0000-4000-8000-000000000001',
      '2026-07-20 01:01:00+00'
    )->>'duplicate'
  )::boolean,
  true,
  'an identical manual fulfillment retry is idempotent'
);

select throws_like(
  $$select public.complete_raffle_manual_in_game(
      '40000000-0000-4000-8000-000000000125', 3100,
      '20000000-0000-4000-8000-000000000001',
      '2026-07-20 01:01:00+00'
    )$$,
  '%manual_fulfillment_cost_conflict%',
  'a manual fulfillment retry with a different cost is an integrity conflict'
);

select throws_like(
  $$update public.raffle_draw_results
    set manual_all_in_cost_cents = 3200
    where id = '40000000-0000-4000-8000-000000000125'$$,
  '%raffle_manual_fulfillment_is_immutable%',
  'a recorded manual all-in cost is immutable'
);

-- Four real members and a fully reviewed open cycle exercise all supported
-- 1/2/4/10 entry counts, frozen-ledger
-- identity, database-controlled seed commitment, and deterministic completion.
insert into auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('20000000-0000-4000-8000-000000000002', 'raffle-backend-test-2@example.invalid', '{}'::jsonb, '{}'::jsonb, '2026-07-18 00:00:00+00', '2026-07-18 00:00:00+00'),
  ('20000000-0000-4000-8000-000000000003', 'raffle-backend-test-3@example.invalid', '{}'::jsonb, '{}'::jsonb, '2026-07-18 00:00:00+00', '2026-07-18 00:00:00+00'),
  ('20000000-0000-4000-8000-000000000004', 'raffle-backend-test-4@example.invalid', '{}'::jsonb, '{}'::jsonb, '2026-07-18 00:00:00+00', '2026-07-18 00:00:00+00');

update public.member_profiles
set member_status = 'active', has_required_discord_roles = true,
    discord_verified_at = '2026-07-18 00:00:00+00'
where id in (
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004'
);

insert into public.raffle_cycles (
  id, public_cycle_id, status, opens_at, closes_at, draw_at, expires_at,
  rules_version, rules_version_url, rules_content_hash,
  privacy_version, privacy_content_hash,
  country_matrix_version, country_matrix_hash, approved_country_codes,
  reward_value_cents, cycle_cost_ceiling_cents, public_reward_label,
  sponsor_display_name, sponsor_approved, rules_approved,
  country_matrix_approved, reward_approved, privacy_approved,
  tax_approved, operations_approved, opened_at
) values (
  '10000000-0000-4000-8000-000000000900', 'test-deterministic-draw', 'open',
  '2026-07-01 00:00:00+00', '2026-07-19 23:45:00+00',
  '2026-07-20 00:00:00+00', '2026-08-19 00:00:00+00',
  'test-v1', '/raffle#drawing-rules-test-v1',
  (select rules_content_hash from public.raffle_rule_snapshots where rules_version = 'test-v1'),
  'test-v1', repeat('2', 64), 'test-v1', repeat('3', 64), array['US'],
  2500, 5000, 'One reviewed test reward.', 'Reviewed test sponsor',
  true, true, true, true, true, true, true, '2026-07-01 00:00:00+00'
);

insert into public.raffle_entries (
  id, cycle_id, member_id, eligibility_status, eligibility_reason_code,
  country_code, age_18_affirmed, rules_accepted_at, base_entry_count,
  eligibility_rules_version, eligibility_country_matrix_version,
  eligibility_member_status, eligibility_guild_verified,
  administrator_clearance_status, administrator_clearance_at,
  administrator_clearance_by, administrator_clearance_reason_code
) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000900', '20000000-0000-4000-8000-000000000001', 'eligible', 'eligible', 'US', true, '2026-07-02 00:00:00+00', 1, 'test-v1', 'test-v1', 'active', true, 'cleared', '2026-07-02 00:00:00+00', '20000000-0000-4000-8000-000000000001', 'administrator_household_cleared'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000900', '20000000-0000-4000-8000-000000000002', 'eligible', 'eligible', 'US', true, '2026-07-02 00:00:00+00', 1, 'test-v1', 'test-v1', 'active', true, 'cleared', '2026-07-02 00:00:00+00', '20000000-0000-4000-8000-000000000001', 'administrator_household_cleared'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000900', '20000000-0000-4000-8000-000000000003', 'eligible', 'eligible', 'US', true, '2026-07-02 00:00:00+00', 1, 'test-v1', 'test-v1', 'active', true, 'cleared', '2026-07-02 00:00:00+00', '20000000-0000-4000-8000-000000000001', 'administrator_household_cleared'),
  ('60000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000900', '20000000-0000-4000-8000-000000000004', 'eligible', 'eligible', 'US', true, '2026-07-02 00:00:00+00', 1, 'test-v1', 'test-v1', 'active', true, 'cleared', '2026-07-02 00:00:00+00', '20000000-0000-4000-8000-000000000001', 'administrator_household_cleared');

insert into public.raffle_bonus_awards (
  id, cycle_id, entry_id, member_id, bonus_key, completion_method,
  source_reference_hash, awarded_by
) values
  ('61000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'scheduled_activity', 'alternative', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'scheduled_activity', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'monthly_gathering', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'help_session', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'scheduled_activity', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'monthly_gathering', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'help_session', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'social_media_share', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'guild_feedback', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'member_welcome', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'member_recruitment', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'creative_hobby_share', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000900', '60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'member_spotlight_nomination', 'primary', repeat('4', 64), '20000000-0000-4000-8000-000000000001');

select lives_ok(
  $$select public.freeze_raffle_ledger(
      '10000000-0000-4000-8000-000000000900',
      '20000000-0000-4000-8000-000000000001', repeat('5', 32),
      '2026-07-20 00:00:00+00'
    )$$,
  'the reviewed four-member one-plus-nine ledger freezes once'
);

select is(
  (
    select array_agg(frozen_entry_count order by member_id)
    from public.raffle_entries
    where cycle_id = '10000000-0000-4000-8000-000000000900'
      and eligibility_status = 'frozen'
  ),
  array[1, 2, 4, 10]::smallint[],
  'the database freezes the exact one-standard plus nine-bonus entry range'
);

insert into public.raffle_cycles (
  id, public_cycle_id, opens_at, closes_at, draw_at, expires_at,
  rules_version, rules_version_url, reward_value_cents,
  cycle_cost_ceiling_cents, public_reward_label
) values (
  '10000000-0000-4000-8000-000000000901', 'test-reparent-target',
  '2026-08-01 00:00:00+00', '2026-08-30 23:45:00+00',
  '2026-08-31 00:00:00+00', '2026-09-30 00:00:00+00',
  'test-v1', '/raffle#drawing-rules-test-v1', 2500, 5000,
  'One reviewed test reward.'
);

select throws_like(
  $$update public.raffle_entries
    set cycle_id = '10000000-0000-4000-8000-000000000901'
    where id = '60000000-0000-4000-8000-000000000001'$$,
  '%raffle_frozen_ledger_is_immutable%',
  'a frozen entry cannot be reparented into a draft cycle'
);

select throws_like(
  $$update public.raffle_bonus_awards
    set cycle_id = '10000000-0000-4000-8000-000000000901'
    where id = '61000000-0000-4000-8000-000000000001'$$,
  '%raffle_frozen_ledger_is_immutable%',
  'a frozen bonus cannot be reparented into a draft cycle'
);

insert into public.raffle_entries (
  id, cycle_id, member_id, eligibility_status, eligibility_reason_code
) values (
  '60000000-0000-4000-8000-000000000901',
  '10000000-0000-4000-8000-000000000901',
  '20000000-0000-4000-8000-000000000001', 'pending', 'not_checked'
);

select throws_like(
  $$update public.raffle_entries
    set member_id = '20000000-0000-4000-8000-000000000002'
    where id = '60000000-0000-4000-8000-000000000901'$$,
  '%raffle_ledger_identity_is_immutable%',
  'entry identity columns remain immutable before freeze'
);

create temporary table raffle_test_draw_evidence (
  draw_id uuid primary key,
  ledger_hash text not null,
  seed_hex text,
  seed_hash text,
  canonical_results jsonb
) on commit drop;

with draw as (
  select * from public.raffle_draws
  where cycle_id = '10000000-0000-4000-8000-000000000900'
), canonical as (
  select entry.frozen_entry_count as entry_count,
    encode(extensions.digest(draw.ledger_salt || ':' || entry.member_id::text, 'sha256'), 'hex') as pseudonym
  from draw join public.raffle_entries entry on entry.cycle_id = draw.cycle_id
  where entry.eligibility_status = 'frozen'
), ranged as (
  select entry_count, pseudonym,
    1 + coalesce(sum(entry_count) over (order by pseudonym collate "C" rows between unbounded preceding and 1 preceding), 0) as first_ordinal,
    sum(entry_count) over (order by pseudonym collate "C") as last_ordinal
  from canonical
), canonical_text as (
  select '[' || string_agg(
    '{"pseudonymousMemberId":"' || pseudonym || '","entryCount":' || entry_count::text
      || ',"firstOrdinal":' || first_ordinal::text || ',"lastOrdinal":' || last_ordinal::text || '}',
    ',' order by pseudonym collate "C"
  ) || ']' as value
  from ranged
)
insert into raffle_test_draw_evidence (draw_id, ledger_hash)
select draw.id, encode(extensions.digest(canonical_text.value, 'sha256'), 'hex')
from draw cross join canonical_text;

select is(
  (select ledger_hash from raffle_test_draw_evidence),
  '59d35f30f662fbafc8dd1ad30fb23834002ba31de3e51a74f4aa8ecda1982b1a',
  'the database ledger digest matches the shared JavaScript vector'
);

select is(
  (
    select private.canonical_raffle_draw_results(draw_id, repeat('6', 64))
    from raffle_test_draw_evidence
  ),
  '[
    {
      "memberId":"20000000-0000-4000-8000-000000000003",
      "pseudonymousMemberId":"58f585c7bd041dba45605d4a29bf6ecc1daf9a21377dd6237442ba1eb154f17c",
      "entryOrdinal":11,
      "selectionOrder":1,
      "kind":"paid_winner",
      "alternateRank":null
    },
    {
      "memberId":"20000000-0000-4000-8000-000000000004",
      "pseudonymousMemberId":"4642d2941ef6adacf9ce914c0b6d77f0a2d82604fa690ec1c20645491949f4fd",
      "entryOrdinal":6,
      "selectionOrder":2,
      "kind":"honor",
      "alternateRank":null
    },
    {
      "memberId":"20000000-0000-4000-8000-000000000002",
      "pseudonymousMemberId":"9ef80648f10316335e97608b27b46d395c87cb5a92c2bee888710e72a2203e29",
      "entryOrdinal":16,
      "selectionOrder":3,
      "kind":"honor",
      "alternateRank":null
    },
    {
      "memberId":"20000000-0000-4000-8000-000000000001",
      "pseudonymousMemberId":"a2f9b4b93835c09bba6d906a802b4c5aa46c2b2d656e63888880580ec712320a",
      "entryOrdinal":17,
      "selectionOrder":4,
      "kind":"alternate",
      "alternateRank":1
    }
  ]'::jsonb,
  'the database weighted draw matches the shared JavaScript seed vector'
);

select throws_like(
  $$select public.complete_raffle_draw(
      draw_id,
      ledger_hash,
      repeat('d', 64),
      encode(extensions.digest(repeat('d', 64), 'sha256'), 'hex'),
      'mochirii-weighted-without-replacement-v1',
      '[]'::jsonb,
      '20000000-0000-4000-8000-000000000001',
      '2026-07-20 00:00:00+00'
    ) from raffle_test_draw_evidence$$,
  '%raffle_ledger_hash_not_committed%',
  'draw completion fails promptly before a seed is committed'
);

select throws_like(
  $$select public.record_raffle_ledger_hash(
      (select draw_id from raffle_test_draw_evidence), repeat('0', 64),
      '20000000-0000-4000-8000-000000000001', '2026-07-20 00:00:00+00'
    )$$,
  '%raffle_ledger_hash_mismatch%',
  'the database rejects a noncanonical frozen-ledger hash'
);

with commitment as (
  select evidence.draw_id, public.record_raffle_ledger_hash(
    evidence.draw_id, evidence.ledger_hash,
    '20000000-0000-4000-8000-000000000001', '2026-07-20 00:00:00+00'
  ) as value
  from raffle_test_draw_evidence evidence
)
update raffle_test_draw_evidence evidence
set seed_hex = commitment.value->>'seedHex',
    seed_hash = commitment.value->>'seedHash'
from commitment
where evidence.draw_id = commitment.draw_id;

update raffle_test_draw_evidence
set canonical_results = private.canonical_raffle_draw_results(draw_id, seed_hex);

select throws_like(
  $$select public.complete_raffle_draw(
      draw_id, ledger_hash, seed_hex, seed_hash,
      'mochirii-weighted-without-replacement-v1',
      jsonb_set(canonical_results, '{0,entryOrdinal}', '999'::jsonb),
      '20000000-0000-4000-8000-000000000001', '2026-07-20 00:00:00+00'
    ) from raffle_test_draw_evidence$$,
  '%raffle_result_seed_mismatch%',
  'a validly shaped but wrong result for the committed seed is rejected'
);

select lives_ok(
  $$select public.complete_raffle_draw(
      draw_id, ledger_hash, seed_hex, seed_hash,
      'mochirii-weighted-without-replacement-v1', canonical_results,
      '20000000-0000-4000-8000-000000000001', '2026-07-20 00:00:00+00'
    ) from raffle_test_draw_evidence$$,
  'the exact canonical seeded result commits once'
);

select is(
  (
    select (public.complete_raffle_draw(
      draw_id, ledger_hash, seed_hex, seed_hash,
      'mochirii-weighted-without-replacement-v1', canonical_results,
      '20000000-0000-4000-8000-000000000001', '2026-07-20 00:01:00+00'
    )->>'duplicate')::boolean from raffle_test_draw_evidence
  ),
  true,
  'an identical canonical draw retry is idempotent'
);

select throws_like(
  $$select public.complete_raffle_draw(
      draw_id, ledger_hash, seed_hex, seed_hash,
      'mochirii-weighted-without-replacement-v1',
      jsonb_set(canonical_results, '{0,entryOrdinal}', '999'::jsonb),
      '20000000-0000-4000-8000-000000000001', '2026-07-20 00:01:00+00'
    ) from raffle_test_draw_evidence$$,
  '%raffle_draw_retry_conflict%',
  'a conflicting result retry cannot replace the canonical draw'
);

select is(
  (
    select public.record_raffle_ledger_hash(
      draw_id, ledger_hash, '20000000-0000-4000-8000-000000000001',
      '2026-07-20 00:02:00+00'
    )->>'seedHex' from raffle_test_draw_evidence
  ),
  (select seed_hex from raffle_test_draw_evidence),
  'a ledger commitment retry returns the same seed and cannot reroll'
);

select lives_ok(
  $$select public.record_raffle_private_notice(
      '10000000-0000-4000-8000-000000000900',
      (
        select id from public.raffle_draw_results
        where cycle_id = '10000000-0000-4000-8000-000000000900'
          and result_kind = 'paid_winner'
      ),
      '20000000-0000-4000-8000-000000000001',
      '2026-07-20 00:03:00+00'
    )$$,
  'the result-first private-notice boundary records the selected winner once'
);

select is(
  (
    public.record_raffle_private_notice(
      '10000000-0000-4000-8000-000000000900',
      (
        select id from public.raffle_draw_results
        where cycle_id = '10000000-0000-4000-8000-000000000900'
          and result_kind = 'paid_winner'
      ),
      '20000000-0000-4000-8000-000000000001',
      '2026-07-20 00:04:00+00'
    )->>'duplicate'
  )::boolean,
  true,
  'an identical private-notice retry remains idempotent after lock-order hardening'
);

set local role service_role;
select throws_like(
  $$update public.raffle_draws
    set updated_at = updated_at
    where cycle_id = '10000000-0000-4000-8000-000000000900'$$,
  '%raffle_draw_service_boundary_required%',
  'service-role table access cannot bypass the draw RPC boundary'
);
select throws_like(
  $$update public.raffle_draw_results
    set updated_at = updated_at
    where cycle_id = '10000000-0000-4000-8000-000000000900'$$,
  '%raffle_result_service_boundary_required%',
  'service-role table access cannot bypass canonical result RPCs'
);
reset role;

-- The scheduler crosses one reviewed database boundary. Expiry, alternate
-- promotion, completion, and their redacted audit evidence commit atomically;
-- exact retries are no-ops and cannot promote the same alternate twice.
insert into public.raffle_cycles (
  id, public_cycle_id, status, opens_at, closes_at, draw_at, expires_at,
  rules_version, rules_version_url, rules_content_hash,
  privacy_version, privacy_content_hash,
  country_matrix_version, country_matrix_hash, approved_country_codes,
  reward_value_cents, cycle_cost_ceiling_cents, public_reward_label,
  sponsor_display_name, sponsor_approved, rules_approved,
  country_matrix_approved, reward_approved, privacy_approved,
  tax_approved, operations_approved, opened_at, frozen_at,
  entrant_count, total_entry_count
) values (
  '10000000-0000-4000-8000-000000000950',
  'test-atomic-claim-schedule',
  'drawn',
  '2026-07-01 00:00:00+00',
  '2026-07-19 23:45:00+00',
  '2026-07-20 00:00:00+00',
  '2026-08-19 00:00:00+00',
  'test-v1',
  '/raffle#drawing-rules-test-v1',
  (select rules_content_hash from public.raffle_rule_snapshots where rules_version = 'test-v1'),
  'test-v1',
  repeat('2', 64),
  'test-v1',
  repeat('3', 64),
  array['US'],
  2500,
  5000,
  'One reviewed test reward.',
  'Reviewed test sponsor',
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  '2026-07-01 00:00:00+00',
  '2026-07-19 23:45:00+00',
  4,
  4
);

insert into public.raffle_draws (
  id, cycle_id, status, ledger_salt, ledger_hash, seed_hex, seed_hash,
  entrant_count, total_entry_count, frozen_at, drawn_at,
  initiated_by, completed_by
) values (
  '30000000-0000-4000-8000-000000000950',
  '10000000-0000-4000-8000-000000000950',
  'drawn',
  repeat('4', 32),
  repeat('5', 64),
  repeat('6', 64),
  repeat('7', 64),
  4,
  4,
  '2026-07-19 23:45:00+00',
  '2026-07-20 00:00:00+00',
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001'
);

insert into public.raffle_draw_results (
  id, draw_id, cycle_id, member_id, result_kind, selection_order,
  entry_ordinal, pseudonymous_member_id, alternate_rank, status,
  claim_opened_at, claim_deadline, claim_window_days
) values
  (
    '40000000-0000-4000-8000-000000000951',
    '30000000-0000-4000-8000-000000000950',
    '10000000-0000-4000-8000-000000000950',
    '20000000-0000-4000-8000-000000000001',
    'paid_winner', 1, 1, repeat('8', 64), null, 'selected',
    '2026-07-20 00:00:00+00', '2026-07-27 00:00:00+00', 7
  ),
  (
    '40000000-0000-4000-8000-000000000952',
    '30000000-0000-4000-8000-000000000950',
    '10000000-0000-4000-8000-000000000950',
    '20000000-0000-4000-8000-000000000004',
    'alternate', 4, 4, repeat('9', 64), 1, 'selected',
    null, null, 7
  ),
  (
    '40000000-0000-4000-8000-000000000953',
    '30000000-0000-4000-8000-000000000950',
    '10000000-0000-4000-8000-000000000950',
    '20000000-0000-4000-8000-000000000002',
    'honor', 2, 2, repeat('a', 64), null, 'selected',
    null, null, 7
  ),
  (
    '40000000-0000-4000-8000-000000000954',
    '30000000-0000-4000-8000-000000000950',
    '10000000-0000-4000-8000-000000000950',
    '20000000-0000-4000-8000-000000000003',
    'honor', 3, 3, repeat('b', 64), null, 'selected',
    null, null, 7
  );

set local role service_role;
select is(
  (
    public.advance_raffle_claim_schedule(
      '10000000-0000-4000-8000-000000000950',
      '2026-07-27 00:00:00+00'
    )->>'changedCount'
  )::integer,
  0,
  'the paid-winner claim remains eligible at its exact inclusive deadline'
);
reset role;

select ok(
  (
    select winner.status = 'selected'
      and alternate.claim_opened_at is null
      and (
        select count(*)
        from public.raffle_audit_events audit
        where audit.cycle_id = winner.cycle_id
      ) = 0
    from public.raffle_draw_results winner
    join public.raffle_draw_results alternate
      on alternate.id = '40000000-0000-4000-8000-000000000952'
    where winner.id = '40000000-0000-4000-8000-000000000951'
  ),
  'the inclusive deadline does not expire, promote, or write audit evidence'
);

set local role service_role;
select is(
  (
    public.advance_raffle_claim_schedule(
      '10000000-0000-4000-8000-000000000950',
      '2026-07-27 00:00:01+00'
    )->>'changedCount'
  )::integer,
  2,
  'the first instant after the deadline expires the winner and promotes one alternate'
);
reset role;

select is(
  (
    select status
    from public.raffle_draw_results
    where id = '40000000-0000-4000-8000-000000000951'
  ),
  'expired',
  'the expired paid-winner claim is persisted'
);

select ok(
  (
    select status = 'selected'
      and claim_opened_at = '2026-07-27 00:00:01+00'::timestamptz
      and claim_deadline = '2026-08-03 00:00:01+00'::timestamptz
    from public.raffle_draw_results
    where id = '40000000-0000-4000-8000-000000000952'
  ),
  'the promoted alternate receives the exact reviewed claim window'
);

select is(
  (
    select count(*)::integer
    from public.raffle_audit_events
    where cycle_id = '10000000-0000-4000-8000-000000000950'
      and event_type in ('claim_expired', 'alternate_promoted')
  ),
  2,
  'expiry and promotion each commit one deduplicated audit event'
);

set local role service_role;
select ok(
  (
    select (retry.value->>'changedCount')::integer = 0
      and (retry.value->>'duplicate')::boolean
    from (
      select public.advance_raffle_claim_schedule(
        '10000000-0000-4000-8000-000000000950',
        '2026-07-27 00:00:01+00'
      ) as value
    ) retry
  ),
  'an exact scheduler retry is an idempotent no-op'
);
reset role;

select is(
  (
    select count(*)::integer
    from public.raffle_audit_events
    where cycle_id = '10000000-0000-4000-8000-000000000950'
  ),
  2,
  'an exact scheduler retry does not duplicate audit evidence'
);

set local role service_role;
select is(
  (
    public.advance_raffle_claim_schedule(
      '10000000-0000-4000-8000-000000000950',
      '2026-08-03 00:00:02+00'
    )->>'changedCount'
  )::integer,
  2,
  'the next due pass expires the alternate and completes the exhausted cycle'
);
reset role;

select ok(
  (
    select cycle.status = 'complete'
      and cycle.completed_at = '2026-08-03 00:00:02+00'::timestamptz
      and alternate.status = 'expired'
      and (
        select count(*)
        from public.raffle_audit_events audit
        where audit.cycle_id = cycle.id
          and audit.event_type in (
            'claim_expired', 'alternate_promoted', 'cycle_completed'
          )
      ) = 4
    from public.raffle_cycles cycle
    join public.raffle_draw_results alternate
      on alternate.id = '40000000-0000-4000-8000-000000000952'
    where cycle.id = '10000000-0000-4000-8000-000000000950'
  ),
  'completion and its fourth audit record commit with the final expiry'
);

set local role service_role;
select ok(
  (
    select (retry.value->>'changedCount')::integer = 0
      and (retry.value->>'duplicate')::boolean
    from (
      select public.advance_raffle_claim_schedule(
        '10000000-0000-4000-8000-000000000950',
        '2026-08-03 00:00:02+00'
      ) as value
    ) retry
  ),
  'a completed cycle remains unchanged on later scheduler retries'
);
reset role;

-- A timestamp beyond the allowed five-minute clock skew is never accepted as
-- current guild verification.
insert into public.raffle_cycles (
  id, public_cycle_id, status, opens_at, closes_at, draw_at, expires_at,
  rules_version, rules_version_url, rules_content_hash,
  privacy_version, privacy_content_hash,
  country_matrix_version, country_matrix_hash, approved_country_codes,
  reward_value_cents, cycle_cost_ceiling_cents, public_reward_label,
  sponsor_display_name, sponsor_approved, rules_approved,
  country_matrix_approved, reward_approved, privacy_approved,
  tax_approved, operations_approved, opened_at
) values (
  '10000000-0000-4000-8000-000000000902', 'test-future-verification', 'open',
  '2026-07-01 00:00:00+00', '2026-07-30 23:45:00+00',
  '2026-07-31 00:00:00+00', '2026-08-30 00:00:00+00',
  'test-v1', '/raffle#drawing-rules-test-v1',
  (select rules_content_hash from public.raffle_rule_snapshots where rules_version = 'test-v1'),
  'test-v1', repeat('7', 64), 'test-v1', repeat('8', 64), array['US'],
  2500, 5000, 'One reviewed test reward.', 'Reviewed test sponsor',
  true, true, true, true, true, true, true, '2026-07-01 00:00:00+00'
);
insert into public.raffle_entries (
  cycle_id, member_id, eligibility_status, eligibility_reason_code,
  country_code, age_18_affirmed, rules_accepted_at
) values (
  '10000000-0000-4000-8000-000000000902',
  '20000000-0000-4000-8000-000000000002', 'pending', 'not_checked',
  'US', true, '2026-07-02 00:00:00+00'
);
update public.member_profiles
set discord_verified_at = '2026-07-20 00:05:01+00'
where id = '20000000-0000-4000-8000-000000000002';

select is(
  public.review_raffle_entry_eligibility(
    '10000000-0000-4000-8000-000000000902',
    '20000000-0000-4000-8000-000000000002', 'clear', '',
    '20000000-0000-4000-8000-000000000001', '2026-07-20 00:00:00+00'
  )->>'reasonCode',
  'guild_verification_stale',
  'future guild verification beyond the clock-skew allowance is rejected'
);

-- Provider state writes require the same still-live worker lease that claimed
-- the event; knowing an event UUID alone is insufficient.
update public.raffle_fulfillment_jobs
set provider_reward_id = 'reward-test-25'
where id = '50000000-0000-4000-8000-000000000025';
insert into public.raffle_provider_events (
  id, provider_config_id, provider_event_uuid, event_type,
  resource_type, resource_reference, environment, body_sha256,
  processing_status, locked_by, locked_at, lock_expires_at
) values (
  '70000000-0000-4000-8000-000000000001',
  (select id from public.raffle_provider_configs where environment = 'sandbox'),
  '71000000-0000-4000-8000-000000000001', 'REWARDS.DELIVERY.SUCCEEDED',
  'REWARD', 'reward-test-25', 'sandbox', repeat('9', 64),
  'processing', 'worker-good', now(), now() + interval '5 minutes'
);

select throws_like(
  $$select public.apply_raffle_provider_reward_state(
      '70000000-0000-4000-8000-000000000001', 'worker-wrong',
      'reward-test-25', 'active', 'succeeded'
    )$$,
  '%event_lock_not_owned%',
  'a different worker cannot apply provider reward state'
);

select lives_ok(
  $$select public.apply_raffle_provider_reward_state(
      '70000000-0000-4000-8000-000000000001', 'worker-good',
      'reward-test-25', 'active', 'succeeded'
    )$$,
  'the exact worker can apply provider state during its live lease'
);

update public.raffle_provider_events
set locked_at = now() - interval '2 minutes',
    lock_expires_at = now() - interval '1 minute'
where id = '70000000-0000-4000-8000-000000000001';
select throws_like(
  $$select public.apply_raffle_provider_reward_state(
      '70000000-0000-4000-8000-000000000001', 'worker-good',
      'reward-test-25', 'active', 'succeeded'
    )$$,
  '%event_lock_not_owned%',
  'an expired worker lease cannot apply provider reward state'
);

select throws_like(
  $$select public.reserve_raffle_reward_link(
      '40000000-0000-4000-8000-000000000025',
      '20000000-0000-4000-8000-000000000001', now()
    )$$,
  '%reward_link_relay_handoff_not_active%',
  'core reward-link reservation fails closed until the relay handoff exists'
);

select is(
  (select link_generation_count from public.raffle_fulfillment_jobs
   where id = '50000000-0000-4000-8000-000000000025'),
  0,
  'a failed reward-link handoff does not consume generation allowance'
);

select is(
  public.consume_raffle_leaderboard_nonce(
    '20000000-0000-4000-8000-000000000001',
    '0123456789abcdef0123456789abcdef',
    now() + interval '1 minute'
  ),
  true,
  'the first valid server-signed leaderboard nonce is consumed'
);

select is(
  public.consume_raffle_leaderboard_nonce(
    '20000000-0000-4000-8000-000000000001',
    '0123456789abcdef0123456789abcdef',
    now() + interval '1 minute'
  ),
  false,
  'a consumed leaderboard nonce cannot be replayed'
);

-- Earlier scenarios deliberately leave an open cycle behind. Retire only
-- those test fixtures so this block proves current-cycle selection without an
-- unrealistic long-lived drawing window.
update public.raffle_cycles
set status = 'void', void_reason_code = 'leaderboard_test_isolation'
where status = 'open';

update public.member_profiles
set
  display_name = case id
    when '20000000-0000-4000-8000-000000000001' then 'Sya'
    when '20000000-0000-4000-8000-000000000002' then 'Jade Lantern'
    when '20000000-0000-4000-8000-000000000003' then 'Revoked Member'
    else display_name
  end,
  member_status = 'active',
  has_required_discord_roles = true,
  discord_verified_at = now()
where id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003'
);

insert into public.raffle_cycles (
  id, public_cycle_id, status, opens_at, closes_at, draw_at, expires_at,
  rules_version, rules_version_url, rules_content_hash,
  privacy_version, privacy_content_hash,
  country_matrix_version, country_matrix_hash, approved_country_codes,
  reward_value_cents, cycle_cost_ceiling_cents, public_reward_label,
  sponsor_display_name, sponsor_approved, rules_approved,
  country_matrix_approved, reward_approved, privacy_approved,
  tax_approved, operations_approved, opened_at
) values (
  '10000000-0000-4000-8000-000000000990',
  'test-leaderboard-current',
  'open',
  now() - interval '1 day',
  now() + interval '1 day',
  now() + interval '1 day 15 minutes',
  now() + interval '31 days 15 minutes',
  'test-v1',
  '/raffle#drawing-rules-test-v1',
  (select rules_content_hash from public.raffle_rule_snapshots where rules_version = 'test-v1'),
  'test-v1',
  repeat('b', 64),
  'test-v1',
  repeat('c', 64),
  array['US'],
  2500,
  5000,
  'One reviewed test reward.',
  'Reviewed test sponsor',
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  now() - interval '1 day'
);

insert into public.raffle_entries (
  id, cycle_id, member_id, eligibility_status, eligibility_reason_code,
  country_code, age_18_affirmed, rules_accepted_at, base_entry_count,
  eligibility_rules_version, eligibility_country_matrix_version,
  eligibility_member_status, eligibility_guild_verified,
  administrator_clearance_status, administrator_clearance_at,
  administrator_clearance_by, administrator_clearance_reason_code
) values
  (
    '60000000-0000-4000-8000-000000000991',
    '10000000-0000-4000-8000-000000000990',
    '20000000-0000-4000-8000-000000000001',
    'eligible', 'eligible', 'US', true, now(), 1,
    'test-v1', 'test-v1', 'active', true,
    'cleared', now(),
    '20000000-0000-4000-8000-000000000001',
    'administrator_household_cleared'
  ),
  (
    '60000000-0000-4000-8000-000000000992',
    '10000000-0000-4000-8000-000000000990',
    '20000000-0000-4000-8000-000000000002',
    'eligible', 'eligible', 'US', true, now(), 1,
    'test-v1', 'test-v1', 'active', true,
    'cleared', now(),
    '20000000-0000-4000-8000-000000000001',
    'administrator_household_cleared'
  ),
  (
    '60000000-0000-4000-8000-000000000993',
    '10000000-0000-4000-8000-000000000990',
    '20000000-0000-4000-8000-000000000003',
    'eligible', 'eligible', 'US', true, now(), 1,
    'test-v1', 'test-v1', 'active', true,
    'cleared', now(),
    '20000000-0000-4000-8000-000000000001',
    'administrator_household_cleared'
  );

insert into public.raffle_bonus_awards (
  id, cycle_id, entry_id, member_id, bonus_key, completion_method,
  source_reference_hash, awarded_by
) values
  (
    '61000000-0000-4000-8000-000000000991',
    '10000000-0000-4000-8000-000000000990',
    '60000000-0000-4000-8000-000000000991',
    '20000000-0000-4000-8000-000000000001',
    'scheduled_activity', 'primary', repeat('1', 64),
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '61000000-0000-4000-8000-000000000992',
    '10000000-0000-4000-8000-000000000990',
    '60000000-0000-4000-8000-000000000991',
    '20000000-0000-4000-8000-000000000001',
    'guild_feedback', 'alternative', repeat('2', 64),
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '61000000-0000-4000-8000-000000000993',
    '10000000-0000-4000-8000-000000000990',
    '60000000-0000-4000-8000-000000000992',
    '20000000-0000-4000-8000-000000000002',
    'member_welcome', 'primary', repeat('3', 64),
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '61000000-0000-4000-8000-000000000994',
    '10000000-0000-4000-8000-000000000990',
    '60000000-0000-4000-8000-000000000993',
    '20000000-0000-4000-8000-000000000003',
    'scheduled_activity', 'primary', repeat('4', 64),
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '61000000-0000-4000-8000-000000000995',
    '10000000-0000-4000-8000-000000000990',
    '60000000-0000-4000-8000-000000000993',
    '20000000-0000-4000-8000-000000000003',
    'guild_feedback', 'primary', repeat('5', 64),
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '61000000-0000-4000-8000-000000000996',
    '10000000-0000-4000-8000-000000000990',
    '60000000-0000-4000-8000-000000000993',
    '20000000-0000-4000-8000-000000000003',
    'member_welcome', 'primary', repeat('6', 64),
    '20000000-0000-4000-8000-000000000001'
  );

update public.member_profiles
set member_status = 'suspended'
where id = '20000000-0000-4000-8000-000000000003';

select is(
  (
    public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000001'
    )->>'participantCount'
  )::integer,
  2,
  'the current leaderboard counts only participating members'
);

select is(
  (
    public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000001'
    )#>>'{entries,0,rank}'
  )::integer,
  1,
  'a revoked higher-point entrant is filtered before dense ranking'
);

select is(
  (
    public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000001'
    )#>>'{entries,0,entryCount}'
  )::integer,
  3,
  'one standard entry plus two bonus entries produces three points'
);

select ok(
  not (
    public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000001'
    )::text ~* '(memberId|cycleId|evidence|hash)'
  ),
  'the leaderboard aggregate contains no member identifiers or evidence'
);

select throws_like(
  $$select public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000003'
    )$$,
  '%raffle_member_access_required%',
  'an unverified member cannot read the leaderboard aggregate'
);

update public.member_profiles
set member_status = 'active',
    has_required_discord_roles = false,
    discord_verified_at = now()
where id = '20000000-0000-4000-8000-000000000003';

insert into public.member_verifications (
  user_id, gallery_access_status, gallery_access_method,
  gallery_access_verified_at, reviewed_by, reviewed_at
) values (
  '20000000-0000-4000-8000-000000000003',
  'approved', 'manual_review', now(),
  '20000000-0000-4000-8000-000000000001', now()
)
on conflict (user_id) do update
set gallery_access_status = excluded.gallery_access_status,
    gallery_access_method = excluded.gallery_access_method,
    gallery_access_verified_at = excluded.gallery_access_verified_at,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at;

select is(
  (
    public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000001'
    )->>'participantCount'
  )::integer,
  2,
  'manual gallery approval cannot restore a Discord-deverified entrant'
);

select throws_like(
  $$select public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000003'
    )$$,
  '%raffle_member_access_required%',
  'manual gallery approval cannot authorize a Discord-deverified viewer'
);

update public.member_profiles
set discord_verified_at = now() - interval '8 days'
where id = '20000000-0000-4000-8000-000000000002';

select is(
  (
    public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000001'
    )->>'participantCount'
  )::integer,
  1,
  'a stale guild verification is filtered before ranking'
);

update public.member_profiles
set discord_verified_at = now() + interval '6 minutes'
where id = '20000000-0000-4000-8000-000000000002';

select is(
  (
    public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000001'
    )->>'participantCount'
  )::integer,
  1,
  'a future guild verification beyond clock skew is filtered before ranking'
);

update public.member_profiles
set has_required_discord_roles = false,
    discord_verified_at = now()
where id = '20000000-0000-4000-8000-000000000002';

select is(
  (
    public.get_current_raffle_leaderboard(
      '20000000-0000-4000-8000-000000000001'
    )->>'participantCount'
  )::integer,
  1,
  'a role-revoked entrant is filtered before ranking'
);

update public.member_profiles
set has_required_discord_roles = true,
    discord_verified_at = now(),
    display_name = 'Jade' || chr(8238) || 'Lantern'
where id = '20000000-0000-4000-8000-000000000002';

select is(
  public.get_current_raffle_leaderboard(
    '20000000-0000-4000-8000-000000000001'
  )#>>'{entries,1,displayName}',
  'Mōchī Member',
  'an unsafe legacy display name is contained without suppressing the aggregate'
);

update public.member_profiles
set display_name = 'Jade Lantern'
where id = '20000000-0000-4000-8000-000000000002';

select * from finish();
rollback;
