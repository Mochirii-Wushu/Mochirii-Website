begin;

select plan(61);

select has_column(
  'public',
  'gallery_submissions',
  'source_sha256',
  'gallery submissions can bind a validated source digest'
);
select has_table(
  'private',
  'discord_gallery_ingest_reservations',
  'private Discord Gallery ingest reservation table exists'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class
   where oid = 'private.discord_gallery_ingest_reservations'::regclass),
  'reservation table enables and forces RLS'
);
select ok(
  not has_table_privilege(
    'anon',
    'private.discord_gallery_ingest_reservations',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'private.discord_gallery_ingest_reservations',
    'select'
  )
  and not has_table_privilege(
    'service_role',
    'private.discord_gallery_ingest_reservations',
    'select'
  ),
  'no API role has direct reservation-table access'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'objects'
      and column_name = 'user_metadata'
      and data_type = 'jsonb'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'objects'
      and column_name = 'version'
      and data_type = 'text'
  ),
  'pinned local Storage schema exposes typed user metadata and object version'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.acquire_discord_gallery_ingest_reservation(uuid,text,text,text,text,text,text,text,bigint,text,text,text,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.acquire_discord_gallery_ingest_reservation(uuid,text,text,text,text,text,text,text,bigint,text,text,text,boolean)',
    'execute'
  ),
  'only service role can acquire reservations'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.confirm_discord_gallery_ingest_upload(text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.confirm_discord_gallery_ingest_upload(text,text,uuid)',
    'execute'
  ),
  'only service role can confirm uploads'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.finalize_discord_gallery_ingest_reservation(text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.finalize_discord_gallery_ingest_reservation(text,text,uuid)',
    'execute'
  ),
  'only service role can finalize reservations'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.gallery_commit_moderation_checked(uuid,uuid,text,text,uuid,text,text,bigint,uuid,text)',
    'execute'
  ),
  'service moderation must use the source-CAS wrapper'
);
select ok(
  position(
    'submission_source = ''website'''
    in (
      select qual || ' ' || with_check
      from pg_policies
      where schemaname = 'public'
        and tablename = 'gallery_submissions'
        and policyname = 'Users can update their own pending submission metadata'
    )
  ) > 0,
  'member metadata UPDATE policy is limited to Website submissions'
);

grant execute on function public.acquire_discord_gallery_ingest_reservation(
  uuid, text, text, text, text, text, text, text, bigint, text, text, text, boolean
) to authenticated;
grant execute on function public.confirm_discord_gallery_ingest_upload(text, text, uuid)
to authenticated;
grant execute on function public.finalize_discord_gallery_ingest_reservation(text, text, uuid)
to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', '', true);
select throws_ok(
  $$select public.acquire_discord_gallery_ingest_reservation(
    '11111111-1111-4111-8111-111111111111',
    '9000000000000001', '9000000000000002',
    '9000000000000010', '9000000000000011', '9000000000000012',
    repeat('a', 64), 'image/webp', 100,
    'fixture.webp', 'Fixture', null, false
  )$$,
  '42501',
  'gallery_ingest_service_role_required',
  'acquire guard rejects an absent claim as a non-superuser'
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.confirm_discord_gallery_ingest_upload(
    '9000000000000010',
    '9000000000000011',
    '22222222-2222-4222-8222-222222222222'
  )$$,
  '42501',
  'gallery_ingest_service_role_required',
  'confirm guard rejects a wrong claim as a non-superuser'
);
select throws_ok(
  $$select public.finalize_discord_gallery_ingest_reservation(
    '9000000000000010',
    '9000000000000011',
    '22222222-2222-4222-8222-222222222222'
  )$$,
  '42501',
  'gallery_ingest_service_role_required',
  'finalize guard rejects a wrong claim as a non-superuser'
);
reset role;

revoke all on function public.acquire_discord_gallery_ingest_reservation(
  uuid, text, text, text, text, text, text, text, bigint, text, text, text, boolean
) from authenticated;
revoke all on function public.confirm_discord_gallery_ingest_upload(text, text, uuid)
from authenticated;
revoke all on function public.finalize_discord_gallery_ingest_reservation(text, text, uuid)
from authenticated;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'discord-gallery-owner@example.invalid', '', now(), now(), now()),
  ('99999999-9999-4999-8999-999999999999', 'authenticated', 'authenticated', 'discord-gallery-moderator@example.invalid', '', now(), now(), now());

