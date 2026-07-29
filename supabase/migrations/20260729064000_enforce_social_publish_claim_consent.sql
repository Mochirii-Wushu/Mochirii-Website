begin;

set local lock_timeout = '5s';

-- Reassert the current Instagram consent at the claim boundary. This is
-- intentionally append-only so a database that applied the derivative
-- migration while it was being reviewed receives the same final guard.
create or replace function public.gallery_instagram_begin_publish(
  p_job_id uuid,
  p_actor_id uuid,
  p_caption text default null,
  p_alt_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_instagram_publish_jobs%rowtype;
  updated_job public.gallery_instagram_publish_jobs%rowtype;
  next_caption text;
  next_alt_text text;
  event_action text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select * into current_job
  from public.gallery_instagram_publish_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'job_not_found');
  end if;
  if current_job.status not in ('queued', 'failed') then
    return jsonb_build_object(
      'committed', false, 'reason', 'job_not_publishable', 'status', current_job.status
    );
  end if;

  perform 1
  from public.gallery_submissions
  where id = current_job.submission_id
    and status = 'approved'
    and instagram_opt_in is true
    and instagram_opt_in_source = 'website_upload'
    and instagram_opt_in_copy_version =
      '2026-07-website-public-instagram-publish-v2'
    and instagram_opt_in_contract_version =
      '2026-07-website-public-instagram-publish-v2';
  if not found then
    return jsonb_build_object(
      'committed', false, 'reason', 'submission_not_publishable', 'status', current_job.status
    );
  end if;

  if current_job.social_storage_object_id is null
    or current_job.social_mime_type <> 'image/jpeg'
    or current_job.social_size_bytes not between 1 and 8388608
    or current_job.social_width not between 320 and 1440
    or current_job.social_height not between 1 and 1800
    or current_job.social_width * 5 < current_job.social_height * 4
    or current_job.social_width * 100 > current_job.social_height * 191
    or current_job.social_sha256 !~ '^[0-9a-f]{64}$'
    or current_job.social_sanitizer_version <> 'gallery-social-jpeg-v1'
    or current_job.social_metadata_policy <> 'jfif-only-no-app-metadata-v1'
  then
    return jsonb_build_object(
      'committed', false, 'reason', 'social_derivative_invalid', 'status', current_job.status
    );
  end if;

  next_caption := coalesce(nullif(btrim(p_caption), ''), current_job.caption);
  next_alt_text := coalesce(nullif(btrim(p_alt_text), ''), current_job.alt_text);
  if char_length(coalesce(next_caption, '')) > 2200
    or char_length(coalesce(next_alt_text, '')) > 1000
  then
    raise exception 'Instagram copy is too long.' using errcode = '22023';
  end if;
  event_action := case when current_job.status = 'failed' then 'retry' else 'publishing' end;

  update public.gallery_instagram_publish_jobs
  set
    status = 'publishing',
    caption = next_caption,
    alt_text = next_alt_text,
    last_error = null,
    attempt_count = attempt_count + 1,
    attempt_started_at = clock_timestamp()
  where id = current_job.id
  returning * into updated_job;

  insert into public.gallery_instagram_publish_events (
    job_id, submission_id, actor_id, action, details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    event_action,
    jsonb_build_object('attempt_count', updated_job.attempt_count)
  );

  return jsonb_build_object('committed', true, 'job', to_jsonb(updated_job));
end;
$$;

revoke all on function public.gallery_instagram_begin_publish(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.gallery_instagram_begin_publish(uuid, uuid, text, text)
to service_role;

create function private.normalize_gallery_facebook_page_job_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.message is null
    or btrim(new.message) = ''
    or new.message = 'Shared from the Mōchirīī guild gallery.'
  then
    new.message := 'A pretty gameplay showcase from Mōchirīī.';
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_gallery_facebook_page_job_message()
from public, anon, authenticated, service_role;

create trigger normalize_gallery_facebook_page_job_message
before insert on public.gallery_facebook_page_publish_jobs
for each row
execute function private.normalize_gallery_facebook_page_job_message();

create function private.normalize_gallery_instagram_job_caption()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.caption is null
    or btrim(new.caption) = ''
    or new.caption = 'Shared from the Mōchirīī guild gallery.'
  then
    new.caption := 'A pretty gameplay showcase from Mōchirīī.';
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_gallery_instagram_job_caption()
from public, anon, authenticated, service_role;

create trigger normalize_gallery_instagram_job_caption
before insert on public.gallery_instagram_publish_jobs
for each row
execute function private.normalize_gallery_instagram_job_caption();

commit;
