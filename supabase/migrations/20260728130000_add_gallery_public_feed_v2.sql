alter table public.gallery_submissions
  add column if not exists thumbnail_width integer,
  add column if not exists thumbnail_height integer;

alter table public.gallery_submissions
  drop constraint if exists gallery_submissions_thumbnail_complete_check,
  drop constraint if exists gallery_submissions_approved_thumbnail_check,
  drop constraint if exists gallery_submissions_public_category_check;

alter table public.gallery_submissions
  add constraint gallery_submissions_thumbnail_dimensions_check
  check (
    (thumbnail_width is null and thumbnail_height is null)
    or (
      thumbnail_width between 1 and 720
      and thumbnail_height between 1 and 720
    )
  ) not valid;

-- Historical approved rows include both fully missing thumbnails and the
-- pre-dimension four-field thumbnail shape. Public eligibility remains strict
-- in the service-only publication contract, but the base row is intentionally
-- left reconcilable until every historical row has been classified and
-- republished. Install and validate a strict base-row constraint only in the
-- separately reviewed backfill closeout migration.

create index if not exists gallery_submissions_public_feed_order_idx
on public.gallery_submissions (reviewed_at desc, created_at desc, id desc)
where status = 'approved' and reviewed_at is not null;

create index if not exists gallery_submissions_public_feed_category_order_idx
on public.gallery_submissions (category, reviewed_at desc, created_at desc, id desc)
where status = 'approved' and reviewed_at is not null;

create or replace function public.gallery_commit_moderation(
  p_submission_id uuid,
  p_moderator_id uuid,
  p_action text,
  p_reason text default null,
  p_thumbnail_revision_id uuid default null,
  p_thumbnail_storage_path text default null,
  p_thumbnail_mime_type text default null,
  p_thumbnail_size_bytes bigint default null,
  p_thumbnail_width integer default null,
  p_thumbnail_height integer default null,
  p_expected_thumbnail_revision_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_submission public.gallery_submissions%rowtype;
  updated_submission public.gallery_submissions%rowtype;
  original_metadata jsonb;
  thumbnail_metadata jsonb;
  expected_thumbnail_path text;
  audit_action text;
  audit_reason text;
begin
  if p_action not in ('approved', 'rejected', 'thumbnail') then
    raise exception 'Invalid gallery moderation action.' using errcode = '22023';
  end if;

  select *
  into current_submission
  from public.gallery_submissions
  where id = p_submission_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'submission_not_found');
  end if;

  if p_action in ('approved', 'rejected') and current_submission.status <> 'pending' then
    return jsonb_build_object('committed', false, 'reason', 'submission_not_pending');
  end if;

  if p_action = 'thumbnail' then
    if current_submission.status <> 'approved' then
      return jsonb_build_object('committed', false, 'reason', 'submission_not_approved');
    end if;

    if current_submission.thumbnail_revision_id is distinct from p_expected_thumbnail_revision_id then
      return jsonb_build_object('committed', false, 'reason', 'stale_thumbnail_revision');
    end if;
  end if;

  select object.metadata
  into original_metadata
  from storage.objects as object
  where object.bucket_id = current_submission.storage_bucket
    and object.name = current_submission.storage_path
  for key share;

  if not found
    or (case
      when coalesce(original_metadata ->> 'size', '') ~ '^[0-9]+$'
        then (original_metadata ->> 'size')::bigint
      else null
    end) is distinct from current_submission.size_bytes
    or lower(coalesce(original_metadata ->> 'mimetype', '')) <> current_submission.mime_type
  then
    return jsonb_build_object('committed', false, 'reason', 'original_object_mismatch');
  end if;

  if p_action in ('approved', 'thumbnail') then
    if p_thumbnail_revision_id is null
      or p_thumbnail_storage_path is null
      or p_thumbnail_mime_type <> 'image/webp'
      or p_thumbnail_size_bytes not between 1 and 81920
      or p_thumbnail_width not between 1 and 720
      or p_thumbnail_height not between 1 and 720
    then
      raise exception 'A complete bounded gallery thumbnail is required.' using errcode = '22023';
    end if;

    expected_thumbnail_path := '_approved/thumbs/' || p_submission_id::text || '/' || p_thumbnail_revision_id::text || '.webp';
    if p_thumbnail_storage_path <> expected_thumbnail_path then
      raise exception 'Gallery thumbnail path is invalid.' using errcode = '22023';
    end if;

    select object.metadata
    into thumbnail_metadata
    from storage.objects as object
    where object.bucket_id = 'member-gallery'
      and object.name = p_thumbnail_storage_path
    for key share;

    if not found
      or (case
        when coalesce(thumbnail_metadata ->> 'size', '') ~ '^[0-9]+$'
          then (thumbnail_metadata ->> 'size')::bigint
        else null
      end) is distinct from p_thumbnail_size_bytes
      or lower(coalesce(thumbnail_metadata ->> 'mimetype', '')) <> 'image/webp'
    then
      return jsonb_build_object('committed', false, 'reason', 'thumbnail_object_mismatch');
    end if;
  elsif p_thumbnail_revision_id is not null
    or p_thumbnail_storage_path is not null
    or p_thumbnail_mime_type is not null
    or p_thumbnail_size_bytes is not null
    or p_thumbnail_width is not null
    or p_thumbnail_height is not null
  then
    raise exception 'Rejected submissions cannot publish a thumbnail.' using errcode = '22023';
  end if;

  if p_action = 'thumbnail' then
    update public.gallery_submissions
    set
      thumbnail_revision_id = p_thumbnail_revision_id,
      thumbnail_storage_path = p_thumbnail_storage_path,
      thumbnail_mime_type = p_thumbnail_mime_type,
      thumbnail_size_bytes = p_thumbnail_size_bytes,
      thumbnail_width = p_thumbnail_width,
      thumbnail_height = p_thumbnail_height
    where id = p_submission_id
    returning * into updated_submission;

    audit_action := 'thumbnail_refreshed';
    audit_reason := 'Bounded gallery thumbnail prepared.';
  else
    update public.gallery_submissions
    set
      status = p_action,
      reviewed_by = p_moderator_id,
      reviewed_at = now(),
      rejection_reason = case
        when p_action = 'rejected' then coalesce(nullif(btrim(p_reason), ''), 'Rejected by moderator.')
        else null
      end,
      thumbnail_revision_id = case when p_action = 'approved' then p_thumbnail_revision_id else null end,
      thumbnail_storage_path = case when p_action = 'approved' then p_thumbnail_storage_path else null end,
      thumbnail_mime_type = case when p_action = 'approved' then p_thumbnail_mime_type else null end,
      thumbnail_size_bytes = case when p_action = 'approved' then p_thumbnail_size_bytes else null end,
      thumbnail_width = case when p_action = 'approved' then p_thumbnail_width else null end,
      thumbnail_height = case when p_action = 'approved' then p_thumbnail_height else null end
    where id = p_submission_id
    returning * into updated_submission;

    audit_action := p_action;
    audit_reason := case when p_action = 'rejected' then updated_submission.rejection_reason else null end;
  end if;

  insert into public.gallery_moderation_events (
    submission_id,
    moderator_id,
    action,
    reason
  ) values (
    p_submission_id,
    p_moderator_id,
    audit_action,
    audit_reason
  );

  return jsonb_build_object(
    'committed', true,
    'submission', to_jsonb(updated_submission),
    'action', p_action
  );