update public.member_profiles
set member_status = 'active',
    has_required_discord_roles = true,
    discord_verified_at = now()
where id = '11111111-1111-4111-8111-111111111111';

create function pg_temp.acquire_gallery_reservation(
  p_message_id text,
  p_attachment_id text,
  p_title text default 'Fixture'
)
returns jsonb
language sql
as $$
  select public.acquire_discord_gallery_ingest_reservation(
    '11111111-1111-4111-8111-111111111111',
    '9000000000000001',
    '9000000000000002',
    p_message_id,
    p_attachment_id,
    '9000000000000012',
    repeat('a', 64),
    'image/webp',
    100,
    'fixture.webp',
    p_title,
    null,
    false
  );
$$;

select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  public.acquire_discord_gallery_ingest_reservation(
    '11111111-1111-4111-8111-111111111111',
    null, '9000000000000002',
    '9000000000000010', '9000000000000011', '9000000000000012',
    repeat('a', 64), 'image/webp', 100,
    'fixture.webp', 'Fixture', null, false
  ) ->> 'outcome',
  'invalid',
  'null identifiers fail closed without cast ambiguity'
);
select is(
  public.acquire_discord_gallery_ingest_reservation(
    '11111111-1111-4111-8111-111111111111',
    '18446744073709551616', '9000000000000002',
    '9000000000000010', '9000000000000011', '9000000000000012',
    repeat('a', 64), 'image/webp', 100,
    'fixture.webp', 'Fixture', null, false
  ) ->> 'outcome',
  'invalid',
  'uint64 overflow identifiers fail closed'
);
select is(
  public.finalize_discord_gallery_ingest_reservation(
    null,
    '9000000000000011',
    '22222222-2222-4222-8222-222222222222'
  ) ->> 'outcome',
  'invalid',
  'finalize rejects a null message identifier without cast ambiguity'
);
select is(
  public.finalize_discord_gallery_ingest_reservation(
    '18446744073709551616',
    '9000000000000011',
    '22222222-2222-4222-8222-222222222222'
  ) ->> 'outcome',
  'invalid',
  'finalize rejects a uint64 overflow identifier'
);
select throws_ok(
  $$insert into public.gallery_submissions (
      id, user_id, storage_path, original_filename, mime_type, size_bytes,
      submission_source, discord_guild_id, discord_channel_id,
      discord_message_id, discord_attachment_id, discord_user_id
    ) values (
      '44444444-4444-4444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/invalid-discord.webp',
      'invalid-discord.webp', 'image/webp', 100, 'discord',
      '09000000000000001', '9000000000000002', '9000000000000090',
      '9000000000000091', '9000000000000012'
    )$$,
  '23514',
  null,
  'gallery submission storage rejects non-canonical Discord identifiers'
);
select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000010',
    '9000000000000011'
  ) ->> 'outcome',
  'acquired',
  'first request acquires a generated storage lease'
);
select is(
  (select count(*)::integer
   from private.discord_gallery_ingest_reservations
   where discord_message_id = '9000000000000010'
     and discord_attachment_id = '9000000000000011'),
  1,
  'message and attachment have exactly one reservation row'
);
select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000010',
    '9000000000000011'
  ) ->> 'outcome',
  'busy',
  'a competing acquire cannot share an active lease'
);
select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000010',
    '9000000000000011',
    'Changed title'
  ) ->> 'outcome',
  'conflict',
  'reservation binds HMAC body metadata across retries'
);
select ok(
  (select storage_path = (
    '11111111-1111-4111-8111-111111111111/discord-ingest/' ||
    lease_token::text || '.webp'
  )
  from private.discord_gallery_ingest_reservations
  where discord_message_id = '9000000000000010'
    and discord_attachment_id = '9000000000000011'),
  'database generates the service-only user storage path'
);
select is(
  public.confirm_discord_gallery_ingest_upload(
    '9000000000000010',
    '9000000000000011',
    '22222222-2222-4222-8222-222222222222'
  ) ->> 'outcome',
  'busy',
  'wrong lease token cannot confirm an object'
);

