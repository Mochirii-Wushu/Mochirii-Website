-- Preserve every released v1 receipt while introducing one authoritative v2
-- elimination sequence. The immutable receipt retains the full random proof;
-- the protected singleton retains the complete compact client timeline.

alter table public.spinner_live_state
add column if not exists elimination_plan jsonb,
add column if not exists plan_hash_sha256 text;

alter table public.spinner_live_state
drop constraint if exists spinner_live_state_elimination_plan_check;
alter table public.spinner_live_state
add constraint spinner_live_state_elimination_plan_check
check (
  case
    when elimination_plan is null and plan_hash_sha256 is null then true
    when elimination_plan is null or plan_hash_sha256 is null then false
    when phase = 'idle' or jsonb_typeof(elimination_plan) <> 'array' then false
    else jsonb_array_length(elimination_plan) = jsonb_array_length(participants) - 1
      and jsonb_array_length(elimination_plan) between 1 and 99
      and plan_hash_sha256 ~ '^[0-9a-f]{64}$'
  end
);

alter table public.spinner_draw_receipts
add column if not exists elimination_plan jsonb,
add column if not exists plan_hash_sha256 text;

alter table public.spinner_draw_receipts
alter column rejection_limit drop not null,
alter column sampled_words drop not null,
alter column accepted_word drop not null;

alter table public.spinner_draw_receipts
drop constraint if exists spinner_draw_receipts_versions_check;
alter table public.spinner_draw_receipts
add constraint spinner_draw_receipts_versions_check
check (
  case receipt ->> 'version'
    when '1' then
      app_version = '1.0.0'
      and algorithm_version = 'uniform-uint32-rejection-v1'
      and elimination_plan is null
      and plan_hash_sha256 is null
    when '2' then
      app_version = '2.0.0'
      and algorithm_version = 'uniform-elimination-uint32-rejection-v2'
      and elimination_plan is not null
      and plan_hash_sha256 is not null
    else false
  end
);

alter table public.spinner_draw_receipts
drop constraint if exists spinner_draw_receipts_words_check;
alter table public.spinner_draw_receipts
add constraint spinner_draw_receipts_words_check
check (
  case receipt ->> 'version'
    when '1' then case
      when rejection_limit is null
        or sampled_words is null
        or accepted_word is null
        or jsonb_typeof(sampled_words) <> 'array'
      then false
      else rejection_limit between 1 and 4294967296
        and jsonb_array_length(sampled_words) >= 1
        and accepted_word between 0 and 4294967295
    end
    when '2' then
      rejection_limit is null
      and sampled_words is null
      and accepted_word is null
    else false
  end
);

alter table public.spinner_draw_receipts
drop constraint if exists spinner_draw_receipts_elimination_plan_check;
alter table public.spinner_draw_receipts
add constraint spinner_draw_receipts_elimination_plan_check
check (
  case receipt ->> 'version'
    when '1' then elimination_plan is null and plan_hash_sha256 is null
    when '2' then case
      when jsonb_typeof(elimination_plan) <> 'array'
        or jsonb_typeof(roster_snapshot -> 'participants') <> 'array'
      then false
      else
        jsonb_array_length(elimination_plan) =
          jsonb_array_length(roster_snapshot -> 'participants') - 1
        and jsonb_array_length(elimination_plan) between 1 and 99
        and plan_hash_sha256 ~ '^[0-9a-f]{64}$'
        and coalesce(
          receipt ->> 'planHashSha256' = plan_hash_sha256,
          false
        )
    end
    else false
  end
);

