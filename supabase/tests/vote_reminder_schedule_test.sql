-- Local/CI fixtures only. pg_net performs HTTP after COMMIT; every queued
-- synthetic request and Vault fixture below is discarded by the final ROLLBACK.
begin;
set local timezone = 'Asia/Singapore';
set local datestyle = 'SQL, MDY';
select no_plan();

select ok(not (select prosecdef from pg_proc where oid = 'private.dispatch_vote_reminder(timestamptz)'::regprocedure), 'dispatcher never elevates its caller');
select is((select proconfig from pg_proc where oid = 'private.dispatch_vote_reminder(timestamptz)'::regprocedure), array['search_path=""']::text[], 'dispatcher has an empty explicit search path');
select ok(not has_function_privilege('anon','private.dispatch_vote_reminder(timestamptz)','execute')
  and not has_function_privilege('authenticated','private.dispatch_vote_reminder(timestamptz)','execute')
  and not has_function_privilege('service_role','private.dispatch_vote_reminder(timestamptz)','execute'), 'browser and service roles cannot invoke scheduler');
select is((select count(*)::integer from cron.job where jobname = 'mochirii-send-vote-reminder'),1,'exactly one owned vote job exists');
select ok((select not active and schedule = '0 16,17 * * *' and command = 'select private.dispatch_vote_reminder();'
  and database = current_database() and username = current_user from cron.job where jobname = 'mochirii-send-vote-reminder'), 'migration leaves both UTC candidates disabled under its own role/database');

create temp table vote_schedule_context (initial_queue_count bigint);
insert into vote_schedule_context select count(*) from net.http_request_queue;
select is(private.dispatch_vote_reminder('2026-07-01T16:00:00Z'),null::bigint,'disabled job never queues even at the target local hour');
select is((select count(*) from net.http_request_queue),(select initial_queue_count from vote_schedule_context),'disabled invocation has no outbound request');

create function pg_temp.vote_schedule_fixture(p_url text default 'https://deyvmtncimmcinldjyqe.supabase.co',p_secret text default repeat('s',64))
returns void language plpgsql as $fixture$
declare job_id bigint;
begin
  delete from vault.secrets where name in ('project_url','VOTE_REMINDER_CRON_SECRET');
  if p_url is not null then perform vault.create_secret(p_url,'project_url'); end if;
  if p_secret is not null then perform vault.create_secret(p_secret,'VOTE_REMINDER_CRON_SECRET'); end if;
  job_id := cron.schedule('mochirii-send-vote-reminder','0 16,17 * * *','select private.dispatch_vote_reminder();');
  perform cron.alter_job(job_id,database := current_database(),active := true);
end;
$fixture$;

select pg_temp.vote_schedule_fixture(null,null);
select is(private.dispatch_vote_reminder('2026-07-01T16:00:00Z'),null::bigint,'enabled job with missing Vault configuration queues nothing');
select pg_temp.vote_schedule_fixture('https://deyvmtncimmcinldjyqe.supabase.co',null);
select is(private.dispatch_vote_reminder('2026-07-01T16:00:00Z'),null::bigint,'missing shared secret fails closed');
select pg_temp.vote_schedule_fixture(null,repeat('s',64));
select is(private.dispatch_vote_reminder('2026-07-01T16:00:00Z'),null::bigint,'missing project URL fails closed');

select pg_temp.vote_schedule_fixture();
create temp table vote_schedule_cases (instant timestamptz,send boolean,vote_date text,label text);
insert into vote_schedule_cases values
  ('2026-07-01T15:59:59.999999Z',false,null,'summer before 09:00'),
  ('2026-07-01T16:00:00Z',true,'2026-07-01','summer exact 09:00'),
  ('2026-07-01T16:59:59.999999Z',true,'2026-07-01','summer delayed within target hour'),
  ('2026-07-01T17:00:00Z',false,null,'summer second candidate is end exclusive'),
  ('2026-01-15T16:59:59.999999Z',false,null,'winter before 09:00'),
  ('2026-01-15T17:00:00Z',true,'2026-01-15','winter exact 09:00'),
  ('2026-01-15T17:59:59.999999Z',true,'2026-01-15','winter delayed within target hour'),
  ('2026-01-15T18:00:00Z',false,null,'winter 10:00 is end exclusive'),
  ('2026-03-07T16:00:00Z',false,null,'day before spring change early candidate'),
  ('2026-03-07T17:00:00Z',true,'2026-03-07','day before spring change standard-time candidate'),
  ('2026-03-08T16:00:00Z',true,'2026-03-08','spring change daylight-time candidate'),
  ('2026-03-08T17:00:00Z',false,null,'spring change later candidate rejected'),
  ('2026-10-31T16:00:00Z',true,'2026-10-31','day before fall change daylight-time candidate'),
  ('2026-10-31T17:00:00Z',false,null,'day before fall change later candidate rejected'),
  ('2026-11-01T16:00:00Z',false,null,'fall change early candidate rejected'),
  ('2026-11-01T17:00:00Z',true,'2026-11-01','fall change standard-time candidate'),
  ('2026-12-31T17:00:00Z',true,'2026-12-31','Pacific year-end date despite next-year UTC+8'),
  ('2027-01-01T17:00:00Z',true,'2027-01-01','Pacific new-year date'),
  (null,false,null,'null instant'),('infinity',false,null,'positive infinity'),('-infinity',false,null,'negative infinity');
create temp table vote_schedule_observed as
  select c.*,private.dispatch_vote_reminder(c.instant) as request_id from vote_schedule_cases c;