insert into storage.objects (
  id, bucket_id, name, owner, metadata, user_metadata, version
)
select
  '30000000-0000-4000-8000-000000000001',
  'member-gallery',
  reservation.storage_path,
  null,
  '{"size":100,"mimetype":"image/webp"}',
  jsonb_build_object(
    'sourceSha256', repeat('b', 64),
    'validatorVersion', 'gallery-source-v1'
  ),
  'version-one'
from private.discord_gallery_ingest_reservations as reservation
where reservation.discord_message_id = '9000000000000010'
  and reservation.discord_attachment_id = '9000000000000011';

select is(
  public.confirm_discord_gallery_ingest_upload(
    '9000000000000010',
    '9000000000000011',
    (select lease_token
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000010'
       and discord_attachment_id = '9000000000000011')
  ) ->> 'outcome',
  'object_mismatch',
  'upload confirmation rejects mismatched Storage digest metadata'
);
update storage.objects
set user_metadata = jsonb_build_object(
  'sourceSha256', repeat('a', 64),
  'validatorVersion', 'gallery-source-v1'
)
where id = '30000000-0000-4000-8000-000000000001';

select is(
  public.confirm_discord_gallery_ingest_upload(
    '9000000000000010',
    '9000000000000011',
    (select lease_token
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000010'
       and discord_attachment_id = '9000000000000011')
  ) ->> 'outcome',
  'confirmed',
  'exact object metadata and digest confirm the active lease'
);
select ok(
  (select state = 'uploaded'
      and storage_object_id = '30000000-0000-4000-8000-000000000001'
      and storage_object_version = 'version-one'
   from private.discord_gallery_ingest_reservations
   where discord_message_id = '9000000000000010'
     and discord_attachment_id = '9000000000000011'),
  'confirmation records exact object identity and version'
);

update storage.objects
set version = 'changed-before-finalize'
where id = '30000000-0000-4000-8000-000000000001';
select is(
  public.finalize_discord_gallery_ingest_reservation(
    '9000000000000010',
    '9000000000000011',
    (select lease_token
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000010'
       and discord_attachment_id = '9000000000000011')
  ) ->> 'outcome',
  'object_changed',
  'finalize rejects an object version changed after confirmation'
);
update storage.objects
set version = 'version-one'
where id = '30000000-0000-4000-8000-000000000001';
select is(
  public.finalize_discord_gallery_ingest_reservation(
    '9000000000000010',
    '9000000000000011',
    (select lease_token
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000010'
       and discord_attachment_id = '9000000000000011')
  ) ->> 'outcome',
  'created',
  'finalize atomically creates a gallery row and marks the lease ready'
);
select ok(
  (select submission.source_sha256 = repeat('a', 64)
      and submission.storage_path = reservation.storage_path
      and submission.discord_guild_id = reservation.discord_guild_id
      and submission.discord_channel_id = reservation.discord_channel_id
   from public.gallery_submissions as submission
   join private.discord_gallery_ingest_reservations as reservation
     on reservation.submission_id = submission.id
   where reservation.discord_message_id = '9000000000000010'
     and reservation.discord_attachment_id = '9000000000000011'),
  'finalized row retains the validated digest, context, and exact object path'
);
select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000010',
    '9000000000000011'
  ) ->> 'outcome',
  'ready',
  'lost finalize response is recovered as a ready duplicate'
);
select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000010',
    '9000000000000011',
    'Changed after ready'
  ) ->> 'outcome',
  'conflict',
  'ready duplicate disclosure requires full metadata identity'
);
update storage.objects
set version = 'changed-after-ready'
where id = '30000000-0000-4000-8000-000000000001';
select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000010',
    '9000000000000011'
  ) ->> 'outcome',
  'conflict',
  'ready duplicate disclosure rechecks exact Storage object identity'
);
select is(
  public.finalize_discord_gallery_ingest_reservation(
    '9000000000000010',
    '9000000000000011',
    (select lease_token
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000010'
       and discord_attachment_id = '9000000000000011')
  ) ->> 'outcome',
  'conflict',
  'lost-response finalization rechecks exact Storage object identity'
);
update storage.objects
set version = 'version-one'
where id = '30000000-0000-4000-8000-000000000001';

