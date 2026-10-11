-- Additive and dormant: publication never enables reminder delivery or creates
-- credentials. The existing Edge sender owns pending/sent date-channel fencing.
create function private.dispatch_vote_reminder(p_now timestamptz default clock_timestamp())
returns bigint language plpgsql security invoker set search_path = '' as $function$
declare
  local_now timestamp;
  project_url text;
  shared_secret text;
begin
  if p_now is null or not pg_catalog.isfinite(p_now)
    or not coalesce(pg_catalog.current_setting('cron.timezone', true) in ('GMT','UTC'), false) then
    return null;
  end if;
  local_now := p_now at time zone 'America/Los_Angeles';
  -- Accept a delayed candidate only within the target local hour. The other
  -- UTC candidate is outside this interval in both Pacific DST seasons.
  if local_now::time < time '09:00' or local_now::time >= time '10:00' then return null; end if;
  if (select count(*) from cron.job where jobname = 'mochirii-send-vote-reminder') <> 1
    or not exists (
      select 1 from cron.job where jobname = 'mochirii-send-vote-reminder'
        and active and schedule = '0 16,17 * * *'
        and command = 'select private.dispatch_vote_reminder();'
        and database = pg_catalog.current_database() and username = current_user
    ) then return null; end if;

  if (select count(*) from vault.secrets where name = 'project_url') <> 1
    or (select count(*) from vault.secrets where name = 'VOTE_REMINDER_CRON_SECRET') <> 1 then return null; end if;
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into shared_secret from vault.decrypted_secrets where name = 'VOTE_REMINDER_CRON_SECRET';
  if project_url is distinct from 'https://deyvmtncimmcinldjyqe.supabase.co'
    or shared_secret is null or pg_catalog.octet_length(shared_secret) not between 32 and 256
    or shared_secret collate "C" !~ '^[!-~]+$' then return null; end if;

  return net.http_post(
    url := project_url || '/functions/v1/send-vote-reminder',
    body := pg_catalog.jsonb_build_object('voteDate', pg_catalog.to_char(local_now, 'YYYY-MM-DD')),
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-mochirii-vote-reminder-secret', shared_secret),
    timeout_milliseconds := 15000
  );
end;
$function$;

-- Only the function owner / same-role Cron job may invoke this private routine.
revoke all on function private.dispatch_vote_reminder(timestamptz) from public, anon, authenticated, service_role;

do $schedule$
declare job_id bigint;
begin
  if not coalesce(pg_catalog.current_setting('cron.timezone', true) in ('GMT','UTC'), false) then
    raise exception using errcode = '55000', message = 'Vote reminder requires GMT or UTC Cron timezone.';
  end if;
  if exists (select 1 from cron.job where jobname = 'mochirii-send-vote-reminder'
    or command like '%/functions/v1/send-vote-reminder%'
    or command like '%private.dispatch_vote_reminder%') then
    raise exception using errcode = '55000', message = 'Existing vote reminder schedule requires reconciliation.';
  end if;
  job_id := cron.schedule('mochirii-send-vote-reminder', '0 16,17 * * *', 'select private.dispatch_vote_reminder();');
  -- Both calls occur in this one atomic block; no enabled job is committed.
  perform cron.alter_job(job_id, active := false);
end;
$schedule$;