select is(request_id is not null,send,label || ' dispatch selection') from vote_schedule_observed;
select ok(q.method = 'POST' and q.url = 'https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/send-vote-reminder'
  and convert_from(q.body,'UTF8')::jsonb = jsonb_build_object('voteDate',o.vote_date)
  and q.headers = jsonb_build_object('Content-Type','application/json','x-mochirii-vote-reminder-secret',repeat('s',64))
  and q.timeout_milliseconds = 15000,label || ' exact private HTTP contract and Pacific date independent of session date style')
from vote_schedule_observed o left join net.http_request_queue q on q.id=o.request_id where o.send;

select cron.alter_job((select jobid from cron.job where jobname='mochirii-send-vote-reminder'),schedule := '0 16 * * *');
select is(private.dispatch_vote_reminder('2026-07-01T16:00:00Z'),null::bigint,'schedule drift queues nothing');
select pg_temp.vote_schedule_fixture();
select cron.alter_job((select jobid from cron.job where jobname='mochirii-send-vote-reminder'),command := 'select 1;');
select is(private.dispatch_vote_reminder('2026-07-01T16:00:00Z'),null::bigint,'command drift queues nothing');
select pg_temp.vote_schedule_fixture();
select cron.alter_job((select jobid from cron.job where jobname='mochirii-send-vote-reminder'),database := 'template1');
select is(private.dispatch_vote_reminder('2026-07-01T16:00:00Z'),null::bigint,'database drift queues nothing');
select pg_temp.vote_schedule_fixture();
-- The ordinary owner cannot change usernames or extension-owned cron.job
-- rows. Keep the production username guard and test actual EXECUTE denial;
-- do not elevate this fixture merely to fabricate privileged role corruption.
select cron.unschedule((select jobid from cron.job where jobname='mochirii-send-vote-reminder'));
select is(private.dispatch_vote_reminder('2026-07-01T16:00:00Z'),null::bigint,'missing exact job identity queues nothing');

create temp table vote_schedule_invalid (url text,secret text,label text);
insert into vote_schedule_invalid values
  ('http://deyvmtncimmcinldjyqe.supabase.co',repeat('s',64),'non-TLS destination'),
  ('https://unrelated.invalid',repeat('s',64),'foreign destination'),
  ('https://deyvmtncimmcinldjyqe.supabase.co/path',repeat('s',64),'destination path'),
  ('https://deyvmtncimmcinldjyqe.supabase.co/',repeat('s',64),'noncanonical trailing slash'),
  ('https://deyvmtncimmcinldjyqe.supabase.co',repeat('s',31),'short secret'),
  ('https://deyvmtncimmcinldjyqe.supabase.co',repeat('s',257),'long secret'),
  ('https://deyvmtncimmcinldjyqe.supabase.co',repeat('s',32)||chr(10),'newline secret'),
  ('https://deyvmtncimmcinldjyqe.supabase.co',repeat('s',32)||' ','whitespace secret'),
  ('https://deyvmtncimmcinldjyqe.supabase.co',repeat('s',32)||chr(233),'non-ASCII secret');
create function pg_temp.vote_invalid_case(p_url text,p_secret text)
returns bigint language plpgsql as $fixture$
begin
  perform pg_temp.vote_schedule_fixture(p_url,p_secret);
  return private.dispatch_vote_reminder('2026-07-01T16:00:00Z');
end;
$fixture$;
select is(pg_temp.vote_invalid_case(url,secret),null::bigint,label || ' fails closed') from vote_schedule_invalid;
select pg_temp.vote_schedule_fixture('https://deyvmtncimmcinldjyqe.supabase.co',repeat('s',32));
select ok(private.dispatch_vote_reminder('2026-07-01T16:00:00Z') is not null,'minimum 32-byte printable secret accepted');
select pg_temp.vote_schedule_fixture('https://deyvmtncimmcinldjyqe.supabase.co',repeat('s',256));
select ok(private.dispatch_vote_reminder('2026-07-01T16:00:00Z') is not null,'maximum 256-byte printable secret accepted');
select is((select count(*) from net.http_request_queue),
  (select initial_queue_count from vote_schedule_context) + (select count(*) from vote_schedule_observed where send) + 2,
  'all disabled, invalid instant, drift and invalid configuration cases queue no extra requests');

-- Preserve the existing sender's pending/sent fence. Failed/skipped rows do
-- not provide exactly-once delivery and require reconciliation before replay.
insert into public.vote_reminder_sends(vote_date,discord_guild_id,discord_channel_id,status)
  values ('2099-01-01','1078630751077142608','1082802012095266866','pending');
select throws_ok($$insert into public.vote_reminder_sends(vote_date,discord_guild_id,discord_channel_id,status)
  values ('2099-01-01','1078630751077142608','1082802012095266866','pending')$$,'23505',null,'same-date pending send is fenced');
select throws_ok($$insert into public.vote_reminder_sends(vote_date,discord_guild_id,discord_channel_id,status)
  values ('2099-01-01','1078630751077142608','1082802012095266866','sent')$$,'23505',null,'same-date sent duplicate is fenced');
select lives_ok($$insert into public.vote_reminder_sends(vote_date,discord_guild_id,discord_channel_id,status)
  values ('2099-01-02','1078630751077142608','1082802012095266866','pending')$$,'different-date pending send remains valid');
select lives_ok($$insert into public.vote_reminder_sends(vote_date,discord_guild_id,discord_channel_id,status)
  values ('2099-01-01','1078630751077142608','1082802012095266866','failed')$$,'failed rows remain outside the existing pending/sent fence');

select * from finish();
rollback;