delete from public.gallery_submissions
where discord_message_id = '9000000000000010'
  and discord_attachment_id = '9000000000000011';
select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000010',
    '9000000000000011'
  ) ->> 'outcome',
  'tombstoned',
  'a ready reservation whose application row vanished is not resurrected'
);

select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000020',
    '9000000000000021'
  ) ->> 'outcome',
  'acquired',
  'second source acquires an independent lease'
);
create temporary table second_path_snapshot as
select storage_path, lease_token
from private.discord_gallery_ingest_reservations
where discord_message_id = '9000000000000020'
  and discord_attachment_id = '9000000000000021';

insert into storage.objects (
  id, bucket_id, name, owner, metadata, user_metadata, version
)
select
  '30000000-0000-4000-8000-000000000002',
  'member-gallery',
  reservation.storage_path,
  null,
  '{"size":100,"mimetype":"image/webp"}',
  jsonb_build_object(
    'sourceSha256', repeat('a', 64),
    'validatorVersion', 'gallery-source-v1'
  ),
  'second-version-one'
from private.discord_gallery_ingest_reservations as reservation
where reservation.discord_message_id = '9000000000000020'
  and reservation.discord_attachment_id = '9000000000000021';
select is(
  public.confirm_discord_gallery_ingest_upload(
    '9000000000000020',
    '9000000000000021',
    (select lease_token
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021')
  ) ->> 'outcome',
  'confirmed',
  'second upload confirms before finalization'
);

insert into public.gallery_submissions (
  id, user_id, storage_path, original_filename, mime_type, size_bytes, title
)
select
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  storage_path,
  'conflict.webp',
  'image/webp',
  100,
  'Conflict fixture'
from second_path_snapshot;
select throws_ok(
  format(
    $$select public.finalize_discord_gallery_ingest_reservation(
      '9000000000000020',
      '9000000000000021',
      %L::uuid
    )$$,
    (select lease_token
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021')
  ),
  '23505',
  'gallery_ingest_finalize_conflict',
  'database finalization failure does not delete or reassign the object'
);
select is(
  (select state
   from private.discord_gallery_ingest_reservations
   where discord_message_id = '9000000000000020'
     and discord_attachment_id = '9000000000000021'),
  'uploaded',
  'failed finalization leaves a recoverable uploaded reservation'
);
delete from public.gallery_submissions
where id = '55555555-5555-4555-8555-555555555555';
update private.discord_gallery_ingest_reservations
set lease_expires_at = statement_timestamp() - interval '1 second'
where discord_message_id = '9000000000000020'
  and discord_attachment_id = '9000000000000021';
select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000020',
    '9000000000000021'
  ) ->> 'outcome',
  'acquired',
  'expired failed finalization resumes with a fresh fenced lease'
);
select is(
  (select reservation.storage_path <> snapshot.storage_path
   from private.discord_gallery_ingest_reservations as reservation
   cross join second_path_snapshot as snapshot
   where reservation.discord_message_id = '9000000000000020'
     and reservation.discord_attachment_id = '9000000000000021'),
  true,
  'takeover rotates to a fresh path before a successor can upload'
);
select is(
  (select reservation.lease_token <> snapshot.lease_token
      and reservation.storage_path = (
        reservation.user_id::text || '/discord-ingest/' ||
        reservation.lease_token::text || '.webp'
      )
   from private.discord_gallery_ingest_reservations as reservation
   cross join second_path_snapshot as snapshot
   where reservation.discord_message_id = '9000000000000020'
     and reservation.discord_attachment_id = '9000000000000021'),
  true,
  'takeover advances and binds both the lease token and its generation path'
);
insert into storage.objects (
  id, bucket_id, name, owner, metadata, user_metadata, version
)
select
  '30000000-0000-4000-8000-000000000005',
  'member-gallery',
  reservation.storage_path,
  null,
  '{"size":100,"mimetype":"image/webp"}',
  jsonb_build_object(
    'sourceSha256', repeat('a', 64),
    'validatorVersion', 'gallery-source-v1'
  ),
  'second-version-two'
