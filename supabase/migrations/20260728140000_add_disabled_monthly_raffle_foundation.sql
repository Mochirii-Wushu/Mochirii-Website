begin;

set local lock_timeout = '5s';

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;

create or replace function private.assert_raffle_service_caller()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
begin
  if request_role = 'service_role'
    or session_user in ('postgres', 'supabase_admin') then
    return;
  end if;

  raise exception 'raffle_service_role_required' using errcode = '42501';
end;
$$;

revoke all on function private.assert_raffle_service_caller()
from public, anon, authenticated;
grant execute on function private.assert_raffle_service_caller() to service_role;

-- One-use nonces prevent authenticated server-to-server leaderboard requests
-- from being replayed. The table is private, short-lived, and never exposed
-- through the Data API.
create table private.raffle_leaderboard_nonces (
  nonce text primary key,
  subject_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  constraint raffle_leaderboard_nonces_nonce_check
    check (nonce ~ '^[0-9a-f]{32}$'),
  constraint raffle_leaderboard_nonces_expiry_check
    check (expires_at > consumed_at - interval '5 seconds')
);

alter table private.raffle_leaderboard_nonces enable row level security;
revoke all on table private.raffle_leaderboard_nonces
from public, anon, authenticated, service_role;

create or replace function public.consume_raffle_leaderboard_nonce(
  p_subject_id uuid,
  p_nonce text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted boolean := false;
begin
  perform private.assert_raffle_service_caller();

  if p_subject_id is null
    or coalesce(p_nonce, '') !~ '^[0-9a-f]{32}$'
    or p_expires_at < statement_timestamp() - interval '5 seconds'
    or p_expires_at > statement_timestamp() + interval '3 minutes' then
    return false;
  end if;

  delete from private.raffle_leaderboard_nonces
  where expires_at < statement_timestamp() - interval '5 seconds';

  insert into private.raffle_leaderboard_nonces (
    nonce,
    subject_id,
    expires_at
  )
  values (
    p_nonce,
    p_subject_id,
    p_expires_at
  )
  on conflict (nonce) do nothing
  returning true into inserted;

  return coalesce(inserted, false);
end;
$$;

-- All prize-draw relations are deliberately service-only. Website and Discord
-- clients go through narrow Edge Functions that return provider-neutral DTOs.
create table public.raffle_cycles (
  id uuid primary key default gen_random_uuid(),
  public_cycle_id text not null unique,
  status text not null default 'draft',
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  draw_at timestamptz not null,
  expires_at timestamptz not null,
  timezone text not null default 'Asia/Singapore',
  sponsor_display_name text,
  public_reward_label text,
  rules_version text not null,
  rules_version_url text not null,
  rules_content_hash text,
  privacy_version text,
  privacy_content_hash text,
  country_matrix_version text,
  country_matrix_hash text,
  approved_country_codes text[] not null default '{}'::text[],
  base_entries smallint not null default 1,
  max_bonus_entries smallint not null default 9,
  max_entries smallint not null default 10,
  claim_window_days smallint not null default 7,
  award_window_days smallint not null default 30,
  minimum_eligible_entrants smallint not null default 3,
  reward_value_cents integer not null default 1000,
  cycle_cost_ceiling_cents integer not null default 5000,
  in_game_reward_enabled boolean not null default false,
  in_game_privacy_reviewed_at timestamptz,
  in_game_privacy_reviewed_by uuid references auth.users(id) on delete set null,
  sponsor_approved boolean not null default false,
  rules_approved boolean not null default false,
  country_matrix_approved boolean not null default false,
  reward_approved boolean not null default false,
  privacy_approved boolean not null default false,
  tax_approved boolean not null default false,
  operations_approved boolean not null default false,
  entrant_count integer,
  total_entry_count integer,
  frozen_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  void_reason_code text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffle_cycles_public_id_check check (public_cycle_id ~ '^[a-z0-9][a-z0-9-]{5,63}$'),
  constraint raffle_cycles_status_check check (status in ('draft', 'ready', 'open', 'frozen', 'drawn', 'complete', 'void', 'blocked')),
  constraint raffle_cycles_window_check check (
    opens_at < closes_at
    and closes_at = draw_at - interval '15 minutes'
    and expires_at = draw_at + make_interval(days => award_window_days)
  ),
  constraint raffle_cycles_timezone_check check (timezone = 'Asia/Singapore'),
  constraint raffle_cycles_sponsor_check check (
    sponsor_display_name is null
    or char_length(trim(sponsor_display_name)) between 2 and 120
  ),
  constraint raffle_cycles_entry_limits_check check (
    base_entries = 1 and max_bonus_entries = 9 and max_entries = 10
    and claim_window_days between 1 and 30
    and award_window_days between 7 and 90
    and minimum_eligible_entrants between 3 and 10000
  ),
  constraint raffle_cycles_cost_limits_check check (
    reward_value_cents between 1000 and 5000
    and reward_value_cents % 100 = 0
    and cycle_cost_ceiling_cents = 5000
    and (
      public_reward_label is null
      or char_length(trim(public_reward_label)) between 3 and 240
    )
  ),
  constraint raffle_cycles_in_game_privacy_check check (
    not in_game_reward_enabled
    or (in_game_privacy_reviewed_at is not null and in_game_privacy_reviewed_by is not null)
  ),
  constraint raffle_cycles_rules_check check (
    rules_version ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
    and rules_version_url = '/raffle#drawing-rules-' || rules_version
    and (rules_content_hash is null or rules_content_hash ~ '^[0-9a-f]{64}$')
    and (privacy_version is null or privacy_version ~ '^[a-z0-9][a-z0-9._-]{2,63}$')
    and (privacy_content_hash is null or privacy_content_hash ~ '^[0-9a-f]{64}$')
    and (country_matrix_hash is null or country_matrix_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint raffle_cycles_country_codes_check check (
    approved_country_codes <@ array[
      'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
      'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
      'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
      'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR',
      'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
      'HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP',
      'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
      'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
      'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
      'QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
      'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ',
      'VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
    ]::text[]
    and array_position(approved_country_codes, null) is null
  ),
  constraint raffle_cycles_launch_gate_check check (
    status not in ('ready', 'open', 'frozen', 'drawn', 'complete')
    or (
      sponsor_approved
      and rules_approved
      and country_matrix_approved
      and reward_approved
      and privacy_approved
      and tax_approved
      and operations_approved
      and sponsor_display_name is not null
      and public_reward_label is not null
      and rules_content_hash is not null
      and privacy_version is not null
      and privacy_content_hash is not null
      and country_matrix_version is not null
      and country_matrix_hash is not null
      and cardinality(approved_country_codes) > 0
    )
  ),
  constraint raffle_cycles_counts_check check (
    (entrant_count is null or entrant_count >= 0)
    and (total_entry_count is null or total_entry_count >= 0)
    and (entrant_count is null or total_entry_count is null or total_entry_count between entrant_count and entrant_count * 10)
  )
);

comment on table public.raffle_cycles is
  'Service-owned monthly prize-draw cycles. Empty country lists and false launch gates keep new cycles fail-closed.';

create index raffle_cycles_status_schedule_idx on public.raffle_cycles (status, opens_at, closes_at, draw_at);
create index raffle_cycles_created_by_idx on public.raffle_cycles (created_by) where created_by is not null;
create index raffle_cycles_in_game_reviewer_idx on public.raffle_cycles (in_game_privacy_reviewed_by)
where in_game_privacy_reviewed_by is not null;

create table public.raffle_entries (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.raffle_cycles(id) on delete restrict,
  member_id uuid not null references public.member_profiles(id) on delete restrict,
  eligibility_status text not null default 'pending',
  eligibility_reason_code text not null default 'not_checked',
  country_code text,
  age_18_affirmed boolean not null default false,
  rules_accepted_at timestamptz,
  opted_in_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  base_entry_count smallint not null default 0,
  frozen_entry_count smallint,
  eligibility_rules_version text,
  eligibility_country_matrix_version text,
  eligibility_member_status text,
  eligibility_guild_verified boolean not null default false,
  administrator_clearance_status text not null default 'pending',
  administrator_clearance_at timestamptz,
  administrator_clearance_by uuid references auth.users(id) on delete set null,
  administrator_clearance_reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffle_entries_cycle_member_key unique (cycle_id, member_id),
  constraint raffle_entries_identity_key unique (id, cycle_id, member_id),
  constraint raffle_entries_status_check check (eligibility_status in ('pending', 'eligible', 'ineligible', 'withdrawn', 'frozen')),
  constraint raffle_entries_reason_check check (eligibility_reason_code ~ '^[a-z0-9_]{2,80}$'),
  constraint raffle_entries_country_check check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint raffle_entries_base_count_check check (base_entry_count in (0, 1)),
  constraint raffle_entries_frozen_count_check check (frozen_entry_count is null or frozen_entry_count between 1 and 10),
  constraint raffle_entries_evidence_check check (
    (eligibility_rules_version is null or eligibility_rules_version ~ '^[a-z0-9][a-z0-9._-]{2,63}$')
    and (eligibility_country_matrix_version is null or eligibility_country_matrix_version ~ '^[a-z0-9][a-z0-9._-]{2,63}$')
    and (eligibility_member_status is null or eligibility_member_status in ('pending', 'active', 'suspended', 'archived'))
  ),
  constraint raffle_entries_administrator_clearance_check check (
    administrator_clearance_status in ('pending', 'cleared', 'excluded')
    and (
      (administrator_clearance_status = 'pending'
        and administrator_clearance_at is null
        and administrator_clearance_by is null
        and administrator_clearance_reason_code is null)
      or (administrator_clearance_status = 'cleared'
        and administrator_clearance_at is not null
        and administrator_clearance_by is not null
        and administrator_clearance_reason_code = 'administrator_household_cleared')
      or (administrator_clearance_status = 'excluded'
        and administrator_clearance_at is not null
        and administrator_clearance_by is not null
        and administrator_clearance_reason_code in ('administrator_ineligible', 'administrator_household_ineligible'))
    )
  ),
  constraint raffle_entries_eligible_fields_check check (
    eligibility_status not in ('eligible', 'frozen')
    or (
      age_18_affirmed
      and rules_accepted_at is not null
      and country_code is not null
      and base_entry_count = 1
      and eligibility_rules_version is not null
      and eligibility_country_matrix_version is not null
      and eligibility_member_status = 'active'
      and eligibility_guild_verified
      and administrator_clearance_status = 'cleared'
      and withdrawn_at is null
    )
  ),
  constraint raffle_entries_withdrawn_check check (
    (eligibility_status = 'withdrawn') = (withdrawn_at is not null)
  )
);

comment on table public.raffle_entries is
  'Private monthly opt-in and frozen entry ledger keyed to the authenticated member.';

create index raffle_entries_member_idx on public.raffle_entries (member_id, opted_in_at desc);
create index raffle_entries_cycle_status_idx on public.raffle_entries (cycle_id, eligibility_status, member_id);
create index raffle_entries_clearance_actor_idx on public.raffle_entries (administrator_clearance_by)
where administrator_clearance_by is not null;

create table public.raffle_bonus_awards (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.raffle_cycles(id) on delete restrict,
  entry_id uuid not null references public.raffle_entries(id) on delete restrict,
  member_id uuid not null references public.member_profiles(id) on delete restrict,
  bonus_key text not null,
  completion_method text not null,
  source_reference_hash text,
  awarded_at timestamptz not null default now(),
  awarded_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revocation_reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffle_bonus_awards_entry_key unique (entry_id, bonus_key),
  constraint raffle_bonus_awards_entry_identity_fk foreign key (entry_id, cycle_id, member_id)
    references public.raffle_entries(id, cycle_id, member_id) on delete restrict,
  constraint raffle_bonus_awards_bonus_key_check check (bonus_key in (
    'scheduled_activity',
    'monthly_gathering',
    'help_session',
    'social_media_share',
    'guild_feedback',
    'member_welcome',
    'member_recruitment',
    'creative_hobby_share',
    'member_spotlight_nomination'
  )),
  constraint raffle_bonus_awards_method_check check (completion_method in ('primary', 'alternative')),
  constraint raffle_bonus_awards_source_hash_check check (source_reference_hash is null or source_reference_hash ~ '^[0-9a-f]{64}$'),
  constraint raffle_bonus_awards_revoke_check check (
    (revoked_at is null and revoked_by is null and revocation_reason_code is null)
      or (revoked_at is not null and revoked_by is not null
        and revocation_reason_code ~ '^[a-z0-9_]{2,80}$')
  )
);

comment on table public.raffle_bonus_awards is
  'One objective bonus per row; primary activity and its equal free alternative share the same key.';

create index raffle_bonus_awards_cycle_member_idx on public.raffle_bonus_awards (cycle_id, member_id) where revoked_at is null;
create index raffle_bonus_awards_entry_identity_idx on public.raffle_bonus_awards (entry_id, cycle_id, member_id);
create index raffle_bonus_awards_member_idx on public.raffle_bonus_awards (member_id);
create index raffle_bonus_awards_awarded_by_idx on public.raffle_bonus_awards (awarded_by) where awarded_by is not null;
create index raffle_bonus_awards_revoked_by_idx on public.raffle_bonus_awards (revoked_by) where revoked_by is not null;

create table public.raffle_draws (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null unique references public.raffle_cycles(id) on delete restrict,
  status text not null default 'frozen',
  ledger_salt text not null,
  ledger_hash text,
  seed_hex text,
  seed_hash text,
  algorithm_version text not null default 'mochirii-weighted-without-replacement-v1',
  entrant_count integer not null,
  total_entry_count integer not null,
  frozen_at timestamptz not null default now(),
  drawn_at timestamptz,
  initiated_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffle_draws_status_check check (status in ('frozen', 'drawn', 'void')),
  constraint raffle_draws_identity_key unique (id, cycle_id),
  constraint raffle_draws_algorithm_check check (
    algorithm_version = 'mochirii-weighted-without-replacement-v1'
  ),
  constraint raffle_draws_salt_check check (char_length(ledger_salt) between 32 and 128),
  constraint raffle_draws_hashes_check check (
    (ledger_hash is null or ledger_hash ~ '^[0-9a-f]{64}$')
    and (seed_hex is null or seed_hex ~ '^[0-9a-f]{64}$')
    and (seed_hash is null or seed_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint raffle_draws_counts_check check (
    entrant_count >= 3
    and total_entry_count between entrant_count and entrant_count * 10
  ),
  constraint raffle_draws_complete_check check (
    status <> 'drawn'
    or (ledger_hash is not null and seed_hex is not null and seed_hash is not null and drawn_at is not null)
  )
);

comment on table public.raffle_draws is
  'Immutable freeze and reproducible random-selection evidence. No member-facing identity is stored in public evidence.';

create index raffle_draws_initiated_by_idx on public.raffle_draws (initiated_by) where initiated_by is not null;
create index raffle_draws_completed_by_idx on public.raffle_draws (completed_by) where completed_by is not null;

create table public.raffle_draw_results (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.raffle_draws(id) on delete restrict,
  cycle_id uuid not null references public.raffle_cycles(id) on delete restrict,
  member_id uuid not null references public.member_profiles(id) on delete restrict,
  result_kind text not null,
  selection_order integer not null,
  entry_ordinal integer not null,
  pseudonymous_member_id text not null,
  alternate_rank integer,
  status text not null default 'selected',
  contacted_at timestamptz,
  claim_opened_at timestamptz,
  claim_deadline timestamptz,
  claim_window_days smallint not null default 7,
  claimed_at timestamptz,
  reward_route text,
  public_handle text,
  public_announcement_consent boolean not null default false,
  tax_status text not null default 'pending',
  tax_reviewed_at timestamptz,
  tax_reviewed_by uuid references auth.users(id) on delete set null,
  tax_review_reason_code text,
  membership_clearance_status text not null default 'pending',
  membership_reviewed_at timestamptz,
  membership_reviewed_by uuid references auth.users(id) on delete set null,
  membership_review_reason_code text,
  fraud_clearance_status text not null default 'pending',
  fraud_reviewed_at timestamptz,
  fraud_reviewed_by uuid references auth.users(id) on delete set null,
  fraud_review_reason_code text,
  fulfillment_status text not null default 'not_requested',
  manual_fulfilled_at timestamptz,
  manual_fulfilled_by uuid references auth.users(id) on delete set null,
  manual_all_in_cost_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffle_draw_results_identity_key unique (id, cycle_id),
  constraint raffle_draw_results_draw_member_key unique (draw_id, member_id),
  constraint raffle_draw_results_draw_order_key unique (draw_id, selection_order),
  constraint raffle_draw_results_draw_ordinal_key unique (draw_id, entry_ordinal),
  constraint raffle_draw_results_draw_cycle_fk foreign key (draw_id, cycle_id)
    references public.raffle_draws(id, cycle_id) on delete restrict,
  constraint raffle_draw_results_kind_check check (result_kind in ('paid_winner', 'honor', 'alternate')),
  constraint raffle_draw_results_order_check check (selection_order > 0 and entry_ordinal > 0),
  constraint raffle_draw_results_pseudonym_check check (pseudonymous_member_id ~ '^[0-9a-f]{64}$'),
  constraint raffle_draw_results_alternate_check check (
    (result_kind = 'alternate' and alternate_rank is not null and alternate_rank > 0)
    or (result_kind <> 'alternate' and alternate_rank is null)
  ),
  constraint raffle_draw_results_status_check check (status in ('selected', 'contacted', 'claimed', 'declined', 'expired', 'ineligible', 'fulfilled', 'void')),
  constraint raffle_draw_results_contact_check check (
    status <> 'contacted' or contacted_at is not null
  ),
  constraint raffle_draw_results_claim_window_check check (
    claim_window_days between 1 and 30
    and (
      (claim_opened_at is null and claim_deadline is null)
      or (
        claim_opened_at is not null
        and claim_deadline = claim_opened_at
          + make_interval(days => claim_window_days)
      )
    )
  ),
  constraint raffle_draw_results_claimed_check check (
    (claimed_at is null and reward_route is null)
    or (claimed_at is not null and reward_route in ('digital', 'in_game'))
  ),
  constraint raffle_draw_results_public_handle_check check (
    (not public_announcement_consent and public_handle is null)
    or (public_announcement_consent and public_handle is not null and char_length(public_handle) between 1 and 80)
  ),
  constraint raffle_draw_results_tax_check check (tax_status in ('pending', 'not_required', 'cleared', 'blocked')),
  constraint raffle_draw_results_tax_review_check check (
    (tax_status = 'pending'
      and tax_reviewed_at is null
      and tax_reviewed_by is null
      and tax_review_reason_code is null)
    or (tax_status <> 'pending'
      and tax_reviewed_at is not null
      and tax_reviewed_by is not null
      and tax_review_reason_code in ('tax_not_required', 'tax_cleared', 'tax_review_blocked'))
  ),
  constraint raffle_draw_results_membership_review_check check (
    membership_clearance_status in ('pending', 'cleared', 'blocked')
    and (
      (membership_clearance_status = 'pending'
        and membership_reviewed_at is null
        and membership_reviewed_by is null
        and membership_review_reason_code is null)
      or (membership_clearance_status <> 'pending'
        and membership_reviewed_at is not null
        and membership_reviewed_by is not null
        and membership_review_reason_code in (
          'membership_cleared', 'membership_not_active',
          'guild_verification_required'
        ))
    )
  ),
  constraint raffle_draw_results_fraud_review_check check (
    fraud_clearance_status in ('pending', 'cleared', 'blocked')
    and (
      (fraud_clearance_status = 'pending'
        and fraud_reviewed_at is null
        and fraud_reviewed_by is null
        and fraud_review_reason_code is null)
      or (fraud_clearance_status <> 'pending'
        and fraud_reviewed_at is not null
        and fraud_reviewed_by is not null
        and fraud_review_reason_code in ('fraud_cleared', 'fraud_review_blocked'))
    )
  ),
  constraint raffle_draw_results_fulfillment_check check (fulfillment_status in ('not_requested', 'pending', 'processing', 'delivered', 'failed', 'manual')),
  constraint raffle_draw_results_manual_fulfillment_check check (
    (
      manual_fulfilled_at is null
      and manual_fulfilled_by is null
      and manual_all_in_cost_cents is null
    )
    or (
      manual_fulfilled_at is not null
      and manual_fulfilled_by is not null
      and manual_all_in_cost_cents between 1000 and 5000
      and status = 'fulfilled'
      and reward_route = 'in_game'
      and fulfillment_status = 'delivered'
    )
  )
);

comment on table public.raffle_draw_results is
  'Private winner, honors, and complete alternate order. Public responses expose only consented handles or pseudonymous evidence.';

create index raffle_draw_results_member_idx on public.raffle_draw_results (member_id, created_at desc);
create index raffle_draw_results_cycle_status_idx on public.raffle_draw_results (cycle_id, status, selection_order);
create index raffle_draw_results_draw_cycle_idx on public.raffle_draw_results (draw_id, cycle_id);
create index raffle_draw_results_tax_review_actor_idx on public.raffle_draw_results (tax_reviewed_by)
where tax_reviewed_by is not null;
create index raffle_draw_results_membership_actor_idx on public.raffle_draw_results (membership_reviewed_by)
where membership_reviewed_by is not null;
create index raffle_draw_results_fraud_actor_idx on public.raffle_draw_results (fraud_reviewed_by)
where fraud_reviewed_by is not null;
create index raffle_draw_results_manual_actor_idx on public.raffle_draw_results (manual_fulfilled_by)
where manual_fulfilled_by is not null;

create or replace function public.raffle_audit_data_is_safe(value jsonb)
returns boolean
language sql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select
    jsonb_typeof(value) = 'object'
    and pg_column_size(value) <= 2048
    and not exists (
      select 1
      from jsonb_each(value) as item(key, item_value)
      where item.key <> all(array[
        'algorithmVersion', 'alternateRank', 'attemptCount', 'bodyHash', 'bonusKey',
        'claimState', 'completionMethod', 'configurationHash', 'countryCode',
        'cycleStatus', 'duplicate', 'entrantCount', 'environment', 'errorCode',
        'eventReferenceHash', 'eventType', 'externalIdHash', 'fulfillmentState',
        'fraudState', 'linkGenerationCount', 'linkGenerationLimit',
        'membershipState', 'messageCode', 'outcome', 'allInCostCents',
        'processingStatus', 'reasonCode', 'resourceType', 'resultCount',
        'rewardRoute', 'rewardValueCents', 'selectionOrder', 'statusCode',
        'totalEntryCount', 'workerOutcome'
      ]::text[])
      or jsonb_typeof(item.item_value) not in ('null', 'boolean', 'number', 'string')
      or (jsonb_typeof(item.item_value) = 'string' and char_length(item.item_value #>> '{}') > 200)
    );
$$;

create table public.raffle_audit_events (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references public.raffle_cycles(id) on delete restrict,
  draw_id uuid references public.raffle_draws(id) on delete restrict,
  draw_result_id uuid references public.raffle_draw_results(id) on delete restrict,
  member_id uuid references public.member_profiles(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  event_type text not null,
  dedupe_key text,
  event_at timestamptz not null default now(),
  sanitized_data jsonb not null default '{}'::jsonb,
  event_hash text,
  created_at timestamptz not null default now(),
  constraint raffle_audit_events_type_check check (event_type ~ '^[a-z0-9_]{2,100}$'),
  constraint raffle_audit_events_dedupe_check check (dedupe_key is null or (char_length(dedupe_key) between 8 and 200 and dedupe_key ~ '^[a-z0-9:_-]+$')),
  constraint raffle_audit_events_dedupe_key unique (dedupe_key),
  constraint raffle_audit_events_hash_check check (event_hash is null or event_hash ~ '^[0-9a-f]{64}$'),
  constraint raffle_audit_events_safe_data_check check (public.raffle_audit_data_is_safe(sanitized_data))
);

comment on table public.raffle_audit_events is
  'Append-only redacted prize-draw audit events. Raw requests, secrets, recipient data, links, and provider bodies are prohibited.';

create index raffle_audit_events_cycle_idx on public.raffle_audit_events (cycle_id, event_at desc);
create index raffle_audit_events_draw_idx on public.raffle_audit_events (draw_id, event_at desc) where draw_id is not null;
create index raffle_audit_events_result_idx on public.raffle_audit_events (draw_result_id, event_at desc) where draw_result_id is not null;
create index raffle_audit_events_member_idx on public.raffle_audit_events (member_id, event_at desc) where member_id is not null;
create index raffle_audit_events_actor_idx on public.raffle_audit_events (actor_id, event_at desc) where actor_id is not null;

create or replace function public.raffle_country_products_are_safe(
  value jsonb,
  country_codes text[],
  product_ids text[]
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select
    jsonb_typeof(value) = 'object'
    and array_position(country_codes, null) is null
    and array_position(product_ids, null) is null
    and not exists (
      select 1
      from jsonb_each(value) country(country_code, country_products)
      where country.country_code !~ '^[A-Z]{2}$'
        or not (country.country_code = any(country_codes))
        or jsonb_typeof(country.country_products) <> 'array'
        or jsonb_array_length(country.country_products) = 0
        or exists (
          select 1
          from jsonb_array_elements(country.country_products) product(product_value)
          where jsonb_typeof(product.product_value) <> 'string'
            or (product.product_value #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
            or not ((product.product_value #>> '{}') = any(product_ids))
        )
    )
    and not exists (
      select 1 from unnest(country_codes) as countries(country_code)
      where not (value ? country_code)
    )
    and not exists (
      select 1 from unnest(product_ids) as products(product_id)
      where product_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
        or not exists (
          select 1
          from jsonb_each(value) country(country_code, country_products)
          where country.country_products ? product_id
        )
    );
$$;

create table public.raffle_provider_configs (
  id uuid primary key default gen_random_uuid(),
  environment text not null unique,
  status text not null default 'disabled',
  orders_enabled boolean not null default false,
  expected_organization_id text,
  campaign_id text,
  configuration_hash text,
  reviewed_product_ids text[] not null default '{}'::text[],
  reviewed_country_products jsonb not null default '{}'::jsonb,
  approved_country_codes text[] not null default '{}'::text[],
  minimum_reward_value_cents integer not null default 1000,
  maximum_reward_value_cents integer not null default 5000,
  reward_currency text not null default 'USD',
  cycle_cost_ceiling_cents integer not null default 5000,
  balance_reserve_cents integer not null default 5000,
  balance_ceiling_cents integer not null default 10000,
  written_use_case_approved_at timestamptz,
  link_delivery_approved_at timestamptz,
  production_access_approved_at timestamptz,
  campaign_reviewed_at timestamptz,
  catalog_reviewed_at timestamptz,
  funding_reviewed_at timestamptz,
  webhook_verified_at timestamptz,
  fixed_egress_relay_verified_at timestamptz,
  api_key_ip_restriction_verified_at timestamptz,
  production_canary_verified_at timestamptz,
  last_readiness_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffle_provider_configs_environment_check check (environment in ('sandbox', 'production')),
  constraint raffle_provider_configs_status_check check (status in ('disabled', 'readiness', 'active', 'suspended')),
  constraint raffle_provider_configs_identifiers_check check (
    (expected_organization_id is null or char_length(expected_organization_id) between 1 and 200)
    and (campaign_id is null or char_length(campaign_id) between 1 and 200)
    and (configuration_hash is null or configuration_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint raffle_provider_configs_values_check check (
    minimum_reward_value_cents = 1000
    and maximum_reward_value_cents = 5000
    and reward_currency = 'USD'
    and cycle_cost_ceiling_cents = 5000
    and balance_reserve_cents = 5000
    and balance_ceiling_cents = 10000
  ),
  constraint raffle_provider_configs_country_products_check check (
    public.raffle_country_products_are_safe(
      reviewed_country_products,
      approved_country_codes,
      reviewed_product_ids
    )
  ),
  constraint raffle_provider_configs_active_check check (
    not orders_enabled
    or (
      status = 'active'
      and expected_organization_id is not null
      and campaign_id is not null
      and configuration_hash is not null
      and cardinality(reviewed_product_ids) > 0
      and cardinality(approved_country_codes) > 0
      and written_use_case_approved_at is not null
      and link_delivery_approved_at is not null
      and campaign_reviewed_at is not null
      and catalog_reviewed_at is not null
      and funding_reviewed_at is not null
      and webhook_verified_at is not null
      and (
        environment = 'sandbox'
        or (
          production_access_approved_at is not null
          and fixed_egress_relay_verified_at is not null
          and api_key_ip_restriction_verified_at is not null
          and production_canary_verified_at is not null
        )
      )
    )
  )
);

comment on table public.raffle_provider_configs is
  'Private environment readiness. Orders are disabled unless every reviewed dependency is present.';

create unique index raffle_provider_configs_single_orders_enabled_idx
on public.raffle_provider_configs ((orders_enabled))
where orders_enabled;

create or replace function public.invalidate_raffle_provider_approvals()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.expected_organization_id is distinct from new.expected_organization_id
    or old.campaign_id is distinct from new.campaign_id
    or old.configuration_hash is distinct from new.configuration_hash
    or old.reviewed_product_ids is distinct from new.reviewed_product_ids
    or old.reviewed_country_products is distinct from new.reviewed_country_products
    or old.approved_country_codes is distinct from new.approved_country_codes
    or old.minimum_reward_value_cents is distinct from new.minimum_reward_value_cents
    or old.maximum_reward_value_cents is distinct from new.maximum_reward_value_cents
    or old.reward_currency is distinct from new.reward_currency
    or old.cycle_cost_ceiling_cents is distinct from new.cycle_cost_ceiling_cents
    or old.balance_reserve_cents is distinct from new.balance_reserve_cents
    or old.balance_ceiling_cents is distinct from new.balance_ceiling_cents then
    new.status := 'readiness';
    new.orders_enabled := false;
    new.written_use_case_approved_at := null;
    new.link_delivery_approved_at := null;
    new.production_access_approved_at := null;
    new.campaign_reviewed_at := null;
    new.catalog_reviewed_at := null;
    new.funding_reviewed_at := null;
    new.webhook_verified_at := null;
    new.fixed_egress_relay_verified_at := null;
    new.api_key_ip_restriction_verified_at := null;
    new.production_canary_verified_at := null;
    new.last_readiness_check_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists invalidate_raffle_provider_approvals_on_drift
on public.raffle_provider_configs;
create trigger invalidate_raffle_provider_approvals_on_drift
before update on public.raffle_provider_configs
for each row execute function public.invalidate_raffle_provider_approvals();

create table public.raffle_fulfillment_jobs (
  id uuid primary key default gen_random_uuid(),
  draw_result_id uuid not null unique references public.raffle_draw_results(id) on delete restrict,
  cycle_id uuid not null references public.raffle_cycles(id) on delete restrict,
  provider_config_id uuid not null references public.raffle_provider_configs(id) on delete restrict,
  provider_configuration_hash text not null,
  campaign_id text not null,
  state text not null default 'awaiting_clearance',
  external_id text not null unique,
  country_code text not null,
  reward_value_cents integer not null default 1000,
  reward_currency text not null default 'USD',
  all_in_cost_cap_cents integer not null default 5000,
  product_ids text[] not null default '{}'::text[],
  request_hash text,
  provider_order_id text,
  provider_reward_id text,
  sanitized_status text,
  sanitized_error_code text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  link_generation_count integer not null default 0,
  link_generation_limit integer not null default 5,
  last_link_generated_at timestamptz,
  link_generation_unlocked_at timestamptz,
  link_generation_unlocked_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffle_fulfillment_jobs_identity_key unique (id, cycle_id),
  constraint raffle_fulfillment_jobs_result_cycle_fk
    foreign key (draw_result_id, cycle_id)
    references public.raffle_draw_results(id, cycle_id) on delete restrict,
  constraint raffle_fulfillment_jobs_state_check check (state in ('awaiting_clearance', 'ready', 'claimed', 'submitting', 'reconciling', 'succeeded', 'retryable', 'failed', 'cancelled', 'dead_letter')),
  constraint raffle_fulfillment_jobs_external_id_check check (
    external_id ~ '^mochirii-mpd-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-v1$'
  ),
  constraint raffle_fulfillment_jobs_config_snapshot_check check (
    provider_configuration_hash ~ '^[0-9a-f]{64}$'
    and campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  constraint raffle_fulfillment_jobs_country_check check (country_code ~ '^[A-Z]{2}$'),
  constraint raffle_fulfillment_jobs_value_check check (
    reward_value_cents between 1000 and 5000
    and reward_value_cents % 100 = 0
    and reward_currency = 'USD'
    and all_in_cost_cap_cents = 5000
  ),
  constraint raffle_fulfillment_jobs_hash_check check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$'),
  constraint raffle_fulfillment_jobs_attempts_check check (attempt_count between 0 and 20),
  constraint raffle_fulfillment_jobs_lock_check check (
    (locked_by is null and locked_at is null and lock_expires_at is null)
    or (locked_by is not null and locked_at is not null and lock_expires_at > locked_at)
  ),
  constraint raffle_fulfillment_jobs_link_limit_check check (
    link_generation_count >= 0
    and link_generation_limit between 5 and 10
    and link_generation_count <= link_generation_limit
    and (
      link_generation_limit = 5
      or (link_generation_unlocked_at is not null and link_generation_unlocked_by is not null)
    )
  ),
  constraint raffle_fulfillment_jobs_submission_check check (
    state not in ('submitting', 'reconciling', 'succeeded')
    or cardinality(product_ids) > 0
  )
);

comment on table public.raffle_fulfillment_jobs is
  'Private, idempotent fulfillment state. Reward links and recipient contact data must never be persisted here.';

create index raffle_fulfillment_jobs_due_idx on public.raffle_fulfillment_jobs (state, next_attempt_at, created_at)
where state in ('ready', 'retryable', 'reconciling', 'claimed');
create index raffle_fulfillment_jobs_cycle_idx on public.raffle_fulfillment_jobs (cycle_id, state);
create index raffle_fulfillment_jobs_provider_config_idx on public.raffle_fulfillment_jobs (provider_config_id, state);
create index raffle_fulfillment_jobs_unlock_actor_idx on public.raffle_fulfillment_jobs (link_generation_unlocked_by) where link_generation_unlocked_by is not null;
create unique index raffle_fulfillment_jobs_provider_order_key on public.raffle_fulfillment_jobs (provider_config_id, provider_order_id)
where provider_order_id is not null;
create unique index raffle_fulfillment_jobs_provider_reward_key on public.raffle_fulfillment_jobs (provider_config_id, provider_reward_id)
where provider_reward_id is not null;

create table public.raffle_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_config_id uuid not null references public.raffle_provider_configs(id) on delete restrict,
  provider_event_uuid uuid not null unique,
  event_type text not null,
  resource_type text,
  resource_reference text,
  environment text not null,
  occurred_at timestamptz,
  body_sha256 text not null,
  processing_status text not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  sanitized_error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffle_provider_events_environment_check check (environment in ('sandbox', 'production')),
  constraint raffle_provider_events_type_check check (char_length(event_type) between 1 and 160),
  constraint raffle_provider_events_resource_check check (
    (resource_type is null or char_length(resource_type) between 1 and 100)
    and (resource_reference is null or char_length(resource_reference) between 1 and 200)
  ),
  constraint raffle_provider_events_body_hash_check check (body_sha256 ~ '^[0-9a-f]{64}$'),
  constraint raffle_provider_events_status_check check (processing_status in ('queued', 'processing', 'processed', 'ignored', 'failed', 'dead_letter')),
  constraint raffle_provider_events_attempts_check check (attempt_count between 0 and 50),
  constraint raffle_provider_events_lock_check check (
    (locked_by is null and locked_at is null and lock_expires_at is null)
    or (locked_by is not null and locked_at is not null and lock_expires_at > locked_at)
  )
);

comment on table public.raffle_provider_events is
  'Deduplicated redacted event envelopes only; raw bodies, signatures, and provider responses are never stored.';

create index raffle_provider_events_queue_idx on public.raffle_provider_events (processing_status, next_attempt_at, received_at)
where processing_status in ('queued', 'failed', 'processing');
create index raffle_provider_events_config_idx on public.raffle_provider_events (provider_config_id, received_at desc);

insert into public.raffle_provider_configs (environment, status, orders_enabled)
values
  ('sandbox', 'disabled', false),
  ('production', 'disabled', false)
on conflict (environment) do nothing;

-- Once the canonical ledger is frozen, neither its entry rows nor its bonus
-- rows may be rewritten, even by an accidental service-role code path.
create or replace function public.prevent_raffle_frozen_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  old_cycle_status text;
  new_cycle_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into old_cycle_status
    from public.raffle_cycles
    where id = old.cycle_id;
    if old_cycle_status is null then
      raise exception 'raffle_ledger_cycle_not_found';
    end if;
    if old_cycle_status in ('frozen', 'drawn', 'complete', 'void') then
      raise exception 'raffle_frozen_ledger_is_immutable';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select status into new_cycle_status
    from public.raffle_cycles
    where id = new.cycle_id;
    if new_cycle_status is null then
      raise exception 'raffle_ledger_cycle_not_found';
    end if;
    if new_cycle_status in ('frozen', 'drawn', 'complete', 'void') then
      raise exception 'raffle_frozen_ledger_is_immutable';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if tg_table_name = 'raffle_entries' then
      if row(old.id, old.cycle_id, old.member_id)
        is distinct from row(new.id, new.cycle_id, new.member_id) then
        raise exception 'raffle_ledger_identity_is_immutable';
      end if;
    elsif tg_table_name = 'raffle_bonus_awards' then
      if row(old.id, old.cycle_id, old.entry_id, old.member_id, old.bonus_key)
        is distinct from row(
          new.id, new.cycle_id, new.entry_id, new.member_id, new.bonus_key
        ) then
        raise exception 'raffle_ledger_identity_is_immutable';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists prevent_raffle_frozen_entry_mutation
on public.raffle_entries;
create trigger prevent_raffle_frozen_entry_mutation
before insert or update or delete on public.raffle_entries
for each row execute function public.prevent_raffle_frozen_ledger_mutation();

drop trigger if exists prevent_raffle_frozen_bonus_mutation
on public.raffle_bonus_awards;
create trigger prevent_raffle_frozen_bonus_mutation
before insert or update or delete on public.raffle_bonus_awards
for each row execute function public.prevent_raffle_frozen_ledger_mutation();

-- Once a cycle leaves draft, its approved legal/schedule/rules/privacy/country
-- and prize contract is immutable. Operational state, recorded counts and
-- lifecycle timestamps may advance only through the documented state graph.
create or replace function public.prevent_raffle_cycle_contract_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'raffle_cycle_contract_is_immutable';
    end if;
    return old;
  end if;

  if old.status <> 'draft' and row(
    old.id, old.public_cycle_id, old.opens_at, old.closes_at, old.draw_at,
    old.expires_at, old.timezone, old.sponsor_display_name,
    old.public_reward_label, old.rules_version, old.rules_version_url,
    old.rules_content_hash, old.privacy_version, old.privacy_content_hash,
    old.country_matrix_version, old.country_matrix_hash,
    old.approved_country_codes, old.base_entries, old.max_bonus_entries,
    old.max_entries, old.claim_window_days, old.award_window_days,
    old.minimum_eligible_entrants, old.reward_value_cents,
    old.cycle_cost_ceiling_cents, old.in_game_reward_enabled,
    old.in_game_privacy_reviewed_at, old.in_game_privacy_reviewed_by,
    old.sponsor_approved, old.rules_approved,
    old.country_matrix_approved, old.reward_approved,
    old.privacy_approved, old.tax_approved, old.operations_approved,
    old.created_by, old.created_at
  ) is distinct from row(
    new.id, new.public_cycle_id, new.opens_at, new.closes_at, new.draw_at,
    new.expires_at, new.timezone, new.sponsor_display_name,
    new.public_reward_label, new.rules_version, new.rules_version_url,
    new.rules_content_hash, new.privacy_version, new.privacy_content_hash,
    new.country_matrix_version, new.country_matrix_hash,
    new.approved_country_codes, new.base_entries, new.max_bonus_entries,
    new.max_entries, new.claim_window_days, new.award_window_days,
    new.minimum_eligible_entrants, new.reward_value_cents,
    new.cycle_cost_ceiling_cents, new.in_game_reward_enabled,
    new.in_game_privacy_reviewed_at, new.in_game_privacy_reviewed_by,
    new.sponsor_approved, new.rules_approved,
    new.country_matrix_approved, new.reward_approved,
    new.privacy_approved, new.tax_approved, new.operations_approved,
    new.created_by, new.created_at
  ) then
    raise exception 'raffle_cycle_contract_is_immutable';
  end if;

  if old.status is distinct from new.status and not (
    (old.status = 'draft' and new.status in ('ready', 'blocked', 'void'))
    or (old.status = 'ready' and new.status in ('open', 'blocked', 'void'))
    or (old.status = 'open' and new.status in ('frozen', 'blocked', 'void'))
    or (old.status = 'frozen' and new.status in ('drawn', 'void'))
    or (old.status = 'drawn' and new.status in ('complete', 'void'))
    or (old.status = 'blocked' and new.status in ('ready', 'void'))
  ) then
    raise exception 'raffle_cycle_status_transition_invalid';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_raffle_cycle_contract_mutation
on public.raffle_cycles;
create trigger prevent_raffle_cycle_contract_mutation
before update or delete on public.raffle_cycles
for each row execute function public.prevent_raffle_cycle_contract_mutation();

-- Frozen draw foundations never change. The committed ledger hash becomes
-- immutable when first set; seed/result evidence may only be populated by the
-- one-way frozen-to-drawn transition and may never be erased or rewritten.
create or replace function public.prevent_raffle_draw_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if current_user not in ('postgres', 'supabase_admin') then
      raise exception 'raffle_draw_service_boundary_required';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'raffle_draw_evidence_is_immutable';
  end if;

  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'raffle_draw_service_boundary_required';
  end if;

  if row(
    old.id, old.cycle_id, old.ledger_salt, old.algorithm_version,
    old.entrant_count, old.total_entry_count, old.frozen_at,
    old.initiated_by, old.created_at
  ) is distinct from row(
    new.id, new.cycle_id, new.ledger_salt, new.algorithm_version,
    new.entrant_count, new.total_entry_count, new.frozen_at,
    new.initiated_by, new.created_at
  ) then
    raise exception 'raffle_draw_evidence_is_immutable';
  end if;

  if (old.ledger_hash is not null and old.ledger_hash is distinct from new.ledger_hash)
    or (old.seed_hex is not null and old.seed_hex is distinct from new.seed_hex)
    or (old.seed_hash is not null and old.seed_hash is distinct from new.seed_hash)
    or (old.drawn_at is not null and old.drawn_at is distinct from new.drawn_at)
    or (old.completed_by is not null and old.completed_by is distinct from new.completed_by) then
    raise exception 'raffle_draw_evidence_is_immutable';
  end if;

  if old.status is distinct from new.status and not (
    (old.status = 'frozen' and new.status in ('drawn', 'void'))
    or (old.status = 'drawn' and new.status = 'void')
  ) then
    raise exception 'raffle_draw_status_transition_invalid';
  end if;

  if new.status = 'frozen' and (
    new.drawn_at is not null or new.completed_by is not null
    or (new.ledger_hash is null) <> (new.seed_hex is null)
    or (new.ledger_hash is null) <> (new.seed_hash is null)
  ) then
    raise exception 'raffle_draw_commitment_incomplete';
  end if;

  if new.status = 'drawn' and (
    new.ledger_hash is null or new.seed_hex is null or new.seed_hash is null
    or new.drawn_at is null or new.completed_by is null
  ) then
    raise exception 'raffle_draw_evidence_incomplete';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_raffle_draw_evidence_mutation
on public.raffle_draws;
create trigger prevent_raffle_draw_evidence_mutation
before insert or update or delete on public.raffle_draws
for each row execute function public.prevent_raffle_draw_evidence_mutation();

-- Claim, notice, consent, review and fulfillment state may advance, but the
-- recorded selected member, role, ordinal and pseudonym can never be replaced.
create or replace function public.prevent_raffle_result_selection_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if current_user not in ('postgres', 'supabase_admin') then
      raise exception 'raffle_result_service_boundary_required';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'raffle_result_selection_is_immutable';
  end if;

  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'raffle_result_service_boundary_required';
  end if;

  if row(
    old.id, old.draw_id, old.cycle_id, old.member_id, old.result_kind,
    old.selection_order, old.entry_ordinal, old.pseudonymous_member_id,
    old.alternate_rank, old.created_at
  ) is distinct from row(
    new.id, new.draw_id, new.cycle_id, new.member_id, new.result_kind,
    new.selection_order, new.entry_ordinal, new.pseudonymous_member_id,
    new.alternate_rank, new.created_at
  ) then
    raise exception 'raffle_result_selection_is_immutable';
  end if;

  if old.status is distinct from new.status and not (
    (old.status = 'selected' and new.status in (
      'contacted', 'claimed', 'declined', 'expired', 'ineligible', 'void'
    ))
    or (old.status = 'contacted' and new.status in (
      'claimed', 'declined', 'expired', 'ineligible', 'void'
    ))
    or (old.status = 'claimed' and new.status in (
      'fulfilled', 'ineligible', 'void'
    ))
  ) then
    raise exception 'raffle_result_status_transition_invalid';
  end if;

  if (old.claim_opened_at is not null
      and old.claim_opened_at is distinct from new.claim_opened_at)
    or (old.claim_deadline is not null
      and old.claim_deadline is distinct from new.claim_deadline)
    or (old.claimed_at is not null
      and old.claimed_at is distinct from new.claimed_at)
    or (old.reward_route is not null
      and old.reward_route is distinct from new.reward_route)
    or (old.manual_fulfilled_at is not null
      and old.manual_fulfilled_at is distinct from new.manual_fulfilled_at)
    or (old.manual_fulfilled_by is not null
      and old.manual_fulfilled_by is distinct from new.manual_fulfilled_by)
    or (old.manual_all_in_cost_cents is not null
      and old.manual_all_in_cost_cents is distinct from new.manual_all_in_cost_cents) then
    raise exception 'raffle_manual_fulfillment_is_immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_raffle_result_selection_mutation
on public.raffle_draw_results;
create trigger prevent_raffle_result_selection_mutation
before insert or update or delete on public.raffle_draw_results
for each row execute function public.prevent_raffle_result_selection_mutation();

-- A fulfillment job is a durable snapshot of the exact approved provider,
-- campaign, recipient country, product subset, and gross prize. Operational
-- state can advance, but retries may never rewrite the payload binding.
create or replace function public.prevent_raffle_fulfillment_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'raffle_fulfillment_snapshot_is_immutable';
  end if;

  if row(
    old.id, old.draw_result_id, old.cycle_id, old.provider_config_id,
    old.provider_configuration_hash, old.campaign_id, old.external_id,
    old.country_code, old.reward_value_cents, old.reward_currency,
    old.all_in_cost_cap_cents,
    old.product_ids, old.created_at
  ) is distinct from row(
    new.id, new.draw_result_id, new.cycle_id, new.provider_config_id,
    new.provider_configuration_hash, new.campaign_id, new.external_id,
    new.country_code, new.reward_value_cents, new.reward_currency,
    new.all_in_cost_cap_cents,
    new.product_ids, new.created_at
  ) then
    raise exception 'raffle_fulfillment_snapshot_is_immutable';
  end if;

  if (old.request_hash is not null and old.request_hash is distinct from new.request_hash)
    or (old.provider_order_id is not null and old.provider_order_id is distinct from new.provider_order_id)
    or (old.provider_reward_id is not null and old.provider_reward_id is distinct from new.provider_reward_id) then
    raise exception 'raffle_fulfillment_binding_is_immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_raffle_fulfillment_snapshot_mutation
on public.raffle_fulfillment_jobs;
create trigger prevent_raffle_fulfillment_snapshot_mutation
before update or delete on public.raffle_fulfillment_jobs
for each row execute function public.prevent_raffle_fulfillment_snapshot_mutation();

create or replace function public.prevent_raffle_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'raffle_audit_events_are_append_only';
end;
$$;

drop trigger if exists prevent_raffle_audit_mutation
on public.raffle_audit_events;
create trigger prevent_raffle_audit_mutation
before update or delete on public.raffle_audit_events
for each row execute function public.prevent_raffle_audit_mutation();

-- Keep updated_at consistent without widening client privileges.
drop trigger if exists set_raffle_cycles_updated_at on public.raffle_cycles;
create trigger set_raffle_cycles_updated_at before update on public.raffle_cycles
for each row execute function public.set_updated_at();
drop trigger if exists set_raffle_entries_updated_at on public.raffle_entries;
create trigger set_raffle_entries_updated_at before update on public.raffle_entries
for each row execute function public.set_updated_at();
drop trigger if exists set_raffle_bonus_awards_updated_at on public.raffle_bonus_awards;
create trigger set_raffle_bonus_awards_updated_at before update on public.raffle_bonus_awards
for each row execute function public.set_updated_at();
drop trigger if exists set_raffle_draws_updated_at on public.raffle_draws;
create trigger set_raffle_draws_updated_at before update on public.raffle_draws
for each row execute function public.set_updated_at();
drop trigger if exists set_raffle_draw_results_updated_at on public.raffle_draw_results;
create trigger set_raffle_draw_results_updated_at before update on public.raffle_draw_results
for each row execute function public.set_updated_at();
drop trigger if exists set_raffle_provider_configs_updated_at on public.raffle_provider_configs;
create trigger set_raffle_provider_configs_updated_at before update on public.raffle_provider_configs
for each row execute function public.set_updated_at();
drop trigger if exists set_raffle_fulfillment_jobs_updated_at on public.raffle_fulfillment_jobs;
create trigger set_raffle_fulfillment_jobs_updated_at before update on public.raffle_fulfillment_jobs
for each row execute function public.set_updated_at();
drop trigger if exists set_raffle_provider_events_updated_at on public.raffle_provider_events;
create trigger set_raffle_provider_events_updated_at before update on public.raffle_provider_events
for each row execute function public.set_updated_at();

-- Revalidate mutable provider state at the exact ready-to-open transition.
-- A stale, suspended, ambiguous, sandbox, or country-incompatible provider
-- configuration blocks the cycle instead of trusting an earlier boolean.
create or replace function public.open_raffle_cycle(
  p_cycle_id uuid,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  config_row public.raffle_provider_configs%rowtype;
  enabled_config_count integer;
  reason_code text;
begin
  perform private.assert_raffle_service_caller();
  select * into cycle_row from public.raffle_cycles
  where id = p_cycle_id for update;
  if not found then raise exception 'raffle_cycle_not_found'; end if;

  if cycle_row.status = 'open' then
    return jsonb_build_object(
      'opened', true, 'cycleStatus', 'open', 'duplicate', true
    );
  end if;
  if cycle_row.status <> 'ready' then
    return jsonb_build_object(
      'opened', false, 'cycleStatus', cycle_row.status,
      'reasonCode', 'cycle_not_ready', 'duplicate', false
    );
  end if;
  if p_now < cycle_row.opens_at or p_now >= cycle_row.closes_at then
    return jsonb_build_object(
      'opened', false, 'cycleStatus', cycle_row.status,
      'reasonCode', 'outside_entry_window', 'duplicate', false
    );
  end if;

  select count(*)::integer into enabled_config_count
  from public.raffle_provider_configs
  where status = 'active' and orders_enabled;

  if enabled_config_count <> 1 then
    reason_code := 'provider_configuration_count';
  else
    select * into config_row from public.raffle_provider_configs
    where status = 'active' and orders_enabled
    for update;

    if config_row.environment <> 'production' then
      reason_code := 'provider_environment_not_production';
    elsif config_row.last_readiness_check_at is null
      or config_row.last_readiness_check_at < greatest(
        cycle_row.opens_at - interval '24 hours',
        p_now - interval '24 hours'
      )
      or config_row.last_readiness_check_at > p_now + interval '5 minutes' then
      reason_code := 'provider_readiness_stale';
    elsif config_row.minimum_reward_value_cents <> 1000
      or config_row.maximum_reward_value_cents <> 5000
      or config_row.reward_currency <> 'USD'
      or config_row.cycle_cost_ceiling_cents <> 5000
      or config_row.balance_reserve_cents <> 5000
      or config_row.balance_ceiling_cents <> 10000
      or cycle_row.reward_value_cents < config_row.minimum_reward_value_cents
      or cycle_row.reward_value_cents > config_row.maximum_reward_value_cents
      or cycle_row.reward_value_cents % 100 <> 0
      or cycle_row.cycle_cost_ceiling_cents <> config_row.cycle_cost_ceiling_cents then
      reason_code := 'provider_reward_contract_mismatch';
    elsif cardinality(cycle_row.approved_country_codes) = 0
      or not (cycle_row.approved_country_codes <@ config_row.approved_country_codes) then
      reason_code := 'provider_country_coverage_incomplete';
    end if;
  end if;

  if reason_code is not null then
    update public.raffle_cycles
    set status = 'blocked', void_reason_code = reason_code, updated_at = p_now
    where id = cycle_row.id and status = 'ready';

    insert into public.raffle_audit_events (
      cycle_id, actor_id, event_type, event_at, sanitized_data
    ) values (
      cycle_row.id, p_actor_id, 'cycle_open_blocked', p_now,
      jsonb_build_object('cycleStatus', 'blocked', 'reasonCode', reason_code)
    );

    return jsonb_build_object(
      'opened', false, 'cycleStatus', 'blocked',
      'reasonCode', reason_code, 'duplicate', false
    );
  end if;

  update public.raffle_cycles
  set status = 'open', opened_at = p_now, void_reason_code = null,
      updated_at = p_now
  where id = cycle_row.id and status = 'ready';

  insert into public.raffle_audit_events (
    cycle_id, actor_id, event_type, event_at, sanitized_data
  ) values (
    cycle_row.id, p_actor_id, 'cycle_opened', p_now,
    jsonb_build_object('cycleStatus', 'open', 'outcome', 'opened')
  );

  return jsonb_build_object(
    'opened', true, 'cycleStatus', 'open', 'duplicate', false
  );
end;
$$;

create or replace function public.review_raffle_entry_eligibility(
  p_cycle_id uuid,
  p_member_id uuid,
  p_decision text,
  p_exclusion_type text,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  entry_row public.raffle_entries%rowtype;
  profile_row public.member_profiles%rowtype;
  baseline_reason text;
  clearance_status text;
  eligibility_state text;
  reason_code text;
begin
  perform private.assert_raffle_service_caller();
  if p_actor_id is null
    or p_decision not in ('clear', 'exclude')
    or (p_decision = 'exclude' and p_exclusion_type not in ('administrator', 'household'))
    or (p_decision = 'clear' and coalesce(p_exclusion_type, '') <> '') then
    raise exception 'invalid_eligibility_review';
  end if;

  select * into cycle_row from public.raffle_cycles
  where id = p_cycle_id for update;
  select * into entry_row from public.raffle_entries
  where cycle_id = p_cycle_id and member_id = p_member_id for update;
  select * into profile_row from public.member_profiles
  where id = p_member_id for share;

  if cycle_row.id is null or cycle_row.status <> 'open'
    or p_now < cycle_row.opens_at or p_now >= cycle_row.closes_at then
    raise exception 'raffle_entry_window_closed';
  end if;
  if entry_row.id is null or entry_row.withdrawn_at is not null
    or profile_row.id is null then
    raise exception 'raffle_entry_not_reviewable';
  end if;

  if '1078630751165222984' = any(profile_row.discord_roles) then
    baseline_reason := 'administrator_ineligible';
  elsif profile_row.member_status <> 'active' then
    baseline_reason := 'member_not_in_good_standing';
  elsif not profile_row.has_required_discord_roles then
    baseline_reason := 'guild_membership_not_verified';
  elsif profile_row.discord_verified_at is null
    or profile_row.discord_verified_at < p_now - interval '7 days'
    or profile_row.discord_verified_at > p_now + interval '5 minutes' then
    baseline_reason := 'guild_verification_stale';
  elsif entry_row.rules_accepted_at is null then
    baseline_reason := 'rules_acceptance_required';
  elsif not entry_row.age_18_affirmed then
    baseline_reason := 'age_affirmation_required';
  elsif entry_row.country_code is null then
    baseline_reason := 'residence_country_required';
  elsif not (entry_row.country_code = any(cycle_row.approved_country_codes)) then
    baseline_reason := 'country_not_eligible';
  else
    baseline_reason := 'eligible';
  end if;

  if baseline_reason = 'administrator_ineligible' then
    clearance_status := 'excluded';
    eligibility_state := 'ineligible';
    reason_code := 'administrator_ineligible';
  elsif p_decision = 'exclude' then
    clearance_status := 'excluded';
    eligibility_state := 'ineligible';
    reason_code := case p_exclusion_type
      when 'administrator' then 'administrator_ineligible'
      else 'administrator_household_ineligible'
    end;
  elsif baseline_reason = 'eligible' then
    clearance_status := 'cleared';
    eligibility_state := 'eligible';
    reason_code := 'administrator_household_cleared';
  else
    clearance_status := 'pending';
    eligibility_state := 'pending';
    reason_code := baseline_reason;
  end if;

  update public.raffle_entries
  set administrator_clearance_status = clearance_status,
      administrator_clearance_at = case when clearance_status = 'pending' then null else p_now end,
      administrator_clearance_by = case when clearance_status = 'pending' then null else p_actor_id end,
      administrator_clearance_reason_code = case when clearance_status = 'pending' then null else reason_code end,
      eligibility_status = eligibility_state,
      eligibility_reason_code = case when eligibility_state = 'eligible' then 'eligible' else reason_code end,
      base_entry_count = case when eligibility_state = 'eligible' then 1 else 0 end,
      eligibility_rules_version = cycle_row.rules_version,
      eligibility_country_matrix_version = cycle_row.country_matrix_version,
      eligibility_member_status = profile_row.member_status,
      eligibility_guild_verified = profile_row.has_required_discord_roles,
      updated_at = p_now
  where id = entry_row.id;

  insert into public.raffle_audit_events (
    cycle_id, member_id, actor_id, event_type, event_at, sanitized_data
  ) values (
    cycle_row.id, entry_row.member_id, p_actor_id, 'eligibility_reviewed', p_now,
    jsonb_build_object('reasonCode', reason_code)
  );

  return jsonb_build_object(
    'eligibilityState', case when eligibility_state = 'pending' then 'pending_review' else eligibility_state end,
    'reasonCode', reason_code
  );
end;
$$;

create or replace function public.manage_raffle_bonus_award(
  p_cycle_id uuid,
  p_member_id uuid,
  p_bonus_key text,
  p_completion_method text,
  p_evidence_hash text,
  p_revoke boolean,
  p_revocation_reason_code text,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  entry_row public.raffle_entries%rowtype;
  bonus_row public.raffle_bonus_awards%rowtype;
  affected_id uuid;
begin
  perform private.assert_raffle_service_caller();
  if p_actor_id is null
    or p_revoke is null
    or p_bonus_key not in (
      'scheduled_activity', 'monthly_gathering', 'help_session',
      'social_media_share', 'guild_feedback', 'member_welcome',
      'member_recruitment', 'creative_hobby_share',
      'member_spotlight_nomination'
    )
    or p_completion_method not in ('primary', 'alternative')
    or (not p_revoke and coalesce(p_evidence_hash, '') !~ '^[0-9a-f]{64}$')
    or (p_revoke and coalesce(p_revocation_reason_code, '') !~ '^[a-z0-9_]{2,80}$') then
    raise exception 'invalid_bonus_award_request';
  end if;

  select * into cycle_row from public.raffle_cycles
  where id = p_cycle_id for update;
  select * into entry_row from public.raffle_entries
  where cycle_id = p_cycle_id and member_id = p_member_id for update;
  if cycle_row.id is null or cycle_row.status <> 'open'
    or p_now < cycle_row.opens_at or p_now >= cycle_row.closes_at then
    raise exception 'raffle_entry_window_closed';
  end if;
  if entry_row.id is null or entry_row.eligibility_status <> 'eligible'
    or entry_row.withdrawn_at is not null then
    raise exception 'eligible_entry_required';
  end if;

  select * into bonus_row from public.raffle_bonus_awards
  where entry_id = entry_row.id and bonus_key = p_bonus_key for update;

  if not p_revoke then
    insert into public.raffle_bonus_awards (
      cycle_id, entry_id, member_id, bonus_key, completion_method,
      source_reference_hash, awarded_at, awarded_by,
      revoked_at, revoked_by, revocation_reason_code, updated_at
    ) values (
      cycle_row.id, entry_row.id, entry_row.member_id, p_bonus_key,
      p_completion_method, p_evidence_hash, p_now, p_actor_id,
      null, null, null, p_now
    )
    on conflict (entry_id, bonus_key) do update
    set completion_method = excluded.completion_method,
        source_reference_hash = excluded.source_reference_hash,
        awarded_at = excluded.awarded_at,
        awarded_by = excluded.awarded_by,
        revoked_at = null, revoked_by = null,
        revocation_reason_code = null, updated_at = excluded.updated_at
    returning id into affected_id;
  else
    update public.raffle_bonus_awards
    set revoked_at = p_now, revoked_by = p_actor_id,
        revocation_reason_code = p_revocation_reason_code,
        updated_at = p_now
    where entry_id = entry_row.id and bonus_key = p_bonus_key
      and revoked_at is null
    returning id into affected_id;
    if affected_id is null then raise exception 'bonus_award_not_active'; end if;
  end if;

  insert into public.raffle_audit_events (
    cycle_id, member_id, actor_id, event_type, event_at, sanitized_data
  ) values (
    cycle_row.id, entry_row.member_id, p_actor_id,
    case when p_revoke then 'bonus_revoked' else 'bonus_awarded' end,
    p_now,
    jsonb_build_object(
      'bonusKey', p_bonus_key,
      'completionMethod', case when p_revoke then bonus_row.completion_method else p_completion_method end,
      'outcome', case when p_revoke then 'revoked' else 'awarded' end
    )
  );

  return jsonb_build_object(
    'outcome', case when p_revoke then 'revoked' else 'awarded' end
  );
end;
$$;

create or replace function public.manage_raffle_member_entry(
  p_cycle_id uuid,
  p_member_id uuid,
  p_actor_id uuid,
  p_action text,
  p_country_code text,
  p_age_18_affirmed boolean,
  p_rules_accepted boolean,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  entry_row public.raffle_entries%rowtype;
  profile_row public.member_profiles%rowtype;
  baseline_reason text;
  resulting_status text;
  resulting_reason text;
  clearance_status text;
begin
  perform private.assert_raffle_service_caller();
  if p_member_id is null or p_actor_id is distinct from p_member_id
    or p_action not in ('opt_in', 'withdraw') then
    raise exception 'invalid_member_entry_request';
  end if;

  select * into cycle_row from public.raffle_cycles
  where id = p_cycle_id for update;
  select * into entry_row from public.raffle_entries
  where cycle_id = p_cycle_id and member_id = p_member_id for update;
  select * into profile_row from public.member_profiles
  where id = p_member_id for share;
  if cycle_row.id is null or cycle_row.status <> 'open'
    or p_now < cycle_row.opens_at or p_now >= cycle_row.closes_at then
    raise exception 'raffle_entry_window_closed';
  end if;
  if profile_row.id is null then raise exception 'member_profile_required'; end if;

  if p_action = 'withdraw' then
    if entry_row.id is null
      or entry_row.eligibility_status not in ('pending', 'eligible', 'ineligible')
      or entry_row.withdrawn_at is not null then
      raise exception 'entry_not_withdrawable';
    end if;
    update public.raffle_entries
    set eligibility_status = 'withdrawn',
        eligibility_reason_code = 'member_withdrew',
        withdrawn_at = p_now, base_entry_count = 0, updated_at = p_now
    where id = entry_row.id;
    insert into public.raffle_audit_events (
      cycle_id, member_id, actor_id, event_type, event_at, sanitized_data
    ) values (
      cycle_row.id, p_member_id, p_member_id, 'entry_withdrawn', p_now,
      jsonb_build_object('outcome', 'withdrawn')
    );
    return jsonb_build_object(
      'eligibilityState', 'ineligible',
      'reasonCode', 'member_withdrew',
      'outcome', 'withdrawn'
    );
  end if;

  if '1078630751165222984' = any(profile_row.discord_roles) then
    baseline_reason := 'administrator_ineligible';
  elsif not coalesce(p_rules_accepted, false) then
    baseline_reason := 'rules_acceptance_required';
  elsif profile_row.member_status <> 'active' then
    baseline_reason := 'member_not_in_good_standing';
  elsif not profile_row.has_required_discord_roles then
    baseline_reason := 'guild_membership_not_verified';
  elsif profile_row.discord_verified_at is null
    or profile_row.discord_verified_at < p_now - interval '7 days'
    or profile_row.discord_verified_at > p_now + interval '5 minutes' then
    baseline_reason := 'guild_verification_stale';
  elsif not coalesce(p_age_18_affirmed, false) then
    baseline_reason := 'age_affirmation_required';
  elsif coalesce(p_country_code, '') !~ '^[A-Z]{2}$' then
    baseline_reason := 'residence_country_required';
  elsif not (p_country_code = any(cycle_row.approved_country_codes)) then
    baseline_reason := 'country_not_eligible';
  else
    baseline_reason := 'eligible';
  end if;

  clearance_status := coalesce(entry_row.administrator_clearance_status, 'pending');
  if baseline_reason = 'eligible' and clearance_status = 'cleared' then
    resulting_status := 'eligible';
    resulting_reason := 'eligible';
  elsif baseline_reason = 'eligible' and clearance_status = 'pending' then
    resulting_status := 'pending';
    resulting_reason := 'administrator_clearance_required';
  elsif clearance_status = 'excluded' then
    resulting_status := 'ineligible';
    resulting_reason := coalesce(
      entry_row.administrator_clearance_reason_code,
      'administrator_ineligible'
    );
  else
    resulting_status := 'ineligible';
    resulting_reason := baseline_reason;
  end if;

  insert into public.raffle_entries (
    cycle_id, member_id, eligibility_status, eligibility_reason_code,
    country_code, age_18_affirmed, rules_accepted_at, opted_in_at,
    withdrawn_at, base_entry_count, eligibility_rules_version,
    eligibility_country_matrix_version, eligibility_member_status,
    eligibility_guild_verified, updated_at
  ) values (
    cycle_row.id, p_member_id, resulting_status, resulting_reason,
    case when coalesce(p_country_code, '') ~ '^[A-Z]{2}$' then p_country_code else null end,
    coalesce(p_age_18_affirmed, false),
    case when coalesce(p_rules_accepted, false) then p_now else null end,
    p_now, null, case when resulting_status = 'eligible' then 1 else 0 end,
    cycle_row.rules_version, cycle_row.country_matrix_version,
    profile_row.member_status, profile_row.has_required_discord_roles, p_now
  )
  on conflict (cycle_id, member_id) do update
  set eligibility_status = excluded.eligibility_status,
      eligibility_reason_code = excluded.eligibility_reason_code,
      country_code = excluded.country_code,
      age_18_affirmed = excluded.age_18_affirmed,
      rules_accepted_at = excluded.rules_accepted_at,
      opted_in_at = excluded.opted_in_at,
      withdrawn_at = null,
      base_entry_count = excluded.base_entry_count,
      eligibility_rules_version = excluded.eligibility_rules_version,
      eligibility_country_matrix_version = excluded.eligibility_country_matrix_version,
      eligibility_member_status = excluded.eligibility_member_status,
      eligibility_guild_verified = excluded.eligibility_guild_verified,
      updated_at = excluded.updated_at;

  insert into public.raffle_audit_events (
    cycle_id, member_id, actor_id, event_type, event_at, sanitized_data
  ) values (
    cycle_row.id, p_member_id, p_member_id, 'entry_opted_in', p_now,
    jsonb_build_object(
      'outcome', 'opted_in',
      'reasonCode', resulting_reason
    )
  );

  return jsonb_build_object(
    'eligibilityState', case when resulting_status = 'pending' then 'pending_review' else resulting_status end,
    'reasonCode', resulting_reason,
    'outcome', 'opted_in'
  );
end;
$$;

create or replace function public.submit_raffle_bonus_alternative(
  p_cycle_id uuid,
  p_member_id uuid,
  p_actor_id uuid,
  p_bonus_key text,
  p_response_hash text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  entry_row public.raffle_entries%rowtype;
  bonus_row public.raffle_bonus_awards%rowtype;
begin
  perform private.assert_raffle_service_caller();
  if p_member_id is null or p_actor_id is distinct from p_member_id
    or p_bonus_key not in (
      'scheduled_activity', 'monthly_gathering', 'help_session',
      'social_media_share', 'guild_feedback', 'member_welcome',
      'member_recruitment', 'creative_hobby_share',
      'member_spotlight_nomination'
    )
    or coalesce(p_response_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_bonus_alternative_submission';
  end if;

  select * into cycle_row from public.raffle_cycles
  where id = p_cycle_id for update;
  select * into entry_row from public.raffle_entries
  where cycle_id = p_cycle_id and member_id = p_member_id for update;
  if cycle_row.id is null or cycle_row.status <> 'open'
    or p_now < cycle_row.opens_at or p_now >= cycle_row.closes_at then
    raise exception 'raffle_entry_window_closed';
  end if;
  if entry_row.id is null
    or entry_row.eligibility_status not in ('pending', 'eligible')
    or entry_row.withdrawn_at is not null then
    raise exception 'opted_in_entry_required';
  end if;

  select * into bonus_row from public.raffle_bonus_awards
  where entry_id = entry_row.id and bonus_key = p_bonus_key for update;
  if bonus_row.id is not null then
    if bonus_row.revoked_at is not null then
      raise exception 'bonus_alternative_requires_moderator_review';
    end if;
    return jsonb_build_object(
      'completionState', 'completed',
      'completionMethod', bonus_row.completion_method,
      'duplicate', true
    );
  end if;

  insert into public.raffle_bonus_awards (
    cycle_id, entry_id, member_id, bonus_key, completion_method,
    source_reference_hash, awarded_at, awarded_by
  ) values (
    cycle_row.id, entry_row.id, entry_row.member_id, p_bonus_key,
    'alternative', p_response_hash, p_now, p_member_id
  );

  insert into public.raffle_audit_events (
    cycle_id, member_id, actor_id, event_type, event_at, sanitized_data
  ) values (
    cycle_row.id, entry_row.member_id, p_member_id,
    'bonus_alternative_submitted', p_now,
    jsonb_build_object(
      'bonusKey', p_bonus_key,
      'completionMethod', 'alternative',
      'outcome', 'completed'
    )
  );

  return jsonb_build_object(
    'completionState', 'completed',
    'completionMethod', 'alternative',
    'duplicate', false
  );
end;
$$;

-- Transactionally freeze the canonical entry counts. The caller derives the
-- salted pseudonyms and hash from the returned immutable ledger.
create or replace function public.freeze_raffle_ledger(
  p_cycle_id uuid,
  p_actor_id uuid,
  p_ledger_salt text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  draw_row public.raffle_draws%rowtype;
  ledger jsonb;
  entrants integer;
  total_entries integer;
begin
  perform private.assert_raffle_service_caller();
  if p_cycle_id is null or p_ledger_salt is null or char_length(p_ledger_salt) not between 32 and 128 then
    raise exception 'invalid_freeze_request';
  end if;

  select * into cycle_row
  from public.raffle_cycles
  where id = p_cycle_id
  for update;

  if not found then raise exception 'raffle_cycle_not_found'; end if;

  select * into draw_row
  from public.raffle_draws
  where cycle_id = p_cycle_id
  for update;

  if found then
    select coalesce(jsonb_agg(
      jsonb_build_object('memberId', member_id, 'entryCount', frozen_entry_count)
      order by member_id::text
    ), '[]'::jsonb)
    into ledger
    from public.raffle_entries
    where cycle_id = p_cycle_id and eligibility_status = 'frozen';

    return jsonb_build_object(
      'drawId', draw_row.id,
      'cycleId', p_cycle_id,
      'drawStatus', draw_row.status,
      'ledgerSalt', draw_row.ledger_salt,
      'ledgerHash', draw_row.ledger_hash,
      'seedHash', draw_row.seed_hash,
      'entrantCount', draw_row.entrant_count,
      'totalEntryCount', draw_row.total_entry_count,
      'ledger', ledger,
      'duplicate', true
    );
  end if;

  if cycle_row.status <> 'open' then raise exception 'raffle_cycle_not_open'; end if;
  if p_now < cycle_row.closes_at then raise exception 'raffle_entry_window_open'; end if;
  if not (
    cycle_row.sponsor_approved
    and cycle_row.rules_approved
    and cycle_row.country_matrix_approved
    and cycle_row.reward_approved
    and cycle_row.privacy_approved
    and cycle_row.tax_approved
    and cycle_row.operations_approved
  ) then
    raise exception 'raffle_launch_gates_incomplete';
  end if;

  perform 1 from public.raffle_entries where cycle_id = p_cycle_id for update;
  perform 1 from public.raffle_bonus_awards where cycle_id = p_cycle_id for update;

  update public.raffle_entries entry
  set
    eligibility_status = 'frozen',
    frozen_entry_count = least(10, 1 + (
      select count(*)::integer
      from public.raffle_bonus_awards bonus
      where bonus.entry_id = entry.id and bonus.revoked_at is null
    )),
    updated_at = p_now
  where entry.cycle_id = p_cycle_id
    and entry.eligibility_status = 'eligible'
    and entry.withdrawn_at is null;

  select count(*)::integer, coalesce(sum(frozen_entry_count), 0)::integer
  into entrants, total_entries
  from public.raffle_entries
  where cycle_id = p_cycle_id and eligibility_status = 'frozen';

  if entrants < cycle_row.minimum_eligible_entrants then
    raise exception 'raffle_minimum_eligible_entrants_not_met';
  end if;

  insert into public.raffle_draws (
    cycle_id, ledger_salt, entrant_count, total_entry_count, frozen_at, initiated_by
  ) values (
    p_cycle_id, p_ledger_salt, entrants, total_entries, p_now, p_actor_id
  ) returning * into draw_row;

  update public.raffle_cycles
  set status = 'frozen', entrant_count = entrants, total_entry_count = total_entries, frozen_at = p_now, updated_at = p_now
  where id = p_cycle_id;

  insert into public.raffle_audit_events (cycle_id, draw_id, actor_id, event_type, event_at, sanitized_data)
  values (p_cycle_id, draw_row.id, p_actor_id, 'ledger_frozen', p_now,
    jsonb_build_object('entrantCount', entrants, 'totalEntryCount', total_entries));

  select coalesce(jsonb_agg(
    jsonb_build_object('memberId', member_id, 'entryCount', frozen_entry_count)
    order by member_id::text
  ), '[]'::jsonb)
  into ledger
  from public.raffle_entries
  where cycle_id = p_cycle_id and eligibility_status = 'frozen';

  return jsonb_build_object(
    'drawId', draw_row.id,
    'cycleId', p_cycle_id,
    'drawStatus', draw_row.status,
    'ledgerSalt', draw_row.ledger_salt,
    'entrantCount', entrants,
    'totalEntryCount', total_entries,
    'ledger', ledger,
    'duplicate', false
  );
end;
$$;

-- Recompute and persist the canonical frozen-ledger commitment, then generate
-- and commit one database-controlled seed in the same locked transaction.
-- The operator therefore cannot choose a seed after seeing a preferred result.
create or replace function public.record_raffle_ledger_hash(
  p_draw_id uuid,
  p_ledger_hash text,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draw_row public.raffle_draws%rowtype;
  canonical_ledger_text text;
  canonical_ledger_hash text;
  committed_seed_hex text;
  committed_seed_hash text;
  canonical_entrant_count integer;
  canonical_total_entry_count integer;
begin
  perform private.assert_raffle_service_caller();
  if p_ledger_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_ledger_hash';
  end if;

  select * into draw_row from public.raffle_draws
  where id = p_draw_id for update;
  if not found then raise exception 'raffle_draw_not_found'; end if;

  with canonical as (
    select
      entry.member_id,
      entry.frozen_entry_count as entry_count,
      encode(extensions.digest(
        draw_row.ledger_salt || ':' || entry.member_id::text,
        'sha256'
      ), 'hex') as pseudonym
    from public.raffle_entries entry
    where entry.cycle_id = draw_row.cycle_id
      and entry.eligibility_status = 'frozen'
  ), ranged as (
    select
      entry_count,
      pseudonym,
      1 + coalesce(sum(entry_count) over (
        order by pseudonym collate "C" rows between unbounded preceding and 1 preceding
      ), 0) as first_ordinal,
      sum(entry_count) over (order by pseudonym collate "C") as last_ordinal
    from canonical
  )
  select
    '[' || coalesce(string_agg(
      '{"pseudonymousMemberId":"' || pseudonym
        || '","entryCount":' || entry_count::text
        || ',"firstOrdinal":' || first_ordinal::text
        || ',"lastOrdinal":' || last_ordinal::text || '}',
      ',' order by pseudonym collate "C"
    ), '') || ']',
    count(*)::integer,
    coalesce(sum(entry_count), 0)::integer
  into canonical_ledger_text, canonical_entrant_count,
    canonical_total_entry_count
  from ranged;

  canonical_ledger_hash := encode(
    extensions.digest(canonical_ledger_text, 'sha256'), 'hex'
  );
  if canonical_entrant_count <> draw_row.entrant_count
    or canonical_total_entry_count <> draw_row.total_entry_count then
    raise exception 'raffle_frozen_ledger_count_mismatch';
  end if;
  if canonical_ledger_hash <> p_ledger_hash then
    raise exception 'raffle_ledger_hash_mismatch';
  end if;

  if draw_row.ledger_hash is not null then
    if draw_row.ledger_hash <> p_ledger_hash
      or draw_row.seed_hex is null or draw_row.seed_hash is null then
      raise exception 'raffle_ledger_hash_conflict';
    end if;
    return jsonb_build_object(
      'drawId', draw_row.id,
      'ledgerHash', draw_row.ledger_hash,
      'seedHex', draw_row.seed_hex,
      'seedHash', draw_row.seed_hash,
      'duplicate', true
    );
  end if;
  if draw_row.status <> 'frozen'
    or draw_row.seed_hex is not null or draw_row.seed_hash is not null
    or draw_row.drawn_at is not null then
    raise exception 'raffle_ledger_not_recordable';
  end if;

  committed_seed_hex := encode(extensions.gen_random_bytes(32), 'hex');
  committed_seed_hash := encode(
    extensions.digest(committed_seed_hex, 'sha256'), 'hex'
  );

  update public.raffle_draws
  set ledger_hash = canonical_ledger_hash,
      seed_hex = committed_seed_hex,
      seed_hash = committed_seed_hash,
      updated_at = p_now
  where id = draw_row.id;

  insert into public.raffle_audit_events (
    cycle_id, draw_id, actor_id, event_type, event_at,
    sanitized_data, event_hash
  ) values (
    draw_row.cycle_id, draw_row.id, p_actor_id,
    'ledger_hash_recorded', p_now,
    jsonb_build_object('outcome', 'committed'), canonical_ledger_hash
  );

  return jsonb_build_object(
    'drawId', draw_row.id,
    'ledgerHash', canonical_ledger_hash,
    'seedHex', committed_seed_hex,
    'seedHash', committed_seed_hash,
    'duplicate', false
  );
end;
$$;

-- Reproduce the documented weighted-without-replacement v1 algorithm from
-- frozen database rows and the already committed seed. This helper is never a
-- client RPC; only the owner-executed completion boundary can invoke it.
create or replace function private.canonical_raffle_draw_results(
  p_draw_id uuid,
  p_seed_hex text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  draw_row public.raffle_draws%rowtype;
  remaining_members uuid[];
  seed_bytes bytea;
  random_buffer bytea := ''::bytea;
  counter_value bigint := 0;
  upper_exclusive bigint;
  byte_length integer;
  range_value numeric;
  acceptance_limit numeric;
  candidate numeric;
  selected_offset bigint;
  selected_member_id uuid;
  selected_pseudonym text;
  selected_first_ordinal bigint;
  selected_remaining_first bigint;
  selection_order integer := 0;
  selection_kind text;
  alternate_rank integer;
  results jsonb := '[]'::jsonb;
begin
  if p_seed_hex is null or p_seed_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_draw_seed';
  end if;
  select * into draw_row from public.raffle_draws where id = p_draw_id;
  if not found then raise exception 'raffle_draw_not_found'; end if;

  select array_agg(member_id order by pseudonym collate "C")
  into remaining_members
  from (
    select entry.member_id,
      encode(extensions.digest(
        draw_row.ledger_salt || ':' || entry.member_id::text, 'sha256'
      ), 'hex') as pseudonym
    from public.raffle_entries entry
    where entry.cycle_id = draw_row.cycle_id
      and entry.eligibility_status = 'frozen'
  ) canonical;
  if coalesce(cardinality(remaining_members), 0) <> draw_row.entrant_count then
    raise exception 'raffle_frozen_ledger_count_mismatch';
  end if;
  seed_bytes := decode(p_seed_hex, 'hex');

  while cardinality(remaining_members) > 0 loop
    select sum(entry.frozen_entry_count)::bigint
    into upper_exclusive
    from public.raffle_entries entry
    where entry.cycle_id = draw_row.cycle_id
      and entry.eligibility_status = 'frozen'
      and entry.member_id = any(remaining_members);
    if upper_exclusive is null or upper_exclusive <= 0 then
      raise exception 'raffle_frozen_ledger_invalid';
    end if;

    byte_length := 1;
    range_value := 256;
    while range_value < upper_exclusive loop
      byte_length := byte_length + 1;
      range_value := range_value * 256;
    end loop;
    acceptance_limit := range_value - mod(range_value, upper_exclusive);

    loop
      while octet_length(random_buffer) < byte_length loop
        random_buffer := random_buffer || extensions.digest(
          seed_bytes || pg_catalog.int8send(counter_value), 'sha256'
        );
        counter_value := counter_value + 1;
      end loop;
      candidate := 0;
      for byte_index in 0..byte_length - 1 loop
        candidate := candidate * 256 + get_byte(random_buffer, byte_index);
      end loop;
      random_buffer := substring(random_buffer from byte_length + 1);
      if candidate < acceptance_limit then
        selected_offset := mod(candidate, upper_exclusive)::bigint;
        exit;
      end if;
    end loop;

    with full_ledger as (
      select
        entry.member_id,
        entry.frozen_entry_count as entry_count,
        encode(extensions.digest(
          draw_row.ledger_salt || ':' || entry.member_id::text, 'sha256'
        ), 'hex') as pseudonym
      from public.raffle_entries entry
      where entry.cycle_id = draw_row.cycle_id
        and entry.eligibility_status = 'frozen'
    ), full_ranged as (
      select *, 1 + coalesce(sum(entry_count) over (
        order by pseudonym collate "C" rows between unbounded preceding and 1 preceding
      ), 0) as first_ordinal
      from full_ledger
    ), remaining_ranged as (
      select *, coalesce(sum(entry_count) over (
        order by pseudonym collate "C" rows between unbounded preceding and 1 preceding
      ), 0) as remaining_first
      from full_ranged
      where member_id = any(remaining_members)
    )
    select member_id, pseudonym, first_ordinal, remaining_first
    into selected_member_id, selected_pseudonym,
      selected_first_ordinal, selected_remaining_first
    from remaining_ranged
    where selected_offset >= remaining_first
      and selected_offset < remaining_first + entry_count
    order by pseudonym collate "C"
    limit 1;
    if selected_member_id is null then
      raise exception 'raffle_seed_selection_unmapped';
    end if;

    selection_order := selection_order + 1;
    selection_kind := case
      when selection_order = 1 then 'paid_winner'
      when selection_order <= 3 then 'honor'
      else 'alternate'
    end;
    alternate_rank := case when selection_kind = 'alternate'
      then selection_order - 3 else null end;
    results := results || jsonb_build_array(jsonb_build_object(
      'memberId', selected_member_id::text,
      'pseudonymousMemberId', selected_pseudonym,
      'entryOrdinal', selected_first_ordinal
        + (selected_offset - selected_remaining_first),
      'selectionOrder', selection_order,
      'kind', selection_kind,
      'alternateRank', alternate_rank
    ));
    remaining_members := array_remove(remaining_members, selected_member_id);
    selected_member_id := null;
  end loop;
  return results;
end;
$$;

-- Commit a draw exactly once only when the submitted result set is the exact
-- canonical output for the database-committed seed and algorithm.
create or replace function public.complete_raffle_draw(
  p_draw_id uuid,
  p_ledger_hash text,
  p_seed_hex text,
  p_seed_hash text,
  p_algorithm_version text,
  p_results jsonb,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draw_row public.raffle_draws%rowtype;
  cycle_row public.raffle_cycles%rowtype;
  result_value jsonb;
  expected_count integer;
  result_count integer;
  paid_count integer;
  honor_count integer;
  alt_count integer;
  canonical_results jsonb;
  stored_results jsonb;
begin
  perform private.assert_raffle_service_caller();
  if p_ledger_hash is null or p_ledger_hash !~ '^[0-9a-f]{64}$'
    or p_seed_hex is null or p_seed_hex !~ '^[0-9a-f]{64}$'
    or p_seed_hash is null or p_seed_hash !~ '^[0-9a-f]{64}$'
    or p_actor_id is null or p_now is null then
    raise exception 'invalid_draw_evidence';
  end if;
  if p_algorithm_version is distinct from 'mochirii-weighted-without-replacement-v1' then
    raise exception 'invalid_draw_algorithm_version';
  end if;
  if encode(extensions.digest(p_seed_hex, 'sha256'), 'hex') is distinct from p_seed_hash then
    raise exception 'raffle_seed_hash_mismatch';
  end if;
  if jsonb_typeof(p_results) is distinct from 'array' then raise exception 'invalid_draw_results'; end if;

  select * into draw_row from public.raffle_draws where id = p_draw_id for update;
  if not found then raise exception 'raffle_draw_not_found'; end if;

  if draw_row.status = 'drawn' then
    if draw_row.ledger_hash is distinct from p_ledger_hash
      or draw_row.seed_hex is distinct from p_seed_hex
      or draw_row.seed_hash is distinct from p_seed_hash
      or draw_row.algorithm_version is distinct from p_algorithm_version then
      raise exception 'raffle_draw_retry_conflict';
    end if;
    canonical_results := private.canonical_raffle_draw_results(
      draw_row.id, draw_row.seed_hex
    );
    select coalesce(jsonb_agg(jsonb_build_object(
      'memberId', result.member_id::text,
      'pseudonymousMemberId', result.pseudonymous_member_id,
      'entryOrdinal', result.entry_ordinal,
      'selectionOrder', result.selection_order,
      'kind', result.result_kind,
      'alternateRank', result.alternate_rank
    ) order by result.selection_order), '[]'::jsonb)
    into stored_results
    from public.raffle_draw_results result
    where result.draw_id = draw_row.id;
    if canonical_results is distinct from p_results
      or stored_results is distinct from canonical_results then
      raise exception 'raffle_draw_retry_conflict';
    end if;
    return jsonb_build_object(
      'drawId', draw_row.id,
      'cycleId', draw_row.cycle_id,
      'ledgerHash', draw_row.ledger_hash,
      'seedHash', draw_row.seed_hash,
      'resultCount', draw_row.entrant_count,
      'duplicate', true
    );
  end if;

  if draw_row.status <> 'frozen'
    or draw_row.ledger_hash is distinct from p_ledger_hash
    or draw_row.seed_hex is distinct from p_seed_hex
    or draw_row.seed_hash is distinct from p_seed_hash
    or draw_row.algorithm_version is distinct from p_algorithm_version then
    raise exception 'raffle_ledger_hash_not_committed';
  end if;

  canonical_results := private.canonical_raffle_draw_results(
    draw_row.id, draw_row.seed_hex
  );

  if canonical_results is distinct from p_results then
    raise exception 'raffle_result_seed_mismatch';
  end if;

  select * into cycle_row from public.raffle_cycles where id = draw_row.cycle_id for update;
  if p_now < cycle_row.draw_at then raise exception 'raffle_draw_time_not_reached'; end if;

  expected_count := draw_row.entrant_count;
  result_count := jsonb_array_length(p_results);
  if result_count <> expected_count then raise exception 'raffle_result_count_mismatch'; end if;

  select
    count(*) filter (where value->>'kind' = 'paid_winner'),
    count(*) filter (where value->>'kind' = 'honor'),
    count(*) filter (where value->>'kind' = 'alternate')
  into paid_count, honor_count, alt_count
  from jsonb_array_elements(p_results);

  if paid_count <> least(1, expected_count)
    or honor_count <> least(2, greatest(expected_count - 1, 0))
    or alt_count <> greatest(expected_count - 3, 0) then
    raise exception 'raffle_result_kind_mismatch';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) result(value)
    where case
      when jsonb_typeof(result.value) <> 'object'
        or coalesce(result.value->>'selectionOrder', '') !~ '^[1-9][0-9]*$'
        or coalesce(result.value->>'entryOrdinal', '') !~ '^[1-9][0-9]*$'
        or coalesce(result.value->>'memberId', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(result.value->>'pseudonymousMemberId', '') !~ '^[0-9a-f]{64}$'
      then true
      else
        (result.value->>'selectionOrder')::integer > expected_count
        or case
          when (result.value->>'selectionOrder')::integer = 1
            then result.value->>'kind' <> 'paid_winner'
              or result.value->>'alternateRank' is not null
          when (result.value->>'selectionOrder')::integer <= least(3, expected_count)
            then result.value->>'kind' <> 'honor'
              or result.value->>'alternateRank' is not null
          else result.value->>'kind' <> 'alternate'
            or coalesce(result.value->>'alternateRank', '') !~ '^[1-9][0-9]*$'
            or (result.value->>'alternateRank')::integer <>
              (result.value->>'selectionOrder')::integer - 3
        end
    end
  ) then
    raise exception 'raffle_result_order_mismatch';
  end if;

  for result_value in select value from jsonb_array_elements(p_results) loop
    if not exists (
      with canonical as (
        select
          entry.member_id,
          entry.frozen_entry_count,
          encode(extensions.digest(draw_row.ledger_salt || ':' || entry.member_id::text, 'sha256'), 'hex') as pseudonym
        from public.raffle_entries entry
        where entry.cycle_id = draw_row.cycle_id
          and entry.eligibility_status = 'frozen'
      ), ranged as (
        select
          member_id,
          pseudonym,
          1 + coalesce(sum(frozen_entry_count) over (
            order by pseudonym collate "C" rows between unbounded preceding and 1 preceding
          ), 0) as first_ordinal,
          sum(frozen_entry_count) over (order by pseudonym collate "C") as last_ordinal
        from canonical
      )
      select 1 from ranged
      where member_id = (result_value->>'memberId')::uuid
        and pseudonym = result_value->>'pseudonymousMemberId'
        and (result_value->>'entryOrdinal')::integer between first_ordinal and last_ordinal
    ) then
      raise exception 'raffle_result_not_in_ledger';
    end if;

    insert into public.raffle_draw_results (
      draw_id, cycle_id, member_id, result_kind, selection_order, entry_ordinal,
      pseudonymous_member_id, alternate_rank, status, claim_opened_at,
      claim_deadline, claim_window_days
    ) values (
      draw_row.id,
      draw_row.cycle_id,
      (result_value->>'memberId')::uuid,
      result_value->>'kind',
      (result_value->>'selectionOrder')::integer,
      (result_value->>'entryOrdinal')::integer,
      result_value->>'pseudonymousMemberId',
      nullif(result_value->>'alternateRank', '')::integer,
      'selected',
      case when result_value->>'kind' = 'paid_winner' then p_now else null end,
      case when result_value->>'kind' = 'paid_winner'
        then p_now + make_interval(days => cycle_row.claim_window_days)
        else null
      end,
      cycle_row.claim_window_days
    );
  end loop;

  update public.raffle_draws
  set status = 'drawn', seed_hex = p_seed_hex,
      seed_hash = p_seed_hash, algorithm_version = p_algorithm_version,
      drawn_at = p_now, completed_by = p_actor_id, updated_at = p_now
  where id = p_draw_id;

  update public.raffle_cycles set status = 'drawn', updated_at = p_now where id = draw_row.cycle_id;

  insert into public.raffle_audit_events (cycle_id, draw_id, actor_id, event_type, event_at, sanitized_data)
  values (draw_row.cycle_id, draw_row.id, p_actor_id, 'draw_completed', p_now,
    jsonb_build_object('algorithmVersion', p_algorithm_version, 'resultCount', result_count));

  return jsonb_build_object('drawId', draw_row.id, 'cycleId', draw_row.cycle_id, 'duplicate', false);
end;
$$;

create or replace function public.record_raffle_private_notice(
  p_cycle_id uuid,
  p_draw_result_id uuid,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  result_row public.raffle_draw_results%rowtype;
begin
  perform private.assert_raffle_service_caller();
  if p_actor_id is null then raise exception 'notice_actor_required'; end if;
  select * into cycle_row from public.raffle_cycles
  where id = p_cycle_id for update;
  select * into result_row from public.raffle_draw_results
  where id = p_draw_result_id and cycle_id = p_cycle_id for update;
  if cycle_row.id is null or result_row.id is null then
    raise exception 'raffle_notice_target_not_found';
  end if;
  if result_row.contacted_at is not null then
    return jsonb_build_object('noticeState', 'notice_recorded', 'duplicate', true);
  end if;
  if cycle_row.status <> 'drawn' or p_now > cycle_row.expires_at
    or result_row.result_kind not in ('paid_winner', 'alternate')
    or result_row.status <> 'selected'
    or result_row.claim_opened_at is null
    or result_row.claim_deadline is null
    or p_now > result_row.claim_deadline then
    raise exception 'raffle_notice_not_recordable';
  end if;

  update public.raffle_draw_results
  set status = 'contacted', contacted_at = p_now, updated_at = p_now
  where id = result_row.id;
  insert into public.raffle_audit_events (
    cycle_id, draw_id, draw_result_id, member_id, actor_id,
    event_type, event_at, sanitized_data
  ) values (
    result_row.cycle_id, result_row.draw_id, result_row.id,
    result_row.member_id, p_actor_id, 'private_notice_recorded', p_now,
    jsonb_build_object('claimState', 'contacted', 'outcome', 'notice_recorded')
  );
  return jsonb_build_object('noticeState', 'notice_recorded', 'duplicate', false);
end;
$$;

create or replace function public.claim_raffle_draw_result(
  p_draw_result_id uuid,
  p_member_id uuid,
  p_reward_route text
)
returns public.raffle_draw_results
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.raffle_draw_results%rowtype;
  cycle_row public.raffle_cycles%rowtype;
begin
  perform private.assert_raffle_service_caller();
  if p_reward_route not in ('digital', 'in_game') then raise exception 'invalid_reward_route'; end if;

  select * into result_row
  from public.raffle_draw_results
  where id = p_draw_result_id and member_id = p_member_id
  for update;

  if not found then raise exception 'raffle_result_not_found'; end if;
  select * into cycle_row from public.raffle_cycles
  where id = result_row.cycle_id for share;
  if result_row.result_kind = 'honor' or result_row.claim_opened_at is null then raise exception 'raffle_claim_not_open'; end if;
  if result_row.claimed_at is not null then
    if result_row.status not in ('claimed', 'fulfilled')
      or result_row.reward_route is null then
      raise exception 'raffle_claim_state_invalid';
    end if;
    if result_row.reward_route <> p_reward_route then
      raise exception 'raffle_claim_route_conflict';
    end if;
    return result_row;
  end if;
  if result_row.status not in ('selected', 'contacted') then raise exception 'raffle_claim_unavailable'; end if;
  if cycle_row.id is null or now() > cycle_row.expires_at
    or now() > result_row.claim_deadline then raise exception 'raffle_claim_expired'; end if;
  if p_reward_route = 'in_game'
    and (cycle_row.id is null or not cycle_row.in_game_reward_enabled
      or cycle_row.in_game_privacy_reviewed_at is null
      or cycle_row.in_game_privacy_reviewed_by is null) then
    raise exception 'in_game_reward_unavailable';
  end if;

  update public.raffle_draw_results
  set status = 'claimed', claimed_at = coalesce(claimed_at, now()), reward_route = p_reward_route,
      fulfillment_status = case when p_reward_route = 'digital' then 'pending' else 'manual' end,
      updated_at = now()
  where id = p_draw_result_id
  returning * into result_row;

  insert into public.raffle_audit_events (cycle_id, draw_id, draw_result_id, member_id, actor_id, event_type, sanitized_data)
  values (result_row.cycle_id, result_row.draw_id, result_row.id, result_row.member_id, p_member_id,
    'reward_claimed', jsonb_build_object('rewardRoute', p_reward_route));

  return result_row;
end;
$$;

-- Record only the outcome of the private tax review. Tax documents, recipient
-- contact data, and reviewer notes never enter the raffle schema.
create or replace function public.review_raffle_claim_tax(
  p_draw_result_id uuid,
  p_tax_status text,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.raffle_draw_results%rowtype;
  reason_code text;
begin
  perform private.assert_raffle_service_caller();
  if p_tax_status not in ('not_required', 'cleared', 'blocked') then
    raise exception 'invalid_tax_review_status';
  end if;
  if p_actor_id is null then raise exception 'tax_review_actor_required'; end if;

  select * into result_row
  from public.raffle_draw_results
  where id = p_draw_result_id
  for update;

  if not found then raise exception 'raffle_result_not_found'; end if;
  if result_row.status = 'ineligible' and result_row.tax_status = 'blocked' then
    if p_tax_status <> 'blocked' then
      raise exception 'raffle_tax_review_conflict';
    end if;
    return jsonb_build_object(
      'claimState', 'ineligible',
      'taxState', 'blocked',
      'duplicate', true
    );
  end if;
  if result_row.result_kind = 'honor'
    or result_row.status <> 'claimed'
    or result_row.claimed_at is null
    or result_row.reward_route not in ('digital', 'in_game') then
    raise exception 'raffle_claim_not_reviewable';
  end if;
  if result_row.fulfillment_status in ('processing', 'delivered')
    or exists (
      select 1 from public.raffle_fulfillment_jobs job
      where job.draw_result_id = result_row.id
    ) then
    raise exception 'raffle_tax_review_already_released';
  end if;
  if result_row.tax_status <> 'pending' then
    if result_row.tax_status <> p_tax_status then
      raise exception 'raffle_tax_review_conflict';
    end if;
    return jsonb_build_object(
      'claimState', result_row.status,
      'taxState', result_row.tax_status,
      'duplicate', true
    );
  end if;

  reason_code := case p_tax_status
    when 'not_required' then 'tax_not_required'
    when 'cleared' then 'tax_cleared'
    else 'tax_review_blocked'
  end;

  update public.raffle_draw_results
  set tax_status = p_tax_status,
      tax_reviewed_at = p_now,
      tax_reviewed_by = p_actor_id,
      tax_review_reason_code = reason_code,
      status = case when p_tax_status = 'blocked' then 'ineligible' else status end,
      fulfillment_status = case when p_tax_status = 'blocked' then 'failed' else fulfillment_status end,
      updated_at = p_now
  where id = result_row.id;

  insert into public.raffle_audit_events (
    cycle_id, draw_id, draw_result_id, member_id, actor_id,
    event_type, event_at, sanitized_data
  ) values (
    result_row.cycle_id, result_row.draw_id, result_row.id,
    result_row.member_id, p_actor_id, 'claim_tax_reviewed', p_now,
    jsonb_build_object(
      'claimState', case when p_tax_status = 'blocked' then 'ineligible' else 'claimed' end,
      'outcome', p_tax_status,
      'reasonCode', reason_code
    )
  );

  return jsonb_build_object(
    'claimState', case when p_tax_status = 'blocked' then 'ineligible' else result_row.status end,
    'taxState', p_tax_status,
    'duplicate', false
  );
end;
$$;

-- Recheck live membership/guild standing and record only a bounded fraud
-- decision. No fraud narratives, provider data, contact details, or evidence
-- bodies are accepted or stored.
create or replace function public.review_raffle_claim_clearance(
  p_draw_result_id uuid,
  p_fraud_status text,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.raffle_draw_results%rowtype;
  profile_row public.member_profiles%rowtype;
  membership_state text;
  membership_reason text;
  fraud_reason text;
begin
  perform private.assert_raffle_service_caller();
  if p_fraud_status not in ('cleared', 'blocked') then
    raise exception 'invalid_fraud_review_status';
  end if;
  if p_actor_id is null then raise exception 'claim_clearance_actor_required'; end if;

  select * into result_row from public.raffle_draw_results
  where id = p_draw_result_id for update;
  if not found then raise exception 'raffle_result_not_found'; end if;
  if result_row.result_kind = 'honor'
    or result_row.status <> 'claimed'
    or result_row.claimed_at is null
    or result_row.reward_route not in ('digital', 'in_game') then
    raise exception 'raffle_claim_not_reviewable';
  end if;
  if result_row.fulfillment_status in ('processing', 'delivered')
    or exists (
      select 1 from public.raffle_fulfillment_jobs job
      where job.draw_result_id = result_row.id
    ) then
    raise exception 'raffle_claim_clearance_already_released';
  end if;

  select * into profile_row from public.member_profiles
  where id = result_row.member_id for share;
  if profile_row.id is null or profile_row.member_status <> 'active' then
    membership_state := 'blocked';
    membership_reason := 'membership_not_active';
  elsif not profile_row.has_required_discord_roles
    or profile_row.discord_verified_at is null
    or profile_row.discord_verified_at < p_now - interval '7 days'
    or profile_row.discord_verified_at > p_now + interval '5 minutes' then
    membership_state := 'blocked';
    membership_reason := 'guild_verification_required';
  else
    membership_state := 'cleared';
    membership_reason := 'membership_cleared';
  end if;
  fraud_reason := case p_fraud_status
    when 'cleared' then 'fraud_cleared'
    else 'fraud_review_blocked'
  end;

  update public.raffle_draw_results
  set membership_clearance_status = membership_state,
      membership_reviewed_at = p_now,
      membership_reviewed_by = p_actor_id,
      membership_review_reason_code = membership_reason,
      fraud_clearance_status = p_fraud_status,
      fraud_reviewed_at = p_now,
      fraud_reviewed_by = p_actor_id,
      fraud_review_reason_code = fraud_reason,
      status = case
        when membership_state = 'blocked' or p_fraud_status = 'blocked'
          then 'ineligible'
        else status
      end,
      fulfillment_status = case
        when membership_state = 'blocked' or p_fraud_status = 'blocked'
          then 'failed'
        else fulfillment_status
      end,
      updated_at = p_now
  where id = result_row.id;

  insert into public.raffle_audit_events (
    cycle_id, draw_id, draw_result_id, member_id, actor_id,
    event_type, event_at, sanitized_data
  ) values (
    result_row.cycle_id, result_row.draw_id, result_row.id,
    result_row.member_id, p_actor_id, 'claim_clearance_reviewed', p_now,
    jsonb_build_object(
      'membershipState', membership_state,
      'fraudState', p_fraud_status,
      'claimState', case
        when membership_state = 'blocked' or p_fraud_status = 'blocked'
          then 'ineligible'
        else 'claimed'
      end,
      'reasonCode', case
        when membership_state = 'blocked' then membership_reason
        else fraud_reason
      end
    )
  );

  return jsonb_build_object(
    'claimState', case
      when membership_state = 'blocked' or p_fraud_status = 'blocked'
        then 'ineligible'
      else result_row.status
    end,
    'membershipState', membership_state,
    'fraudState', p_fraud_status
  );
end;
$$;

-- Release a claimed digital prize into the worker queue only after every
-- cycle, tax, country, catalog, provider, and amount gate is revalidated in a
-- single transaction. The immutable external ID makes retries non-redrawing
-- and non-duplicating.
create or replace function public.release_raffle_digital_fulfillment(
  p_draw_result_id uuid,
  p_provider_environment text,
  p_product_ids text[],
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.raffle_draw_results%rowtype;
  cycle_row public.raffle_cycles%rowtype;
  entry_row public.raffle_entries%rowtype;
  profile_row public.member_profiles%rowtype;
  config_row public.raffle_provider_configs%rowtype;
  existing_job public.raffle_fulfillment_jobs%rowtype;
  reviewed_products text[];
  immutable_external_id text;
  enabled_config_count integer;
begin
  perform private.assert_raffle_service_caller();
  if p_provider_environment <> 'production' then
    raise exception 'invalid_provider_environment';
  end if;
  if p_actor_id is null then raise exception 'fulfillment_release_actor_required'; end if;
  if p_product_ids is null or cardinality(p_product_ids) = 0
    or array_position(p_product_ids, null) is not null
    or exists (
      select 1 from unnest(p_product_ids) as products(product_id)
      where product_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ) then
    raise exception 'invalid_fulfillment_product_subset';
  end if;

  select coalesce(array_agg(product_id order by product_id), '{}'::text[])
  into reviewed_products
  from (
    select distinct product_id
    from unnest(p_product_ids) as products(product_id)
  ) canonical;

  select * into result_row
  from public.raffle_draw_results
  where id = p_draw_result_id
  for update;
  if not found then raise exception 'raffle_result_not_found'; end if;

  immutable_external_id := 'mochirii-mpd-' || result_row.id::text || '-v1';

  select * into existing_job
  from public.raffle_fulfillment_jobs
  where draw_result_id = result_row.id
  for update;
  if found then
    if existing_job.external_id <> immutable_external_id
      or existing_job.provider_config_id is distinct from (
        select id from public.raffle_provider_configs
        where environment = p_provider_environment
      )
      or existing_job.provider_configuration_hash is distinct from (
        select configuration_hash from public.raffle_provider_configs
        where environment = p_provider_environment
      )
      or existing_job.campaign_id is distinct from (
        select campaign_id from public.raffle_provider_configs
        where environment = p_provider_environment
      )
      or existing_job.country_code is distinct from (
        select country_code from public.raffle_entries
        where cycle_id = result_row.cycle_id and member_id = result_row.member_id
      )
      or existing_job.reward_value_cents is distinct from (
        select reward_value_cents from public.raffle_cycles
        where id = result_row.cycle_id
      )
      or existing_job.reward_currency <> 'USD'
      or existing_job.all_in_cost_cap_cents is distinct from (
        select cycle_cost_ceiling_cents from public.raffle_cycles
        where id = result_row.cycle_id
      )
      or existing_job.product_ids <> reviewed_products then
      raise exception 'raffle_fulfillment_release_conflict';
    end if;
    return jsonb_build_object(
      'fulfillmentState', case
        when existing_job.state = 'succeeded' then 'delivered'
        when existing_job.state in ('failed', 'cancelled') then 'paused'
        else 'queued'
      end,
      'duplicate', true
    );
  end if;

  select * into cycle_row from public.raffle_cycles
  where id = result_row.cycle_id for update;
  select * into entry_row from public.raffle_entries
  where cycle_id = result_row.cycle_id
    and member_id = result_row.member_id
    and eligibility_status = 'frozen'
  for update;
  select * into profile_row from public.member_profiles
  where id = result_row.member_id for share;
  select * into config_row from public.raffle_provider_configs
  where environment = p_provider_environment
  for update;
  select count(*)::integer into enabled_config_count
  from public.raffle_provider_configs
  where status = 'active' and orders_enabled;

  if result_row.result_kind = 'honor'
    or result_row.status <> 'claimed'
    or result_row.claimed_at is null
    or result_row.reward_route <> 'digital'
    or result_row.fulfillment_status <> 'pending' then
    raise exception 'digital_claim_not_releasable';
  end if;
  if result_row.tax_status not in ('not_required', 'cleared') then
    raise exception 'tax_clearance_required';
  end if;
  if result_row.membership_clearance_status <> 'cleared'
    or result_row.membership_reviewed_at is null
    or result_row.membership_reviewed_at < p_now - interval '24 hours'
    or result_row.membership_reviewed_at > p_now + interval '5 minutes'
    or result_row.fraud_clearance_status <> 'cleared'
    or result_row.fraud_reviewed_at is null
    or result_row.fraud_reviewed_at < p_now - interval '24 hours'
    or result_row.fraud_reviewed_at > p_now + interval '5 minutes'
    or profile_row.id is null
    or profile_row.member_status <> 'active'
    or not profile_row.has_required_discord_roles
    or profile_row.discord_verified_at is null
    or profile_row.discord_verified_at < p_now - interval '7 days'
    or profile_row.discord_verified_at > p_now + interval '5 minutes' then
    raise exception 'claim_clearance_required';
  end if;
  if cycle_row.id is null
    or cycle_row.status <> 'drawn'
    or p_now > cycle_row.expires_at
    or not (cycle_row.sponsor_approved and cycle_row.rules_approved and cycle_row.tax_approved
      and cycle_row.reward_approved and cycle_row.operations_approved) then
    raise exception 'cycle_not_fulfillment_ready';
  end if;
  if entry_row.id is null
    or entry_row.country_code is null
    or entry_row.eligibility_country_matrix_version is distinct from cycle_row.country_matrix_version
    or not (entry_row.country_code = any(cycle_row.approved_country_codes)) then
    raise exception 'claim_country_not_approved';
  end if;
  if config_row.id is null
    or enabled_config_count <> 1
    or config_row.status <> 'active'
    or not config_row.orders_enabled
    or config_row.minimum_reward_value_cents <> 1000
    or config_row.maximum_reward_value_cents <> 5000
    or config_row.reward_currency <> 'USD'
    or config_row.cycle_cost_ceiling_cents <> 5000
    or config_row.balance_reserve_cents <> 5000
    or config_row.balance_ceiling_cents <> 10000
    or cycle_row.reward_value_cents < config_row.minimum_reward_value_cents
    or cycle_row.reward_value_cents > config_row.maximum_reward_value_cents
    or cycle_row.reward_value_cents % 100 <> 0
    or cycle_row.cycle_cost_ceiling_cents <> config_row.cycle_cost_ceiling_cents
    or config_row.last_readiness_check_at is null
    or config_row.last_readiness_check_at < p_now - interval '24 hours'
    or config_row.last_readiness_check_at > p_now + interval '5 minutes'
    or not (entry_row.country_code = any(config_row.approved_country_codes))
    or not (reviewed_products <@ config_row.reviewed_product_ids)
    or exists (
      select 1
      from unnest(reviewed_products) as products(product_id)
      where not ((config_row.reviewed_country_products -> entry_row.country_code) ? product_id)
    ) then
    raise exception 'provider_not_fulfillment_ready';
  end if;

  insert into public.raffle_fulfillment_jobs (
    draw_result_id, cycle_id, provider_config_id, provider_configuration_hash,
    campaign_id, state, external_id, country_code, reward_value_cents,
    reward_currency, all_in_cost_cap_cents, product_ids, next_attempt_at
  ) values (
    result_row.id, result_row.cycle_id, config_row.id, config_row.configuration_hash,
    config_row.campaign_id, 'ready', immutable_external_id,
    entry_row.country_code, cycle_row.reward_value_cents, 'USD',
    cycle_row.cycle_cost_ceiling_cents, reviewed_products, p_now
  );

  update public.raffle_draw_results
  set fulfillment_status = 'processing', updated_at = p_now
  where id = result_row.id;

  insert into public.raffle_audit_events (
    cycle_id, draw_id, draw_result_id, member_id, actor_id,
    event_type, event_at, sanitized_data
  ) values (
    result_row.cycle_id, result_row.draw_id, result_row.id,
    result_row.member_id, p_actor_id, 'digital_fulfillment_released', p_now,
    jsonb_build_object(
      'countryCode', entry_row.country_code,
      'fulfillmentState', 'queued',
      'outcome', 'released'
    )
  );

  return jsonb_build_object('fulfillmentState', 'queued', 'duplicate', false);
end;
$$;

-- Manual in-game fulfillment records only completion and the moderator actor.
-- Owner account names, platform IDs, messages, and location details are not
-- accepted by this contract and therefore cannot be stored accidentally.
create or replace function public.complete_raffle_manual_in_game(
  p_draw_result_id uuid,
  p_all_in_cost_cents integer,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.raffle_draw_results%rowtype;
  cycle_row public.raffle_cycles%rowtype;
  profile_row public.member_profiles%rowtype;
begin
  perform private.assert_raffle_service_caller();
  if p_actor_id is null then raise exception 'manual_fulfillment_actor_required'; end if;
  if p_all_in_cost_cents is null
    or p_all_in_cost_cents < 1000
    or p_all_in_cost_cents > 5000 then
    raise exception 'manual_fulfillment_cost_invalid';
  end if;

  select * into result_row from public.raffle_draw_results
  where id = p_draw_result_id for update;
  if not found then raise exception 'raffle_result_not_found'; end if;

  select * into cycle_row from public.raffle_cycles
  where id = result_row.cycle_id for update;
  if cycle_row.id is null
    or cycle_row.cycle_cost_ceiling_cents <> 5000
    or p_all_in_cost_cents < cycle_row.reward_value_cents
    or p_all_in_cost_cents > cycle_row.cycle_cost_ceiling_cents then
    raise exception 'manual_fulfillment_cost_invalid';
  end if;

  if result_row.status = 'fulfilled'
    and result_row.reward_route = 'in_game'
    and result_row.fulfillment_status = 'delivered'
    and result_row.manual_fulfilled_at is not null then
    if result_row.manual_all_in_cost_cents is distinct from p_all_in_cost_cents then
      raise exception 'manual_fulfillment_cost_conflict';
    end if;
    return jsonb_build_object(
      'fulfillmentState', 'delivered', 'allInCostCents', p_all_in_cost_cents,
      'duplicate', true
    );
  end if;

  select * into profile_row from public.member_profiles
  where id = result_row.member_id for share;

  if result_row.result_kind = 'honor'
    or result_row.status <> 'claimed'
    or result_row.claimed_at is null
    or result_row.reward_route <> 'in_game'
    or result_row.fulfillment_status <> 'manual'
    or result_row.tax_status not in ('not_required', 'cleared')
    or result_row.membership_clearance_status <> 'cleared'
    or result_row.membership_reviewed_at is null
    or result_row.membership_reviewed_at < p_now - interval '24 hours'
    or result_row.membership_reviewed_at > p_now + interval '5 minutes'
    or result_row.fraud_clearance_status <> 'cleared'
    or result_row.fraud_reviewed_at is null
    or result_row.fraud_reviewed_at < p_now - interval '24 hours'
    or result_row.fraud_reviewed_at > p_now + interval '5 minutes'
    or profile_row.id is null
    or profile_row.member_status <> 'active'
    or not profile_row.has_required_discord_roles
    or profile_row.discord_verified_at is null
    or profile_row.discord_verified_at < p_now - interval '7 days'
    or profile_row.discord_verified_at > p_now + interval '5 minutes' then
    raise exception 'manual_claim_not_completable';
  end if;
  if cycle_row.id is null or cycle_row.status <> 'drawn'
    or p_now > cycle_row.expires_at
    or not cycle_row.in_game_reward_enabled
    or cycle_row.in_game_privacy_reviewed_at is null
    or cycle_row.in_game_privacy_reviewed_by is null then
    raise exception 'manual_claim_expired';
  end if;
  if exists (
    select 1 from public.raffle_fulfillment_jobs job
    where job.draw_result_id = result_row.id
  ) then
    raise exception 'manual_claim_has_provider_job';
  end if;

  update public.raffle_draw_results
  set status = 'fulfilled', fulfillment_status = 'delivered',
      manual_fulfilled_at = p_now, manual_fulfilled_by = p_actor_id,
      manual_all_in_cost_cents = p_all_in_cost_cents,
      updated_at = p_now
  where id = result_row.id;

  insert into public.raffle_audit_events (
    cycle_id, draw_id, draw_result_id, member_id, actor_id,
    event_type, event_at, sanitized_data
  ) values (
    result_row.cycle_id, result_row.draw_id, result_row.id,
    result_row.member_id, p_actor_id, 'manual_in_game_fulfilled', p_now,
    jsonb_build_object(
      'rewardRoute', 'in_game', 'fulfillmentState', 'delivered',
      'rewardValueCents', cycle_row.reward_value_cents,
      'allInCostCents', p_all_in_cost_cents
    )
  );

  return jsonb_build_object(
    'fulfillmentState', 'delivered', 'allInCostCents', p_all_in_cost_cents,
    'duplicate', false
  );
end;
$$;

create or replace function public.claim_raffle_fulfillment_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lock_seconds integer default 60
)
returns setof public.raffle_fulfillment_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_raffle_service_caller();
  if p_worker_id is null or char_length(trim(p_worker_id)) not between 8 and 120 then
    raise exception 'invalid_worker_id';
  end if;
  if p_limit not between 1 and 25 or p_lock_seconds not between 30 and 300 then
    raise exception 'invalid_job_claim_limits';
  end if;

  insert into public.raffle_audit_events (
    cycle_id, draw_id, draw_result_id, member_id,
    event_type, dedupe_key, sanitized_data
  )
  select result.cycle_id, result.draw_id, result.id, result.member_id,
    'fulfillment_attempt_limit_reached',
    'raffle:' || job.id::text || ':fulfillment-attempt-limit',
    jsonb_build_object('errorCode', 'attempt_limit_reached', 'attemptCount', job.attempt_count)
  from public.raffle_fulfillment_jobs job
  join public.raffle_draw_results result on result.id = job.draw_result_id
  where job.attempt_count >= 20
    and job.state in ('ready', 'retryable', 'reconciling', 'claimed')
    and (job.lock_expires_at is null or job.lock_expires_at <= now())
  on conflict (dedupe_key) do nothing;

  update public.raffle_draw_results result
  set fulfillment_status = 'failed', updated_at = now()
  where exists (
    select 1 from public.raffle_fulfillment_jobs job
    where job.draw_result_id = result.id
      and job.attempt_count >= 20
      and job.state in ('ready', 'retryable', 'reconciling', 'claimed')
      and (job.lock_expires_at is null or job.lock_expires_at <= now())
  );

  update public.raffle_fulfillment_jobs
  set state = 'dead_letter', sanitized_error_code = 'attempt_limit_reached',
      locked_by = null, locked_at = null, lock_expires_at = null,
      updated_at = now()
  where attempt_count >= 20
    and state in ('ready', 'retryable', 'reconciling', 'claimed')
    and (lock_expires_at is null or lock_expires_at <= now());

  return query
  with due as (
    select job.id
    from public.raffle_fulfillment_jobs job
    join public.raffle_provider_configs config on config.id = job.provider_config_id
    where job.state in ('ready', 'retryable', 'reconciling', 'claimed')
      and job.attempt_count < 20
      and job.next_attempt_at <= now()
      and (
        (job.state in ('ready', 'retryable', 'reconciling') and (job.lock_expires_at is null or job.lock_expires_at <= now()))
        or (job.state = 'claimed' and job.lock_expires_at <= now())
      )
      and config.status = 'active'
      and config.orders_enabled
    order by job.next_attempt_at, job.created_at
    for update of job skip locked
    limit p_limit
  )
  update public.raffle_fulfillment_jobs job
  set state = case when job.state = 'reconciling' then 'reconciling' else 'claimed' end,
      locked_by = trim(p_worker_id), locked_at = now(),
      lock_expires_at = now() + make_interval(secs => p_lock_seconds),
      attempt_count = job.attempt_count + 1, updated_at = now()
  from due
  where job.id = due.id
  returning job.*;
end;
$$;

create or replace function public.decline_raffle_draw_result(
  p_draw_result_id uuid,
  p_member_id uuid
)
returns public.raffle_draw_results
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.raffle_draw_results%rowtype;
  cycle_row public.raffle_cycles%rowtype;
begin
  perform private.assert_raffle_service_caller();
  select * into result_row
  from public.raffle_draw_results
  where id = p_draw_result_id and member_id = p_member_id
  for update;

  if not found then raise exception 'raffle_result_not_found'; end if;
  select * into cycle_row from public.raffle_cycles
  where id = result_row.cycle_id for share;
  if result_row.result_kind = 'honor' or result_row.claim_opened_at is null then
    raise exception 'raffle_claim_not_open';
  end if;
  if result_row.status = 'declined' then return result_row; end if;
  if result_row.status not in ('selected', 'contacted') then
    raise exception 'raffle_claim_unavailable';
  end if;
  if cycle_row.id is null or now() > cycle_row.expires_at
    or now() > result_row.claim_deadline then raise exception 'raffle_claim_expired'; end if;

  update public.raffle_draw_results
  set status = 'declined', fulfillment_status = 'not_requested', updated_at = now()
  where id = p_draw_result_id
  returning * into result_row;

  insert into public.raffle_audit_events (
    cycle_id, draw_id, draw_result_id, member_id, actor_id, event_type, sanitized_data
  ) values (
    result_row.cycle_id, result_row.draw_id, result_row.id, result_row.member_id,
    p_member_id, 'reward_declined', jsonb_build_object('claimState', 'declined')
  );

  return result_row;
end;
$$;

create or replace function public.complete_raffle_fulfillment_job(
  p_job_id uuid,
  p_worker_id text,
  p_outcome text,
  p_provider_order_id text default null,
  p_provider_reward_id text default null,
  p_sanitized_status text default null,
  p_error_code text default null,
  p_next_attempt_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.raffle_fulfillment_jobs%rowtype;
begin
  perform private.assert_raffle_service_caller();
  if p_outcome not in ('submitting', 'reconciling', 'succeeded', 'retryable', 'failed', 'cancelled') then
    raise exception 'invalid_job_outcome';
  end if;

  select * into job_row from public.raffle_fulfillment_jobs
  where id = p_job_id for update;
  if not found then return false; end if;
  if job_row.locked_by is distinct from trim(p_worker_id) or job_row.lock_expires_at <= now() then
    raise exception 'job_lock_not_owned';
  end if;
  if p_outcome = 'retryable' and p_next_attempt_at is null then raise exception 'retry_time_required'; end if;
  if p_outcome = 'succeeded' and (p_provider_order_id is null or p_provider_reward_id is null) then
    raise exception 'provider_references_required';
  end if;

  update public.raffle_fulfillment_jobs
  set state = p_outcome,
      provider_order_id = coalesce(p_provider_order_id, provider_order_id),
      provider_reward_id = coalesce(p_provider_reward_id, provider_reward_id),
      sanitized_status = left(nullif(trim(p_sanitized_status), ''), 100),
      sanitized_error_code = left(nullif(trim(p_error_code), ''), 100),
      next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
      submitted_at = case when p_outcome in ('submitting', 'reconciling', 'succeeded') then coalesce(submitted_at, now()) else submitted_at end,
      reconciled_at = case when p_outcome = 'succeeded' then now() else reconciled_at end,
      locked_by = null, locked_at = null, lock_expires_at = null, updated_at = now()
  where id = p_job_id;

  if p_outcome = 'succeeded' then
    update public.raffle_draw_results
    set fulfillment_status = 'delivered', status = 'fulfilled', updated_at = now()
    where id = job_row.draw_result_id;
  elsif p_outcome = 'failed' then
    update public.raffle_draw_results set fulfillment_status = 'failed', updated_at = now()
    where id = job_row.draw_result_id;
  end if;

  return true;
end;
$$;

create or replace function public.unlock_raffle_reward_link(
  p_draw_result_id uuid,
  p_new_limit integer,
  p_actor_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.raffle_draw_results%rowtype;
  cycle_row public.raffle_cycles%rowtype;
  job_row public.raffle_fulfillment_jobs%rowtype;
begin
  perform private.assert_raffle_service_caller();
  if p_actor_id is null or p_new_limit not between 6 and 10 then
    raise exception 'invalid_reward_link_unlock';
  end if;

  select * into result_row from public.raffle_draw_results
  where id = p_draw_result_id for update;
  if not found then raise exception 'raffle_result_not_found'; end if;
  select * into cycle_row from public.raffle_cycles
  where id = result_row.cycle_id for update;
  select * into job_row from public.raffle_fulfillment_jobs
  where draw_result_id = result_row.id for update;

  if cycle_row.id is null or cycle_row.status not in ('drawn', 'complete')
    or p_now > cycle_row.expires_at
    or result_row.status <> 'fulfilled'
    or result_row.reward_route <> 'digital'
    or result_row.fulfillment_status <> 'delivered'
    or job_row.id is null
    or job_row.state <> 'succeeded'
    or job_row.provider_reward_id is null
    or not exists (
      select 1 from public.raffle_provider_configs config
      where config.id = job_row.provider_config_id and config.status = 'active'
    ) then
    raise exception 'reward_link_not_unlockable';
  end if;
  if p_new_limit < job_row.link_generation_count
    or p_new_limit < job_row.link_generation_limit then
    raise exception 'reward_link_limit_cannot_decrease';
  end if;
  if p_new_limit = job_row.link_generation_limit then
    return jsonb_build_object(
      'linkGenerationCount', job_row.link_generation_count,
      'linkGenerationLimit', job_row.link_generation_limit,
      'duplicate', true
    );
  end if;

  update public.raffle_fulfillment_jobs
  set link_generation_limit = p_new_limit,
      link_generation_unlocked_at = p_now,
      link_generation_unlocked_by = p_actor_id,
      updated_at = p_now
  where id = job_row.id;

  insert into public.raffle_audit_events (
    cycle_id, draw_id, draw_result_id, member_id, actor_id,
    event_type, event_at, sanitized_data
  ) values (
    result_row.cycle_id, result_row.draw_id, result_row.id,
    result_row.member_id, p_actor_id, 'reward_link_limit_unlocked', p_now,
    jsonb_build_object(
      'linkGenerationCount', job_row.link_generation_count,
      'linkGenerationLimit', p_new_limit,
      'outcome', 'unlocked'
    )
  );

  return jsonb_build_object(
    'linkGenerationCount', job_row.link_generation_count,
    'linkGenerationLimit', p_new_limit,
    'duplicate', false
  );
end;
$$;

create or replace function public.reserve_raffle_reward_link(
  p_draw_result_id uuid,
  p_member_id uuid,
  p_now timestamptz default now()
)
returns table (
  job_id uuid,
  provider_config_id uuid,
  provider_reward_id text,
  link_generation_count integer,
  last_link_generated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
begin
  perform private.assert_raffle_service_caller();
  perform p_draw_result_id, p_member_id, p_now;
  job_id := null;
  provider_config_id := null;
  provider_reward_id := null;
  link_generation_count := null;
  last_link_generated_at := null;
  -- The core release deliberately cannot reserve or consume a link-generation
  -- allowance. A later fixed-egress relay release must replace this fail-closed
  -- compatibility contract with an atomic post-retrieval completion protocol.
  raise exception 'reward_link_relay_handoff_not_active';
end;
$$;

create or replace function public.claim_raffle_provider_events(
  p_worker_id text,
  p_limit integer default 10,
  p_lock_seconds integer default 60
)
returns setof public.raffle_provider_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_raffle_service_caller();
  if p_worker_id is null or char_length(trim(p_worker_id)) not between 8 and 120 then
    raise exception 'invalid_worker_id';
  end if;
  if p_limit not between 1 and 25 or p_lock_seconds not between 30 and 300 then
    raise exception 'invalid_event_claim_limits';
  end if;

  insert into public.raffle_audit_events (
    event_type, dedupe_key, sanitized_data
  )
  select 'provider_event_attempt_limit_reached',
    'raffle:' || event.id::text || ':event-attempt-limit',
    jsonb_build_object('errorCode', 'attempt_limit_reached', 'attemptCount', event.attempt_count)
  from public.raffle_provider_events event
  where event.attempt_count >= 50
    and event.processing_status in ('queued', 'failed', 'processing')
    and (event.lock_expires_at is null or event.lock_expires_at <= now())
  on conflict (dedupe_key) do nothing;

  update public.raffle_provider_events
  set processing_status = 'dead_letter',
      sanitized_error_code = 'attempt_limit_reached',
      locked_by = null, locked_at = null, lock_expires_at = null,
      processed_at = now(), updated_at = now()
  where attempt_count >= 50
    and processing_status in ('queued', 'failed', 'processing')
    and (lock_expires_at is null or lock_expires_at <= now());

  return query
  with due as (
    select event.id
    from public.raffle_provider_events event
    where event.processing_status in ('queued', 'failed', 'processing')
      and event.attempt_count < 50
      and event.next_attempt_at <= now()
      and (
        (event.processing_status in ('queued', 'failed') and (event.lock_expires_at is null or event.lock_expires_at <= now()))
        or (event.processing_status = 'processing' and event.lock_expires_at <= now())
      )
    order by event.next_attempt_at, event.received_at
    for update of event skip locked
    limit p_limit
  )
  update public.raffle_provider_events event
  set processing_status = 'processing',
      locked_by = trim(p_worker_id), locked_at = now(),
      lock_expires_at = now() + make_interval(secs => p_lock_seconds),
      attempt_count = event.attempt_count + 1, updated_at = now()
  from due
  where event.id = due.id
  returning event.*;
end;
$$;

create or replace function public.complete_raffle_provider_event(
  p_event_id uuid,
  p_worker_id text,
  p_outcome text,
  p_error_code text default null,
  p_next_attempt_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.raffle_provider_events%rowtype;
begin
  perform private.assert_raffle_service_caller();
  if p_outcome not in ('processed', 'ignored', 'failed') then
    raise exception 'invalid_event_outcome';
  end if;
  if p_outcome = 'failed' and p_next_attempt_at is null then
    raise exception 'event_retry_time_required';
  end if;

  select * into event_row from public.raffle_provider_events
  where id = p_event_id for update;
  if not found then return false; end if;
  if event_row.processing_status <> 'processing'
    or event_row.locked_by is distinct from trim(p_worker_id)
    or event_row.lock_expires_at <= now() then
    raise exception 'event_lock_not_owned';
  end if;

  update public.raffle_provider_events
  set processing_status = p_outcome,
      sanitized_error_code = left(nullif(trim(p_error_code), ''), 100),
      next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
      processed_at = case when p_outcome in ('processed', 'ignored') then now() else null end,
      locked_by = null, locked_at = null, lock_expires_at = null, updated_at = now()
  where id = p_event_id;

  return true;
end;
$$;

create or replace function public.apply_raffle_provider_reward_state(
  p_event_id uuid,
  p_worker_id text,
  p_provider_reward_id text,
  p_reward_state text,
  p_delivery_state text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.raffle_provider_events%rowtype;
  job_row public.raffle_fulfillment_jobs%rowtype;
  normalized_reward_state text := lower(trim(coalesce(p_reward_state, '')));
  normalized_delivery_state text := lower(trim(coalesce(p_delivery_state, '')));
begin
  perform private.assert_raffle_service_caller();
  if p_worker_id is null or char_length(trim(p_worker_id)) not between 8 and 120 then
    raise exception 'invalid_worker_id';
  end if;
  if normalized_reward_state not in ('active', 'succeeded', 'flagged', 'cancelled')
    or normalized_delivery_state not in ('pending', 'succeeded', 'failed', 'cancelled', 'unknown') then
    raise exception 'invalid_reward_state';
  end if;

  select * into event_row from public.raffle_provider_events
  where id = p_event_id for update;
  if not found then return false; end if;
  if event_row.processing_status <> 'processing'
    or event_row.locked_by is distinct from trim(p_worker_id)
    or event_row.lock_expires_at <= now() then
    raise exception 'event_lock_not_owned';
  end if;

  select * into job_row from public.raffle_fulfillment_jobs
  where provider_config_id = event_row.provider_config_id
    and provider_reward_id = p_provider_reward_id
  for update;
  if not found then return false; end if;

  if normalized_reward_state = 'flagged' or normalized_delivery_state = 'failed' then
    update public.raffle_fulfillment_jobs
    set state = 'failed', sanitized_status = normalized_reward_state,
        sanitized_error_code = 'reward_unavailable', updated_at = now()
    where id = job_row.id;
    update public.raffle_draw_results
    set fulfillment_status = 'failed', updated_at = now()
    where id = job_row.draw_result_id;
  elsif normalized_reward_state = 'cancelled' or normalized_delivery_state = 'cancelled' then
    update public.raffle_fulfillment_jobs
    set state = 'cancelled', sanitized_status = normalized_reward_state,
        sanitized_error_code = 'reward_cancelled', updated_at = now()
    where id = job_row.id;
    update public.raffle_draw_results
    set fulfillment_status = 'failed', updated_at = now()
    where id = job_row.draw_result_id;
  else
    -- A successful LINK delivery only proves that a private link is active.
    -- It is deliberately not recorded as recipient redemption.
    update public.raffle_fulfillment_jobs
    set sanitized_status = case
      when normalized_delivery_state = 'succeeded' then 'link_active'
      else normalized_reward_state
    end,
    updated_at = now()
    where id = job_row.id;
  end if;

  return true;
end;
$$;

-- The leaderboard is stricter than gallery access: only a currently Discord-
-- verified guild member may view it or remain in its ranked participant set.
-- Manual gallery approval is intentionally not an alternate authorization.
create or replace function private.raffle_member_is_current(
  target_user_id uuid,
  p_now timestamptz default statement_timestamp()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.member_profiles profile
    where profile.id = target_user_id
      and profile.member_status = 'active'
      and profile.has_required_discord_roles is true
      and profile.discord_verified_at is not null
      and profile.discord_verified_at >= p_now - interval '7 days'
      and profile.discord_verified_at <= p_now + interval '5 minutes'
  );
$$;

-- Existing member names predate the private leaderboard contract. Contain any
-- legacy control or bidi characters at the aggregate boundary so one row can
-- never suppress the entire verified-member response.
create or replace function private.raffle_safe_display_name(p_value text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_value is not null
      and p_value = btrim(p_value)
      and char_length(p_value) between 2 and 40
      and p_value !~ '[[:cntrl:]]'
      and translate(
        p_value,
        chr(1564) || chr(8206) || chr(8207)
          || chr(8234) || chr(8235) || chr(8236) || chr(8237) || chr(8238)
          || chr(8294) || chr(8295) || chr(8296) || chr(8297),
        ''
      ) = p_value
      then p_value
    else 'Mōchī Member'
  end;
$$;

create or replace function public.get_current_raffle_leaderboard(
  p_viewer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cycle_row public.raffle_cycles%rowtype;
  entries_payload jsonb := '[]'::jsonb;
  participant_total integer := 0;
begin
  perform private.assert_raffle_service_caller();

  if p_viewer_id is null
    or not private.raffle_member_is_current(p_viewer_id) then
    raise exception 'raffle_member_access_required' using errcode = '42501';
  end if;

  select cycle.*
  into cycle_row
  from public.raffle_cycles cycle
  where cycle.status in ('ready', 'open', 'frozen', 'drawn', 'complete')
    and cycle.expires_at >= statement_timestamp()
  order by
    case cycle.status
      when 'open' then 0
      when 'frozen' then 1
      when 'ready' then 2
      when 'drawn' then 3
      when 'complete' then 4
      else 5
    end,
    case when cycle.status = 'ready' then cycle.draw_at end asc nulls last,
    cycle.draw_at desc
  limit 1;

  if not found then
    return null;
  end if;

  with bonus_counts as (
    select
      bonus.entry_id,
      count(*)::integer as bonus_count
    from public.raffle_bonus_awards bonus
    where bonus.cycle_id = cycle_row.id
      and bonus.revoked_at is null
    group by bonus.entry_id
  ),
  bounded_entries as (
    select
      entry.member_id,
      least(
        cycle_row.max_entries::integer,
        case
          when entry.eligibility_status = 'frozen'
            then coalesce(entry.frozen_entry_count, 0)::integer
          else entry.base_entry_count::integer
            + least(
              cycle_row.max_bonus_entries::integer,
              coalesce(bonus.bonus_count, 0)
            )
        end
      ) as entry_count
    from public.raffle_entries entry
    left join bonus_counts bonus on bonus.entry_id = entry.id
    where entry.cycle_id = cycle_row.id
      and entry.eligibility_status in ('eligible', 'frozen')
      and entry.withdrawn_at is null
      and private.raffle_member_is_current(entry.member_id)
  ),
  ranked_entries as (
    select
      bounded.member_id,
      bounded.entry_count,
      dense_rank() over (order by bounded.entry_count desc) as participant_rank,
      count(*) over ()::integer as participant_count
    from bounded_entries bounded
    where bounded.entry_count between 1 and 10
  ),
  visible_entries as (
    select
      ranked.participant_rank,
      private.raffle_safe_display_name(profile.display_name) as display_name,
      ranked.entry_count,
      ranked.member_id = p_viewer_id as is_viewer,
      ranked.participant_count,
      ranked.member_id
    from ranked_entries ranked
    join public.member_profiles profile on profile.id = ranked.member_id
    order by
      ranked.participant_rank,
      lower(private.raffle_safe_display_name(profile.display_name)) collate "C",
      private.raffle_safe_display_name(profile.display_name) collate "C",
      ranked.member_id
    limit 250
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank', visible.participant_rank,
          'displayName', visible.display_name,
          'entryCount', visible.entry_count,
          'isViewer', visible.is_viewer
        )
        order by
          visible.participant_rank,
          lower(visible.display_name) collate "C",
          visible.display_name collate "C",
          visible.member_id
      ),
      '[]'::jsonb
    ),
    coalesce(max(visible.participant_count), 0)
  into entries_payload, participant_total
  from visible_entries visible;

  return jsonb_build_object(
    'cyclePublicId', cycle_row.public_cycle_id,
    'cycleStatus', cycle_row.status,
    'closesAt', cycle_row.closes_at,
    'drawAt', cycle_row.draw_at,
    'maximumEntries', cycle_row.max_entries,
    'participantCount', participant_total,
    'entries', entries_payload
  );
end;
$$;

-- The RLS policy is intentionally false for browser roles. Edge Functions use
-- a service key and still expose only explicit DTO fields.
alter table public.raffle_cycles enable row level security;
alter table public.raffle_entries enable row level security;
alter table public.raffle_bonus_awards enable row level security;
alter table public.raffle_draws enable row level security;
alter table public.raffle_draw_results enable row level security;
alter table public.raffle_audit_events enable row level security;
alter table public.raffle_provider_configs enable row level security;
alter table public.raffle_fulfillment_jobs enable row level security;
alter table public.raffle_provider_events enable row level security;

revoke all on table public.raffle_cycles from public, anon, authenticated;
grant all on table public.raffle_cycles to service_role;
drop policy if exists service_only_default_deny on public.raffle_cycles;
create policy service_only_default_deny on public.raffle_cycles
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.raffle_entries from public, anon, authenticated;
grant all on table public.raffle_entries to service_role;
drop policy if exists service_only_default_deny on public.raffle_entries;
create policy service_only_default_deny on public.raffle_entries
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.raffle_bonus_awards from public, anon, authenticated;
grant all on table public.raffle_bonus_awards to service_role;
drop policy if exists service_only_default_deny on public.raffle_bonus_awards;
create policy service_only_default_deny on public.raffle_bonus_awards
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.raffle_draws from public, anon, authenticated;
grant all on table public.raffle_draws to service_role;
drop policy if exists service_only_default_deny on public.raffle_draws;
create policy service_only_default_deny on public.raffle_draws
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.raffle_draw_results from public, anon, authenticated;
grant all on table public.raffle_draw_results to service_role;
drop policy if exists service_only_default_deny on public.raffle_draw_results;
create policy service_only_default_deny on public.raffle_draw_results
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.raffle_audit_events from public, anon, authenticated;
grant all on table public.raffle_audit_events to service_role;
drop policy if exists service_only_default_deny on public.raffle_audit_events;
create policy service_only_default_deny on public.raffle_audit_events
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.raffle_provider_configs from public, anon, authenticated;
grant all on table public.raffle_provider_configs to service_role;
drop policy if exists service_only_default_deny on public.raffle_provider_configs;
create policy service_only_default_deny on public.raffle_provider_configs
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.raffle_fulfillment_jobs from public, anon, authenticated;
grant all on table public.raffle_fulfillment_jobs to service_role;
drop policy if exists service_only_default_deny on public.raffle_fulfillment_jobs;
create policy service_only_default_deny on public.raffle_fulfillment_jobs
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.raffle_provider_events from public, anon, authenticated;
grant all on table public.raffle_provider_events to service_role;
drop policy if exists service_only_default_deny on public.raffle_provider_events;
create policy service_only_default_deny on public.raffle_provider_events
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on function public.open_raffle_cycle(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.review_raffle_entry_eligibility(uuid, uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.manage_raffle_bonus_award(uuid, uuid, text, text, text, boolean, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.submit_raffle_bonus_alternative(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.manage_raffle_member_entry(uuid, uuid, uuid, text, text, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.freeze_raffle_ledger(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_raffle_ledger_hash(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.raffle_audit_data_is_safe(jsonb) from public, anon, authenticated;
revoke all on function public.raffle_country_products_are_safe(jsonb, text[], text[]) from public, anon, authenticated;
revoke all on function public.invalidate_raffle_provider_approvals() from public, anon, authenticated;
revoke all on function public.prevent_raffle_frozen_ledger_mutation() from public, anon, authenticated;
revoke all on function public.prevent_raffle_cycle_contract_mutation() from public, anon, authenticated;
revoke all on function public.prevent_raffle_draw_evidence_mutation() from public, anon, authenticated;
revoke all on function public.prevent_raffle_result_selection_mutation() from public, anon, authenticated;
revoke all on function public.prevent_raffle_fulfillment_snapshot_mutation() from public, anon, authenticated;
revoke all on function public.prevent_raffle_audit_mutation() from public, anon, authenticated;
revoke all on function public.complete_raffle_draw(uuid, text, text, text, text, jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.record_raffle_private_notice(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_raffle_draw_result(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.review_raffle_claim_tax(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.review_raffle_claim_clearance(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.release_raffle_digital_fulfillment(uuid, text, text[], uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_raffle_manual_in_game(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_raffle_fulfillment_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.decline_raffle_draw_result(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_raffle_fulfillment_job(uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.unlock_raffle_reward_link(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_raffle_reward_link(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_raffle_provider_events(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_raffle_provider_event(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.apply_raffle_provider_reward_state(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.consume_raffle_leaderboard_nonce(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_current_raffle_leaderboard(uuid) from public, anon, authenticated;
revoke all on function private.raffle_member_is_current(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.raffle_safe_display_name(text) from public, anon, authenticated;
revoke all on function private.canonical_raffle_draw_results(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.open_raffle_cycle(uuid, uuid, timestamptz) to service_role;
grant execute on function public.review_raffle_entry_eligibility(uuid, uuid, text, text, uuid, timestamptz) to service_role;
grant execute on function public.manage_raffle_bonus_award(uuid, uuid, text, text, text, boolean, text, uuid, timestamptz) to service_role;
grant execute on function public.submit_raffle_bonus_alternative(uuid, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.manage_raffle_member_entry(uuid, uuid, uuid, text, text, boolean, boolean, timestamptz) to service_role;
grant execute on function public.freeze_raffle_ledger(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.record_raffle_ledger_hash(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.raffle_audit_data_is_safe(jsonb) to service_role;
grant execute on function public.raffle_country_products_are_safe(jsonb, text[], text[]) to service_role;
grant execute on function public.invalidate_raffle_provider_approvals() to service_role;
grant execute on function public.prevent_raffle_frozen_ledger_mutation() to service_role;
grant execute on function public.prevent_raffle_cycle_contract_mutation() to service_role;
grant execute on function public.prevent_raffle_draw_evidence_mutation() to service_role;
grant execute on function public.prevent_raffle_result_selection_mutation() to service_role;
grant execute on function public.prevent_raffle_fulfillment_snapshot_mutation() to service_role;
grant execute on function public.prevent_raffle_audit_mutation() to service_role;
grant execute on function public.complete_raffle_draw(uuid, text, text, text, text, jsonb, uuid, timestamptz) to service_role;
grant execute on function public.record_raffle_private_notice(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.claim_raffle_draw_result(uuid, uuid, text) to service_role;
grant execute on function public.review_raffle_claim_tax(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.review_raffle_claim_clearance(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.release_raffle_digital_fulfillment(uuid, text, text[], uuid, timestamptz) to service_role;
grant execute on function public.complete_raffle_manual_in_game(uuid, integer, uuid, timestamptz) to service_role;
grant execute on function public.claim_raffle_fulfillment_jobs(text, integer, integer) to service_role;
grant execute on function public.decline_raffle_draw_result(uuid, uuid) to service_role;
grant execute on function public.complete_raffle_fulfillment_job(uuid, text, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.unlock_raffle_reward_link(uuid, integer, uuid, timestamptz) to service_role;
grant execute on function public.reserve_raffle_reward_link(uuid, uuid, timestamptz) to service_role;
grant execute on function public.claim_raffle_provider_events(text, integer, integer) to service_role;
grant execute on function public.complete_raffle_provider_event(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.apply_raffle_provider_reward_state(uuid, text, text, text, text) to service_role;
grant execute on function public.consume_raffle_leaderboard_nonce(uuid, text, timestamptz) to service_role;
grant execute on function public.get_current_raffle_leaderboard(uuid) to service_role;

commit;
