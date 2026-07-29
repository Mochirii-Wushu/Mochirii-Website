begin;

set local lock_timeout = '5s';

create or replace function public.gallery_facebook_page_begin_publish(
  p_job_id uuid,
  p_actor_id uuid,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.gallery_facebook_page_publish_jobs%rowtype;
  updated_job public.gallery_facebook_page_publish_jobs%rowtype;
  next_message text;
  event_action text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select * into current_job
  from public.gallery_facebook_page_publish_jobs
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
    and facebook_page_opt_in is true
    and facebook_page_opt_in_source = 'website_upload'
    and facebook_page_opt_in_copy_version =
      '2026-07-website-public-facebook-page-group-v2';
  if not found then
    return jsonb_build_object(
      'committed', false, 'reason', 'submission_not_publishable', 'status', current_job.status
    );
  end if;

  if current_job.destination_page_id <> '1222888660907862'
    or current_job.social_storage_object_id is null
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
      'committed', false, 'reason', 'destination_or_derivative_invalid', 'status', current_job.status
    );
  end if;

  next_message := coalesce(nullif(btrim(p_message), ''), current_job.message);
  if char_length(coalesce(next_message, '')) > 5000 then
    raise exception 'Facebook Page message is too long.' using errcode = '22023';
  end if;
  event_action := case when current_job.status = 'failed' then 'retry' else 'publishing' end;

  update public.gallery_facebook_page_publish_jobs
  set
    status = 'publishing',
    message = next_message,
    last_error = null,
    attempt_count = attempt_count + 1,
    attempt_started_at = clock_timestamp()
  where id = current_job.id
  returning * into updated_job;

  insert into public.gallery_facebook_page_publish_events (
    job_id, submission_id, actor_id, action, details
  ) values (
    updated_job.id,
    updated_job.submission_id,
    p_actor_id,
    event_action,
    jsonb_build_object(
      'attempt_count', updated_job.attempt_count,
      'destination_page_id', updated_job.destination_page_id
    )
  );

  return jsonb_build_object('committed', true, 'job', to_jsonb(updated_job));
end;
$$;

revoke all on function public.gallery_facebook_page_begin_publish(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.gallery_facebook_page_begin_publish(uuid, uuid, text)
to service_role;

commit;