from private.discord_gallery_ingest_reservations as reservation
where reservation.discord_message_id = '9000000000000020'
  and reservation.discord_attachment_id = '9000000000000021';
select is(
  public.confirm_discord_gallery_ingest_upload(
    '9000000000000020',
    '9000000000000021',
    (select lease_token
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021')
  ) ->> 'outcome',
  'confirmed',
  'successor confirms only its fresh generation object'
);
select is(
  public.finalize_discord_gallery_ingest_reservation(
    '9000000000000020',
    '9000000000000021',
    (select lease_token
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021')
  ) ->> 'outcome',
  'created',
  'retry completes after the transient finalization conflict is removed'
);
create temporary table successor_path_snapshot as
select storage_path
from private.discord_gallery_ingest_reservations
where discord_message_id = '9000000000000020'
  and discord_attachment_id = '9000000000000021';
-- Simulate request A's external Storage upsert completing after request B has
-- taken over and finalized. A can only mutate its expired generation path.
update storage.objects
set version = 'late-predecessor-version'
where bucket_id = 'member-gallery'
  and name = (select storage_path from second_path_snapshot);
select is(
  public.confirm_discord_gallery_ingest_upload(
    '9000000000000020',
    '9000000000000021',
    (select lease_token from second_path_snapshot)
  ) ->> 'outcome',
  'ready',
  'expired writer cannot rebind the finalized successor after its late upsert'
);
select ok(
  (select reservation.storage_object_version = 'second-version-two'
      and reservation.storage_path <> snapshot.storage_path
      and object.version = 'second-version-two'
   from private.discord_gallery_ingest_reservations as reservation
   join storage.objects as object
     on object.bucket_id = 'member-gallery'
    and object.name = reservation.storage_path
   cross join second_path_snapshot as snapshot
   where reservation.discord_message_id = '9000000000000020'
     and reservation.discord_attachment_id = '9000000000000021'),
  'late predecessor write leaves the ready generation identity and version unchanged'
);
select is(
  pg_temp.acquire_gallery_reservation(
    '9000000000000020',
    '9000000000000021'
  ) ->> 'outcome',
  'ready',
  'completed retry is idempotently ready'
);

insert into storage.objects (
  id, bucket_id, name, owner, metadata, user_metadata, version
) values (
  '30000000-0000-4000-8000-000000000003',
  'member-gallery',
  '11111111-1111-4111-8111-111111111111/website-fixture.webp',
  '11111111-1111-4111-8111-111111111111',
  '{"size":100,"mimetype":"image/webp"}',
  '{}',
  'website-version'
);
insert into public.gallery_submissions (
  id, user_id, storage_path, original_filename, mime_type, size_bytes, title
) values (
  '66666666-6666-4666-8666-666666666666',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111/website-fixture.webp',
  'website.webp',
  'image/webp',
  100,
  'Website fixture'
);

grant select on second_path_snapshot to authenticated;
grant select on successor_path_snapshot to authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is(
  private.member_gallery_original_mutation_allowed(
    '11111111-1111-4111-8111-111111111111',
    'member-gallery',
    (select storage_path
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021'),
    true
  ),
  false,
  'member helper denies mutation and deletion of Discord originals'
);
select is(
  private.member_gallery_original_mutation_allowed(
    '11111111-1111-4111-8111-111111111111',
    'member-gallery',
    '11111111-1111-4111-8111-111111111111/website-fixture.webp',
    false
  ),
  true,
  'member helper preserves pending Website-original mutation'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

with changed as (
  update public.gallery_submissions
  set title = 'Forbidden Discord edit'
  where discord_message_id = '9000000000000020'
    and discord_attachment_id = '9000000000000021'
  returning 1
)
select is(
  (select count(*)::integer from changed),
  0,
  'authenticated member cannot edit HMAC-bound Discord metadata'
);
with changed as (
  update storage.objects
  set metadata = '{"size":100,"mimetype":"image/webp","changed":true}'
  where bucket_id = 'member-gallery'
    and name = (
      select storage_path from successor_path_snapshot
    )
  returning 1
)
select is(
  (select count(*)::integer from changed),
  0,
  'authenticated member cannot overwrite a Discord original'
);
select set_config('storage.allow_delete_query', 'true', true);
with changed as (
  delete from storage.objects
  where bucket_id = 'member-gallery'
    and name = (
      select storage_path from successor_path_snapshot
    )
  returning 1
)
select is(
  (select count(*)::integer from changed),
  0,
  'authenticated member cannot delete a Discord original'
);
select set_config('storage.allow_delete_query', 'false', true);
select throws_ok(
  $$insert into storage.objects (
      id, bucket_id, name, owner, metadata, user_metadata, version
    ) values (
      '30000000-0000-4000-8000-000000000004',
      'member-gallery',
      '11111111-1111-4111-8111-111111111111/discord-ingest/member-created.webp',
      '11111111-1111-4111-8111-111111111111',
      '{"size":100,"mimetype":"image/webp"}',
      '{}',
      'member-version'
    )$$,
  '42501',
  null,
  'authenticated member cannot create inside the service reservation namespace'
);
with changed as (
  update public.gallery_submissions
  set title = 'Allowed Website edit'
  where id = '66666666-6666-4666-8666-666666666666'
  returning 1
)
select is(
  (select count(*)::integer from changed),
  1,
  'authenticated member retains pending Website metadata edits'
);
with changed as (
  update storage.objects
  set metadata = '{"size":100,"mimetype":"image/webp","changed":true}'
  where bucket_id = 'member-gallery'
    and name = '11111111-1111-4111-8111-111111111111/website-fixture.webp'
  returning 1
)
select is(
  (select count(*)::integer from changed),
  1,
  'authenticated member retains pending Website original replacement'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  public.gallery_commit_moderation_checked(
    (select submission_id
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021'),
    '99999999-9999-4999-8999-999999999999',
    'rejected',
    'Fixture rejection',
    null, null, null, null, null,
    repeat('b', 64)
  ) ->> 'reason',
  'source_digest_mismatch',
  'moderation CAS rejects the wrong validated source digest'
);
update storage.objects
set version = 'changed-before-moderation'
where bucket_id = 'member-gallery'
  and name = (
    select storage_path from successor_path_snapshot
  );
select is(
  public.gallery_commit_moderation_checked(
    (select submission_id
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021'),
    '99999999-9999-4999-8999-999999999999',
    'rejected',
    'Fixture rejection',
    null, null, null, null, null,
    repeat('a', 64)
  ) ->> 'reason',
  'source_object_changed',
  'moderation CAS rejects changed object identity after ingest finalization'
);
update storage.objects
set version = 'second-version-two'
where bucket_id = 'member-gallery'
  and name = (
    select storage_path from successor_path_snapshot
  );
select is(
  (public.gallery_commit_moderation_checked(
    (select submission_id
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021'),
    '99999999-9999-4999-8999-999999999999',
    'rejected',
    'Fixture rejection',
    null, null, null, null, null,
    repeat('a', 64)
  ) ->> 'committed')::boolean,
  true,
  'moderation commits only after digest, reservation, and object CAS match'
);
select is(
  (select count(*)::integer
   from public.gallery_moderation_events
   where submission_id = (
     select submission_id
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021'
   )),
  1,
  'successful checked moderation writes one audit event'
);
select throws_ok(
  format(
    $$update public.gallery_submissions
      set title = 'Service mutation'
      where id = %L::uuid$$,
    (select submission_id
     from private.discord_gallery_ingest_reservations
     where discord_message_id = '9000000000000020'
       and discord_attachment_id = '9000000000000021')
  ),
  '23514',
  'A Discord gallery source is immutable.',
  'database trigger prevents service-side mutation of signed Discord metadata'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_source_sha256_check'
      and convalidated
  ) and exists (
    select 1
    from pg_constraint
    where conrelid = 'public.gallery_submissions'::regclass
      and conname = 'gallery_submissions_discord_id_format_check'
      and convalidated
  ),
  'source digest and canonical Discord identifier constraints are validated'
);

select * from finish();
rollback;