create or replace function private.spinner_snapshot_json(
  p_state public.spinner_live_state,
  p_include_winner boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_state.elimination_plan is null then
      jsonb_build_object(
        'version', 1,
        'sessionId', p_state.session_id,
        'revision', p_state.revision,
        'phase', p_state.phase,
        'drawMode', p_state.draw_mode,
        'participants', p_state.participants,
        'startedAt', p_state.started_at,
        'revealAt', p_state.reveal_at,
        'durationMs', p_state.duration_ms,
        'startRotation', p_state.start_rotation,
        'finalRotation', p_state.final_rotation,
        'selectedIndex', case when p_include_winner then p_state.selected_index else null end,
        'winner', case when p_include_winner then p_state.winner else null end,
        'drawId', p_state.draw_id,
        'updatedAt', p_state.updated_at
      )
    else
      jsonb_build_object(
        'version', 2,
        'sessionId', p_state.session_id,
        'revision', p_state.revision,
        'phase', p_state.phase,
        'drawMode', p_state.draw_mode,
        'participants', p_state.participants,
        'startedAt', p_state.started_at,
        'revealAt', p_state.reveal_at,
        'durationMs', p_state.duration_ms,
        'startRotation', p_state.start_rotation,
        'finalRotation', p_state.final_rotation,
        'planHashSha256', p_state.plan_hash_sha256,
        'rounds', p_state.elimination_plan,
        'selectedIndex', case
          when p_include_winner and p_state.phase = 'revealed'
            then p_state.selected_index
          else null
        end,
        'winner', case
          when p_include_winner and p_state.phase = 'revealed'
            then p_state.winner
          else null
        end,
        'drawId', p_state.draw_id,
        'updatedAt', p_state.updated_at
      )
  end;
$$;

revoke all on function private.spinner_snapshot_json(public.spinner_live_state, boolean) from public, anon, authenticated;
grant execute on function private.spinner_snapshot_json(public.spinner_live_state, boolean) to service_role;

create or replace function public.spinner_apply_command(
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_row public.spinner_commands%rowtype;
  state_row public.spinner_live_state%rowtype;
  snapshot jsonb;
  receipt_value jsonb;
  participant_count integer;
  participant_value jsonb;
  participant_ids text[] := array[]::text[];
  next_revision bigint;
  next_session_id uuid;
  draw_id_value uuid;
  receipt_timestamp_value timestamptz;
  started_at_value timestamptz;
  reveal_at_value timestamptz;
  p_payload jsonb;
  full_rounds jsonb;
  compact_plan jsonb := '[]'::jsonb;
  active_participants jsonb;
  round_count integer;
  round_value jsonb;
  round_selected_index integer;
  round_active_count integer;
  round_eliminated_id text;
  eliminated_ids text[] := array[]::text[];
  eliminated_participant jsonb;
  round_rejection_limit bigint;
  expected_rejection_limit bigint;
  sampled_words jsonb;
  sampled_words_text text;
  sampled_word_value jsonb;
  sampled_word bigint;
  accepted_word bigint;
  round_started_at timestamptz;
  round_reveal_at timestamptz;
  round_start_rotation double precision;
  round_final_rotation double precision;
  expected_start_rotation double precision;
  expected_target_rotation double precision;
  expected_alignment_travel double precision;
  expected_final_rotation double precision;
  top_start_rotation double precision;
  top_final_rotation double precision;
  winner_original_index integer := -1;
  final_survivor jsonb;
  plan_hash_value text;
  computed_plan_hash text;
  canonical_rounds_text text := '';
  canonical_plan_text text;
  receipt_valid boolean := true;
  v2_payload boolean := false;
begin
  -- Preserve the released lock order: command first, singleton state second.
  select * into command_row
  from public.spinner_commands
  where command_id = p_command_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'command_not_reserved');
  end if;

  if command_row.status = 'applied' then
    return jsonb_build_object(
      'ok', true,
      'snapshot', command_row.response_snapshot,
      'receipt', command_row.response_receipt,
      'idempotentReplay', true
    );
  end if;

  if command_row.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(command_row.error_code, 'command_rejected')
    );
  end if;

  p_payload := command_row.staged_payload;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'command_not_staged');
  end if;

  select * into state_row
  from public.spinner_live_state
  where singleton_id = 1
  for update;

  if state_row.revision <> command_row.expected_revision then
    update public.spinner_commands
    set status = 'rejected', error_code = 'revision_conflict', completed_at = now()
    where command_id = p_command_id;
    return jsonb_build_object(
      'ok', false,
      'error', 'revision_conflict',
      'revision', state_row.revision
    );
  end if;

  next_revision := state_row.revision + 1;

  if command_row.action = 'set_roster' then
    if state_row.phase = 'spinning' and state_row.reveal_at > now() then
      update public.spinner_commands
      set status = 'rejected', error_code = 'draw_in_progress', completed_at = now()
      where command_id = p_command_id;
      return jsonb_build_object('ok', false, 'error', 'draw_in_progress');
    end if;

    if jsonb_typeof(p_payload -> 'participants') <> 'array' then
      update public.spinner_commands
      set status = 'rejected', error_code = 'invalid_roster', completed_at = now()
      where command_id = p_command_id;
      return jsonb_build_object('ok', false, 'error', 'invalid_roster');
    end if;

    participant_count := jsonb_array_length(p_payload -> 'participants');
    if participant_count > 100 then
      update public.spinner_commands
      set status = 'rejected', error_code = 'invalid_roster', completed_at = now()
      where command_id = p_command_id;
      return jsonb_build_object('ok', false, 'error', 'invalid_roster');
    end if;

    update public.spinner_live_state
    set revision = next_revision,
      phase = 'idle',
      participants = p_payload -> 'participants',
      roster_hash_sha256 = p_payload ->> 'rosterHashSha256',
      draw_id = null,
      started_at = null,
      reveal_at = null,
      duration_ms = 0,
      start_rotation = 0,
      final_rotation = 0,
      selected_index = null,
      winner = null,
      elimination_plan = null,
      plan_hash_sha256 = null,
      updated_by = command_row.actor_id,
      updated_at = now()
    where singleton_id = 1
    returning * into state_row;

  elsif command_row.action = 'spin' then
    if state_row.phase = 'spinning' and state_row.reveal_at > now() then
      update public.spinner_commands
      set status = 'rejected', error_code = 'draw_in_progress', completed_at = now()
      where command_id = p_command_id;
      return jsonb_build_object('ok', false, 'error', 'draw_in_progress');
    end if;

    participant_count := jsonb_array_length(state_row.participants);
    if participant_count < 2 or participant_count > 100 then
      update public.spinner_commands
      set status = 'rejected', error_code = 'invalid_roster', completed_at = now()
      where command_id = p_command_id;
      return jsonb_build_object('ok', false, 'error', 'invalid_roster');
    end if;

    receipt_value := p_payload -> 'receipt';
    if receipt_value is not null
      and jsonb_typeof(receipt_value) = 'object'
      and receipt_value ->> 'version' = '1'
      and not (p_payload ? 'version')
    then
      -- Rolling-deploy compatibility: an already-staged released v1 command
      -- must remain resumable after this forward migration. This branch keeps
      -- the exact released three-minute/single-selection mechanics and writes
      -- no v2 plan fields.
      begin
        draw_id_value := (receipt_value ->> 'drawId')::uuid;
        receipt_timestamp_value :=
          (receipt_value ->> 'timestampIso')::timestamptz;
        started_at_value := (p_payload ->> 'startAt')::timestamptz;
        reveal_at_value := (p_payload ->> 'revealAt')::timestamptz;
        top_start_rotation :=
          (p_payload ->> 'startRotation')::double precision;
        top_final_rotation :=
          (p_payload ->> 'finalRotation')::double precision;

        if receipt_value -> 'rosterSnapshot' -> 'participants' <>
            state_row.participants
          or receipt_value ->> 'rosterHashSha256' <>
            state_row.roster_hash_sha256
          or (receipt_value ->> 'selectedIndex')::integer < 0
          or (receipt_value ->> 'selectedIndex')::integer >= participant_count
          or receipt_value -> 'winner' <>
            state_row.participants ->
              ((receipt_value ->> 'selectedIndex')::integer)
          or started_at_value <>
            receipt_timestamp_value + interval '3 minutes'
          or reveal_at_value <= started_at_value
          or extract(epoch from (reveal_at_value - started_at_value)) * 1000 <>
            (p_payload ->> 'durationMs')::integer
        then
          receipt_valid := false;
        end if;
      exception
        when invalid_text_representation
          or numeric_value_out_of_range
          or invalid_datetime_format
          or datetime_field_overflow
          or invalid_parameter_value
        then
          receipt_valid := false;
      end;
    else
      v2_payload := true;
    if receipt_value is null
      or jsonb_typeof(receipt_value) <> 'object'
      or not (p_payload ?& array[
        'version', 'receipt', 'planHashSha256', 'rounds', 'startAt',
        'revealAt', 'durationMs', 'startRotation', 'finalRotation',
        'discordChannelKey', 'discordChannelId', 'discordStartPayload',
        'discordResultPayload', 'animationManifest',
        'animationManifestHashSha256'
      ])
      or jsonb_typeof(p_payload -> 'version') <> 'number'
      or p_payload ->> 'version' <> '2'
      or jsonb_typeof(p_payload -> 'rounds') <> 'array'
      or jsonb_typeof(p_payload -> 'planHashSha256') <> 'string'
      or jsonb_typeof(p_payload -> 'durationMs') <> 'number'
      or jsonb_typeof(p_payload -> 'startAt') <> 'string'
      or jsonb_typeof(p_payload -> 'revealAt') <> 'string'
      or jsonb_typeof(p_payload -> 'startRotation') <> 'number'
      or jsonb_typeof(p_payload -> 'finalRotation') <> 'number'
      or jsonb_typeof(p_payload -> 'discordChannelKey') <> 'string'
      or jsonb_typeof(p_payload -> 'discordChannelId') <> 'string'
      or jsonb_typeof(p_payload -> 'discordStartPayload') <> 'object'
      or jsonb_typeof(p_payload -> 'discordResultPayload') <> 'object'
      or jsonb_typeof(p_payload -> 'animationManifest') <> 'object'
      or jsonb_typeof(p_payload -> 'animationManifestHashSha256') <> 'string'
      or p_payload ->> 'animationManifestHashSha256' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(receipt_value -> 'version') <> 'number'
      or receipt_value ->> 'version' <> '2'
      or not (receipt_value ?& array[
        'version', 'drawMode', 'drawId', 'timestampIso', 'singaporeTime',
        'appVersion', 'algorithmVersion', 'rosterSnapshot',
        'rosterHashSha256', 'planHashSha256', 'durationMs', 'startAt',
        'revealAt', 'startRotation', 'finalRotation', 'rounds',
        'selectedIndex', 'winner'
      ])
      or receipt_value - array[
        'version', 'drawMode', 'drawId', 'timestampIso', 'singaporeTime',
        'appVersion', 'algorithmVersion', 'rosterSnapshot',
        'rosterHashSha256', 'planHashSha256', 'durationMs', 'startAt',
        'revealAt', 'startRotation', 'finalRotation', 'rounds',
        'selectedIndex', 'winner'
      ] <> '{}'::jsonb
    then
      receipt_valid := false;
    end if;

    if receipt_valid then
      begin
        if jsonb_typeof(receipt_value -> 'drawMode') <> 'string'
          or receipt_value ->> 'drawMode' not in ('official', 'test')
          or jsonb_typeof(receipt_value -> 'drawId') <> 'string'
          or receipt_value ->> 'drawId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or jsonb_typeof(receipt_value -> 'timestampIso') <> 'string'
          or jsonb_typeof(receipt_value -> 'singaporeTime') <> 'string'
          or jsonb_typeof(receipt_value -> 'appVersion') <> 'string'
          or receipt_value ->> 'appVersion' <> '2.0.0'
          or jsonb_typeof(receipt_value -> 'algorithmVersion') <> 'string'
          or receipt_value ->> 'algorithmVersion' <>
            'uniform-elimination-uint32-rejection-v2'
          or jsonb_typeof(receipt_value -> 'rosterSnapshot') <> 'object'
          or not ((receipt_value -> 'rosterSnapshot') ?&
            array['version', 'participants'])
          or (receipt_value -> 'rosterSnapshot') -
            array['version', 'participants'] <> '{}'::jsonb
          or jsonb_typeof(receipt_value -> 'rosterSnapshot' -> 'version') <>
            'number'
          or receipt_value -> 'rosterSnapshot' ->> 'version' <> '1'
          or jsonb_typeof(
            receipt_value -> 'rosterSnapshot' -> 'participants'
          ) <> 'array'
          or receipt_value -> 'rosterSnapshot' -> 'participants' <>
            state_row.participants
          or jsonb_typeof(receipt_value -> 'rosterHashSha256') <> 'string'
          or state_row.roster_hash_sha256 is null
          or state_row.roster_hash_sha256 !~ '^[0-9a-f]{64}$'
          or receipt_value ->> 'rosterHashSha256' <>
            state_row.roster_hash_sha256
          or jsonb_typeof(receipt_value -> 'planHashSha256') <> 'string'
          or receipt_value ->> 'planHashSha256' !~ '^[0-9a-f]{64}$'
          or receipt_value ->> 'planHashSha256' <>
            p_payload ->> 'planHashSha256'
          or jsonb_typeof(receipt_value -> 'durationMs') <> 'number'
          or receipt_value ->> 'durationMs' <> '5000'
          or p_payload -> 'durationMs' <> receipt_value -> 'durationMs'
          or p_payload -> 'startAt' <> receipt_value -> 'startAt'
          or p_payload -> 'revealAt' <> receipt_value -> 'revealAt'
          or p_payload -> 'startRotation' <> receipt_value -> 'startRotation'
          or p_payload -> 'finalRotation' <> receipt_value -> 'finalRotation'
          or jsonb_typeof(receipt_value -> 'startAt') <> 'string'
          or jsonb_typeof(receipt_value -> 'revealAt') <> 'string'
          or jsonb_typeof(receipt_value -> 'startRotation') <> 'number'
          or jsonb_typeof(receipt_value -> 'finalRotation') <> 'number'
          or jsonb_typeof(receipt_value -> 'rounds') <> 'array'
          or jsonb_typeof(receipt_value -> 'selectedIndex') <> 'number'
          or jsonb_typeof(receipt_value -> 'winner') <> 'object'
        then
          receipt_valid := false;
        end if;

        if receipt_valid then
          draw_id_value := (receipt_value ->> 'drawId')::uuid;
          receipt_timestamp_value :=
            (receipt_value ->> 'timestampIso')::timestamptz;
          started_at_value := (receipt_value ->> 'startAt')::timestamptz;
          reveal_at_value := (receipt_value ->> 'revealAt')::timestamptz;
          top_start_rotation :=
            (receipt_value ->> 'startRotation')::double precision;
          top_final_rotation :=
            (receipt_value ->> 'finalRotation')::double precision;
          full_rounds := receipt_value -> 'rounds';
          round_count := jsonb_array_length(full_rounds);
          plan_hash_value := receipt_value ->> 'planHashSha256';

          if started_at_value <> receipt_timestamp_value + interval '60 seconds'
            or round_count <> participant_count - 1
            or p_payload -> 'rounds' <> full_rounds
            or reveal_at_value <>
              started_at_value + round_count * interval '5 seconds'
            or top_start_rotation < 0 or top_start_rotation >= 360
            or top_final_rotation <= top_start_rotation
            or top_final_rotation >= 2880
          then
            receipt_valid := false;
          end if;
        end if;

        if receipt_valid then
          active_participants := state_row.participants;
          for participant_index in 0..participant_count - 1 loop
            participant_value := state_row.participants -> participant_index;
            if jsonb_typeof(participant_value) <> 'object'
              or not (participant_value ?&
                array['version', 'id', 'displayName'])
              or participant_value - array['version', 'id', 'displayName'] <>
                '{}'::jsonb
              or jsonb_typeof(participant_value -> 'version') <> 'number'
              or participant_value ->> 'version' <> '1'
              or jsonb_typeof(participant_value -> 'id') <> 'string'
              or participant_value ->> 'id' !~*
                '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              or jsonb_typeof(participant_value -> 'displayName') <> 'string'
              or char_length(participant_value ->> 'displayName') not between 1 and 40
              or participant_value ->> 'displayName' <>
                btrim(participant_value ->> 'displayName')
              or participant_value ->> 'id' = any(participant_ids)
            then
              receipt_valid := false;
              exit;
            end if;
            participant_ids := array_append(
              participant_ids,
              participant_value ->> 'id'
            );
          end loop;
        end if;

        if receipt_valid then
          expected_start_rotation := top_start_rotation;
          for round_index in 0..round_count - 1 loop
            round_value := full_rounds -> round_index;
            round_active_count := jsonb_array_length(active_participants);

            if jsonb_typeof(round_value) <> 'object'
              or not (round_value ?& array[
                'roundIndex', 'activeCount', 'selectedIndex', 'eliminatedId',
                'eliminatedParticipant', 'rejectionLimit', 'sampledWords',
                'acceptedWord', 'startedAt', 'revealAt', 'startRotation',
                'finalRotation'
              ])
              or round_value - array[
                'roundIndex', 'activeCount', 'selectedIndex', 'eliminatedId',
                'eliminatedParticipant', 'rejectionLimit', 'sampledWords',
                'acceptedWord', 'startedAt', 'revealAt', 'startRotation',
                'finalRotation'
              ] <> '{}'::jsonb
              or jsonb_typeof(round_value -> 'roundIndex') <> 'number'
              or round_value ->> 'roundIndex' !~ '^(0|[1-9][0-9]*)$'
              or jsonb_typeof(round_value -> 'activeCount') <> 'number'
              or round_value ->> 'activeCount' !~ '^(0|[1-9][0-9]*)$'
              or jsonb_typeof(round_value -> 'selectedIndex') <> 'number'
              or round_value ->> 'selectedIndex' !~ '^(0|[1-9][0-9]*)$'
              or jsonb_typeof(round_value -> 'eliminatedId') <> 'string'
              or jsonb_typeof(round_value -> 'eliminatedParticipant') <> 'object'
              or jsonb_typeof(round_value -> 'rejectionLimit') <> 'number'
              or round_value ->> 'rejectionLimit' !~ '^[1-9][0-9]*$'
              or jsonb_typeof(round_value -> 'sampledWords') <> 'array'
              or jsonb_typeof(round_value -> 'acceptedWord') <> 'number'
              or round_value ->> 'acceptedWord' !~ '^(0|[1-9][0-9]*)$'
              or jsonb_typeof(round_value -> 'startedAt') <> 'string'
              or jsonb_typeof(round_value -> 'revealAt') <> 'string'
              or jsonb_typeof(round_value -> 'startRotation') <> 'number'
              or jsonb_typeof(round_value -> 'finalRotation') <> 'number'
            then
              receipt_valid := false;
              exit;
            end if;

            round_selected_index :=
              (round_value ->> 'selectedIndex')::integer;
            round_eliminated_id := round_value ->> 'eliminatedId';
            eliminated_participant :=
              active_participants -> round_selected_index;
            round_rejection_limit :=
              (round_value ->> 'rejectionLimit')::bigint;
            sampled_words := round_value -> 'sampledWords';
            accepted_word := (round_value ->> 'acceptedWord')::bigint;
            round_started_at :=
              (round_value ->> 'startedAt')::timestamptz;
            round_reveal_at :=
              (round_value ->> 'revealAt')::timestamptz;
            round_start_rotation :=
              (round_value ->> 'startRotation')::double precision;
            round_final_rotation :=
              (round_value ->> 'finalRotation')::double precision;
            expected_rejection_limit :=
              (4294967296::bigint / round_active_count::bigint) *
              round_active_count::bigint;

            if (round_value ->> 'roundIndex')::integer <> round_index
              or (round_value ->> 'activeCount')::integer <>
                round_active_count
              or round_selected_index < 0
              or round_selected_index >= round_active_count
              or eliminated_participant is null
              or round_value -> 'eliminatedParticipant' <>
                eliminated_participant
              or round_eliminated_id <>
                eliminated_participant ->> 'id'
              or round_eliminated_id = any(eliminated_ids)
              or round_rejection_limit <> expected_rejection_limit
              or jsonb_array_length(sampled_words) < 1
              or accepted_word < 0 or accepted_word > 4294967295
              or round_started_at <>
                started_at_value + round_index * interval '5 seconds'
              or round_reveal_at <> round_started_at + interval '5 seconds'
              or abs(round_start_rotation - expected_start_rotation) > 1e-9
              or round_start_rotation < 0 or round_start_rotation >= 360
              or round_final_rotation <= round_start_rotation
              or round_final_rotation >= 2880
            then
              receipt_valid := false;
              exit;
            end if;

            sampled_words_text := '';
            for sample_index in 0..jsonb_array_length(sampled_words) - 1 loop
              sampled_word_value := sampled_words -> sample_index;
              if jsonb_typeof(sampled_word_value) <> 'number'
                or sampled_word_value::text !~ '^(0|[1-9][0-9]*)$'
              then
                receipt_valid := false;
                exit;
              end if;

              sampled_word := sampled_word_value::text::bigint;
              if sampled_word < 0 or sampled_word > 4294967295
                or (
                  sample_index < jsonb_array_length(sampled_words) - 1
                  and sampled_word < round_rejection_limit
                )
                or (
                  sample_index = jsonb_array_length(sampled_words) - 1
                  and sampled_word >= round_rejection_limit
                )
              then
                receipt_valid := false;
                exit;
              end if;

              if sample_index > 0 then
                sampled_words_text := sampled_words_text || ',';
              end if;
              sampled_words_text := sampled_words_text || sampled_word_value::text;
            end loop;

            if not receipt_valid then exit; end if;
            if sampled_word <> accepted_word
              or accepted_word % round_active_count <> round_selected_index
            then
              receipt_valid := false;
              exit;
            end if;

            expected_target_rotation :=
              -round_selected_index * (360.0 / round_active_count);
            expected_target_rotation := expected_target_rotation -
              floor(expected_target_rotation / 360.0) * 360.0;
            expected_alignment_travel :=
              expected_target_rotation - round_start_rotation;
            expected_alignment_travel := expected_alignment_travel -
              floor(expected_alignment_travel / 360.0) * 360.0;
            expected_final_rotation := round_start_rotation + 2160.0 +
              expected_alignment_travel;
            if abs(round_final_rotation - expected_final_rotation) > 1e-9 then
              receipt_valid := false;
              exit;
            end if;

            compact_plan := compact_plan || jsonb_build_array(
              jsonb_build_object(
                'roundIndex', round_value -> 'roundIndex',
                'selectedIndex', round_value -> 'selectedIndex',
                'eliminatedId', round_value -> 'eliminatedId',
                'startedAt', round_value -> 'startedAt',
                'revealAt', round_value -> 'revealAt',
                'startRotation', round_value -> 'startRotation',
                'finalRotation', round_value -> 'finalRotation'
              )
            );

            if round_index > 0 then
              canonical_rounds_text := canonical_rounds_text || ',';
            end if;
            canonical_rounds_text := canonical_rounds_text ||
              '{"roundIndex":' || (round_value -> 'roundIndex')::text ||
              ',"activeCount":' || (round_value -> 'activeCount')::text ||
              ',"selectedIndex":' || (round_value -> 'selectedIndex')::text ||
              ',"eliminatedId":' ||
                to_jsonb(round_eliminated_id)::text ||
              ',"eliminatedParticipant":{"version":' ||
                (eliminated_participant -> 'version')::text ||
              ',"id":' || to_jsonb(eliminated_participant ->> 'id')::text ||
              ',"displayName":' ||
                to_jsonb(eliminated_participant ->> 'displayName')::text ||
              '},"rejectionLimit":' ||
                (round_value -> 'rejectionLimit')::text ||
              ',"sampledWords":[' || sampled_words_text || ']' ||
              ',"acceptedWord":' || (round_value -> 'acceptedWord')::text ||
              ',"startedAt":' ||
                to_jsonb(round_value ->> 'startedAt')::text ||
              ',"revealAt":' || to_jsonb(round_value ->> 'revealAt')::text ||
              ',"startRotation":' ||
                (round_value -> 'startRotation')::text ||
              ',"finalRotation":' ||
                (round_value -> 'finalRotation')::text || '}';

            eliminated_ids := array_append(
              eliminated_ids,
              round_eliminated_id
            );
            active_participants :=
              active_participants - round_selected_index;
            expected_start_rotation := round_final_rotation -
              floor(round_final_rotation / 360.0) * 360.0;
          end loop;
        end if;

        if receipt_valid then
          if jsonb_array_length(active_participants) <> 1 then
            receipt_valid := false;
          else
            final_survivor := active_participants -> 0;
            for participant_index in 0..participant_count - 1 loop
              if state_row.participants -> participant_index = final_survivor then
                winner_original_index := participant_index;
                exit;
              end if;
            end loop;

            if receipt_value -> 'winner' <> final_survivor
              or receipt_value ->> 'selectedIndex' !~ '^(0|[1-9][0-9]*)$'
              or (receipt_value ->> 'selectedIndex')::integer <>
                winner_original_index
            then
              receipt_valid := false;
            end if;
          end if;
        end if;

        if receipt_valid then
          expected_target_rotation :=
            -winner_original_index * (360.0 / participant_count);
          expected_target_rotation := expected_target_rotation -
            floor(expected_target_rotation / 360.0) * 360.0;
          expected_alignment_travel :=
            expected_target_rotation - top_start_rotation;
          expected_alignment_travel := expected_alignment_travel -
            floor(expected_alignment_travel / 360.0) * 360.0;
          expected_final_rotation := top_start_rotation + 2160.0 +
            expected_alignment_travel;
          if abs(top_final_rotation - expected_final_rotation) > 1e-9 then
            receipt_valid := false;
          end if;
        end if;

        if receipt_valid then
          canonical_plan_text :=
            '{"version":2,"drawId":' ||
              to_jsonb(receipt_value ->> 'drawId')::text ||
            ',"drawMode":' ||
              to_jsonb(receipt_value ->> 'drawMode')::text ||
            ',"algorithmVersion":' ||
              to_jsonb(receipt_value ->> 'algorithmVersion')::text ||
            ',"rosterHashSha256":' ||
              to_jsonb(receipt_value ->> 'rosterHashSha256')::text ||
            ',"durationMs":' || (receipt_value -> 'durationMs')::text ||
            ',"startAt":' || to_jsonb(receipt_value ->> 'startAt')::text ||
            ',"revealAt":' || to_jsonb(receipt_value ->> 'revealAt')::text ||
            ',"startRotation":' ||
              (receipt_value -> 'startRotation')::text ||
            ',"finalRotation":' ||
              (receipt_value -> 'finalRotation')::text ||
            ',"rounds":[' || canonical_rounds_text || ']' ||
            ',"selectedIndex":' ||
              (receipt_value -> 'selectedIndex')::text ||
            ',"winner":{"version":' ||
              (final_survivor -> 'version')::text ||
            ',"id":' || to_jsonb(final_survivor ->> 'id')::text ||
            ',"displayName":' ||
              to_jsonb(final_survivor ->> 'displayName')::text || '}}';
          computed_plan_hash := encode(
            extensions.digest(convert_to(canonical_plan_text, 'UTF8'), 'sha256'),
            'hex'
          );
          if computed_plan_hash <> plan_hash_value then
            receipt_valid := false;
          end if;
        end if;
      exception
        when invalid_text_representation
          or numeric_value_out_of_range
          or invalid_datetime_format
          or datetime_field_overflow
          or invalid_parameter_value
          or division_by_zero
        then
          receipt_valid := false;
      end;
    end if;
    end if;

    if not receipt_valid then
      update public.spinner_commands
      set status = 'rejected', error_code = 'invalid_receipt', completed_at = now()
      where command_id = p_command_id;
      return jsonb_build_object('ok', false, 'error', 'invalid_receipt');
    end if;

    insert into public.spinner_draw_receipts (
      draw_id,
      command_id,
      session_id,
      revision,
      actor_id,
      timestamp_iso,
      singapore_time,
      app_version,
      algorithm_version,
      roster_snapshot,
      roster_hash_sha256,
      rejection_limit,
      sampled_words,
      accepted_word,
      selected_index,
      winner,
      receipt,
      elimination_plan,
      plan_hash_sha256
    ) values (
      draw_id_value,
      command_row.command_id,
      state_row.session_id,
      next_revision,
      command_row.actor_id,
      receipt_timestamp_value,
      receipt_value ->> 'singaporeTime',
      receipt_value ->> 'appVersion',
      receipt_value ->> 'algorithmVersion',
      receipt_value -> 'rosterSnapshot',
      receipt_value ->> 'rosterHashSha256',
      case when v2_payload
        then null
        else (receipt_value ->> 'rejectionLimit')::bigint
      end,
      case when v2_payload
        then null
        else receipt_value -> 'sampledWords'
      end,
      case when v2_payload
        then null
        else (receipt_value ->> 'acceptedWord')::bigint
      end,
      (receipt_value ->> 'selectedIndex')::integer,
      receipt_value -> 'winner',
      receipt_value,
      case when v2_payload then compact_plan else null end,
      case when v2_payload then plan_hash_value else null end
    );

    insert into public.spinner_discord_outbox (
      draw_id,
      channel_key,
      channel_id,
      start_payload,
      result_payload,
      reveal_after
    ) values (
      draw_id_value,
      p_payload ->> 'discordChannelKey',
      p_payload ->> 'discordChannelId',
      p_payload -> 'discordStartPayload',
      p_payload -> 'discordResultPayload',
      reveal_at_value
    );

    update public.spinner_live_state
    set revision = next_revision,
      phase = 'spinning',
      roster_hash_sha256 = receipt_value ->> 'rosterHashSha256',
      draw_id = draw_id_value,
      started_at = started_at_value,
      reveal_at = reveal_at_value,
      duration_ms = (p_payload ->> 'durationMs')::integer,
      start_rotation = (p_payload ->> 'startRotation')::numeric,
      final_rotation = (p_payload ->> 'finalRotation')::numeric,
      selected_index = (receipt_value ->> 'selectedIndex')::integer,
      winner = receipt_value -> 'winner',
      elimination_plan = case when v2_payload then compact_plan else null end,
      plan_hash_sha256 = case when v2_payload then plan_hash_value else null end,
      updated_by = command_row.actor_id,
      updated_at = now()
    where singleton_id = 1
    returning * into state_row;

  elsif command_row.action = 'reset' then
    next_session_id := gen_random_uuid();
    update public.spinner_live_state
    set session_id = next_session_id,
      revision = next_revision,
      phase = 'idle',
      draw_id = null,
      started_at = null,
      reveal_at = null,
      duration_ms = 0,
      start_rotation = final_rotation,
      selected_index = null,
      winner = null,
      elimination_plan = null,
      plan_hash_sha256 = null,
      updated_by = command_row.actor_id,
      updated_at = now()
    where singleton_id = 1
    returning * into state_row;
  end if;

  snapshot := private.spinner_snapshot_json(state_row, true);

  update public.spinner_commands
  set status = 'applied',
    response_snapshot = snapshot,
    response_receipt = case
      when command_row.action = 'spin' then receipt_value
      else null
    end,
    completed_at = now()
  where command_id = p_command_id;

  return jsonb_build_object(
    'ok', true,
    'snapshot', snapshot,
    'receipt', case when command_row.action = 'spin' then receipt_value else null end,
    'idempotentReplay', false
  );
exception
  when invalid_text_representation
    or numeric_value_out_of_range
    or check_violation
  then
    update public.spinner_commands
    set status = 'rejected', error_code = 'invalid_payload', completed_at = now()
    where command_id = p_command_id;
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
end;
$$;

revoke all on function public.spinner_apply_command(uuid) from public, anon, authenticated;
grant execute on function public.spinner_apply_command(uuid) to service_role;

comment on column public.spinner_live_state.elimination_plan is
  'Protected compact v2 round sequence; null preserves released v1 and idle snapshots.';
comment on column public.spinner_live_state.plan_hash_sha256 is
  'SHA-256 of the canonical immutable v2 full elimination plan.';
comment on column public.spinner_draw_receipts.elimination_plan is
  'Immutable compact copy of every v2 elimination round; v1 rows remain null.';
comment on column public.spinner_draw_receipts.plan_hash_sha256 is
  'Immutable SHA-256 binding for the canonical v2 full elimination plan.';