end;
$$;

revoke all on function public.gallery_commit_moderation(uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, uuid)
from public, anon, authenticated;
grant execute on function public.gallery_commit_moderation(uuid, uuid, text, text, uuid, text, text, bigint, integer, integer, uuid)
to service_role;

drop function if exists public.gallery_commit_moderation(
  uuid, uuid, text, text, uuid, text, text, bigint, uuid
);

create or replace function public.gallery_public_feed_page_v2(
  p_limit integer default 24,
  p_snapshot_at timestamptz default null,
  p_after_reviewed_at timestamptz default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_sort text default 'newest',
  p_category text default null,
  p_query text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requested_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
  requested_sort text := lower(coalesce(nullif(btrim(p_sort), ''), 'newest'));
  requested_category text := lower(nullif(btrim(p_category), ''));
  requested_query text := lower(nullif(btrim(p_query), ''));
  requested_snapshot_at timestamptz := coalesce(p_snapshot_at, statement_timestamp());
  has_cursor boolean := p_after_reviewed_at is not null
    or p_after_created_at is not null
    or p_after_id is not null;
  result jsonb;
begin
  if requested_sort not in ('newest', 'oldest') then
    raise exception 'Invalid gallery sort.' using errcode = '22023';
  end if;

  if requested_category in ('all', 'member-submissions') then
    requested_category := null;
  elsif requested_category is not null
    and requested_category not in ('portraits', 'gatherings', 'action', 'scenery', 'companions')
  then
    raise exception 'Invalid gallery category.' using errcode = '22023';
  end if;

  if requested_query is not null and char_length(requested_query) > 80 then
    raise exception 'Gallery search is too long.' using errcode = '22023';
  end if;

  if has_cursor and (
    p_after_reviewed_at is null
    or p_after_created_at is null
    or p_after_id is null
  ) then
    raise exception 'Incomplete gallery cursor.' using errcode = '22023';
  end if;

  if requested_snapshot_at > statement_timestamp() then
    raise exception 'Gallery snapshot cannot be in the future.' using errcode = '22023';
  end if;

  with eligible as (
    select
      submission.id,
      submission.title,
      submission.caption,
      case
        when submission.category in ('portraits', 'gatherings', 'action', 'scenery', 'companions')
          then submission.category
        else null
      end as public_category,
      submission.mime_type,
      submission.size_bytes,
      submission.created_at,
      submission.reviewed_at,
      coalesce(
        nullif(btrim(profile.discord_global_name), ''),
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(profile.discord_username), ''),
        'Mōchirīī Member'
      ) as uploader_display_name,
      submission.thumbnail_storage_path,
      submission.thumbnail_size_bytes,
      submission.thumbnail_width,
      submission.thumbnail_height
    from public.gallery_submissions as submission
    join public.member_profiles as profile
      on profile.id = submission.user_id
    join storage.objects as original_object
      on original_object.bucket_id = submission.storage_bucket
      and original_object.name = submission.storage_path
    join storage.objects as thumbnail_object
      on thumbnail_object.bucket_id = 'member-gallery'
      and thumbnail_object.name = submission.thumbnail_storage_path
    where submission.status = 'approved'
      and submission.reviewed_at is not null
      and submission.reviewed_at <= requested_snapshot_at
      and submission.storage_bucket = 'member-gallery'
      and submission.thumbnail_revision_id is not null
      and submission.thumbnail_storage_path = (
        '_approved/thumbs/' || submission.id::text || '/' || submission.thumbnail_revision_id::text || '.webp'
      )
      and submission.thumbnail_mime_type = 'image/webp'
      and submission.thumbnail_size_bytes between 1 and 81920
      and submission.thumbnail_width between 1 and 720
      and submission.thumbnail_height between 1 and 720
      and (case
        when coalesce(original_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (original_object.metadata ->> 'size')::bigint
        else null
      end) = submission.size_bytes
      and lower(coalesce(original_object.metadata ->> 'mimetype', '')) = submission.mime_type
      and (case
        when coalesce(thumbnail_object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (thumbnail_object.metadata ->> 'size')::bigint
        else null
      end) = submission.thumbnail_size_bytes
      and lower(coalesce(thumbnail_object.metadata ->> 'mimetype', '')) = 'image/webp'
      and exists (
        select 1
        from public.gallery_moderation_events as moderation_event
        where moderation_event.submission_id = submission.id
          and moderation_event.action = 'approved'
      )
  ), searched as (
    select
      eligible.*,
      case
        when eligible.public_category is null then array['member-submissions']::text[]
        else array['member-submissions', eligible.public_category]::text[]
      end as categories
    from eligible
    where requested_query is null
      or position(
        requested_query in lower(concat_ws(
          ' ',
          eligible.title,
          eligible.caption,
          eligible.uploader_display_name,
          eligible.public_category
        ))
      ) > 0
  ), filtered as (
    select searched.*
    from searched
    where requested_category is null
      or searched.public_category = requested_category
  ), page_candidates as (
    select
      filtered.*,
      row_number() over (
        order by
          case when requested_sort = 'newest' then filtered.reviewed_at end desc,
          case when requested_sort = 'newest' then filtered.created_at end desc,
          case when requested_sort = 'newest' then filtered.id end desc,
          case when requested_sort = 'oldest' then filtered.reviewed_at end asc,
          case when requested_sort = 'oldest' then filtered.created_at end asc,
          case when requested_sort = 'oldest' then filtered.id end asc
      ) as page_position
    from filtered
    where not has_cursor
      or (
        requested_sort = 'newest'
        and (filtered.reviewed_at, filtered.created_at, filtered.id)
          < (p_after_reviewed_at, p_after_created_at, p_after_id)
      )
      or (
        requested_sort = 'oldest'
        and (filtered.reviewed_at, filtered.created_at, filtered.id)
          > (p_after_reviewed_at, p_after_created_at, p_after_id)
      )
    order by
      case when requested_sort = 'newest' then filtered.reviewed_at end desc,
      case when requested_sort = 'newest' then filtered.created_at end desc,
      case when requested_sort = 'newest' then filtered.id end desc,
      case when requested_sort = 'oldest' then filtered.reviewed_at end asc,
      case when requested_sort = 'oldest' then filtered.created_at end asc,
      case when requested_sort = 'oldest' then filtered.id end asc
    limit requested_limit + 1
  ), visible as (
    select * from page_candidates
    where page_position <= requested_limit
  ), final_cursor as (
    select reviewed_at, created_at, id
    from visible
    order by page_position desc
    limit 1
  )
  select jsonb_build_object(
    'schemaVersion', 2,
    'snapshotAt', requested_snapshot_at,
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', visible.id,
            'title', visible.title,
            'caption', visible.caption,
            'category', visible.public_category,
            'categories', visible.categories,
            'mimeType', visible.mime_type,
            'sizeBytes', visible.size_bytes,
            'createdAt', visible.created_at,
            'reviewedAt', visible.reviewed_at,
            'uploaderDisplayName', visible.uploader_display_name,
            'thumbnailStoragePath', visible.thumbnail_storage_path,
            'thumbnailSizeBytes', visible.thumbnail_size_bytes,
            'thumbnailWidth', visible.thumbnail_width,
            'thumbnailHeight', visible.thumbnail_height
          )
          order by visible.page_position
        )
        from visible
      ),
      '[]'::jsonb
    ),
    'hasMore', (select count(*) > requested_limit from page_candidates),
    'nextCursor', case
      when (select count(*) > requested_limit from page_candidates)
      then (
        select jsonb_build_object(
          'reviewedAt', final_cursor.reviewed_at,
          'createdAt', final_cursor.created_at,
          'id', final_cursor.id,
          'snapshotAt', requested_snapshot_at
        )
        from final_cursor
      )
      else null
    end,
    'totalEligible', (select count(*) from filtered),
    'facets', (
      select jsonb_build_object(
        'member-submissions', count(*),
        'portraits', count(*) filter (where searched.public_category = 'portraits'),
        'gatherings', count(*) filter (where searched.public_category = 'gatherings'),
        'action', count(*) filter (where searched.public_category = 'action'),
        'scenery', count(*) filter (where searched.public_category = 'scenery'),
        'companions', count(*) filter (where searched.public_category = 'companions')
      )
      from searched
    ),
    'unknownCategoryCount', (
      select count(*) from searched where searched.public_category is null
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.gallery_public_feed_page_v2(integer, timestamptz, timestamptz, timestamptz, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.gallery_public_feed_page_v2(integer, timestamptz, timestamptz, timestamptz, uuid, text, text, text)
to service_role;

create or replace function public.gallery_public_original_v2(p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', submission.id,
    'storageBucket', submission.storage_bucket,
    'storagePath', submission.storage_path,
    'mimeType', submission.mime_type,
    'sizeBytes', submission.size_bytes,
    'thumbnailStoragePath', submission.thumbnail_storage_path,
    'thumbnailSizeBytes', submission.thumbnail_size_bytes,
    'thumbnailWidth', submission.thumbnail_width,
    'thumbnailHeight', submission.thumbnail_height
  )
  into result
  from public.gallery_submissions as submission
  join public.member_profiles as profile
    on profile.id = submission.user_id
  join storage.objects as original_object
    on original_object.bucket_id = submission.storage_bucket
    and original_object.name = submission.storage_path
  join storage.objects as thumbnail_object
    on thumbnail_object.bucket_id = 'member-gallery'
    and thumbnail_object.name = submission.thumbnail_storage_path
  where submission.id = p_submission_id
    and submission.status = 'approved'
    and submission.reviewed_at is not null
    and submission.storage_bucket = 'member-gallery'
    and submission.thumbnail_revision_id is not null
    and submission.thumbnail_storage_path = (
      '_approved/thumbs/' || submission.id::text || '/' || submission.thumbnail_revision_id::text || '.webp'
    )
    and submission.thumbnail_mime_type = 'image/webp'
    and submission.thumbnail_size_bytes between 1 and 81920
    and submission.thumbnail_width between 1 and 720
    and submission.thumbnail_height between 1 and 720
    and (case
      when coalesce(original_object.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (original_object.metadata ->> 'size')::bigint
      else null
    end) = submission.size_bytes
    and lower(coalesce(original_object.metadata ->> 'mimetype', '')) = submission.mime_type
    and (case
      when coalesce(thumbnail_object.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (thumbnail_object.metadata ->> 'size')::bigint
      else null
    end) = submission.thumbnail_size_bytes
    and lower(coalesce(thumbnail_object.metadata ->> 'mimetype', '')) = 'image/webp'
    and exists (
      select 1
      from public.gallery_moderation_events as moderation_event
      where moderation_event.submission_id = submission.id
        and moderation_event.action = 'approved'
    );

  return result;
end;
$$;

revoke all on function public.gallery_public_original_v2(uuid)
from public, anon, authenticated;
grant execute on function public.gallery_public_original_v2(uuid)
to service_role;

comment on column public.gallery_submissions.thumbnail_width is
  'Validated decoded width of the bounded public gallery thumbnail.';

comment on column public.gallery_submissions.thumbnail_height is
  'Validated decoded height of the bounded public gallery thumbnail.';

comment on function public.gallery_public_feed_page_v2(integer, timestamptz, timestamptz, timestamptz, uuid, text, text, text) is
  'Service-only versioned keyset page for eligible public gallery thumbnails.';

comment on function public.gallery_public_original_v2(uuid) is
  'Service-only current-publishability lookup for one on-demand gallery original or thumbnail refresh.';
