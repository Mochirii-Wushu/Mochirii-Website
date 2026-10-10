-- Isolated transactional fixtures. Never commits a pg_net request or changes a
-- hosted registry, activation, reservation, or capability.
begin;
set local timezone = 'Pacific/Honolulu';
select no_plan();

delete from private.reaper_event_advance_dispatches;
delete from private.reaper_event_sync_runs where guild_id = '1078630751077142608';
delete from public.discord_resources where kind = 'scheduled_event' and discord_parent_id = '1078630751077142608';
update private.reaper_event_advancement_policy set enabled = false, activated_at = null, disabled_reason = null;

insert into public.discord_resources (kind, label, discord_id, discord_parent_id, metadata)
select 'scheduled_event', activity, case activity
  when 'guild-party' then '1558076114486698016' when 'monthly-gathering' then '1558024658497052722'
  when 'monthly-raffle' then '1479507429598302268' else (1634567890123456700 + ordinal)::text end,
  '1078630751077142608', jsonb_build_object(
    'managedBy', 'reaper-event-sync', 'siteEventKey', activity, 'source', 'data/guild-schedule.json', 'entityType', 'EXTERNAL',
    'startIso', '2099-01-01T14:00:00.000Z', 'endIso', '2099-01-01T16:00:00.000Z',
    'recurrenceRule', case when activity in ('breaking-army', 'showdown') then 'null'::jsonb else '{"frequency":3,"interval":1}'::jsonb end)
from unnest(array['monthly-gathering', 'monthly-raffle', 'guild-party', 'breaking-army', 'showdown', 'guild-wars', 'guild-heros-realm', 'united-resolve']) with ordinality as guild(activity, ordinal);

select is(private.reaper_event_advancement_registry_ready(), false, 'eight historical activities alone cannot activate the eleven-key release');
select is(public.reaper_set_event_advancement(true), false, 'missing Twitch reconciliation keeps activation disabled');

insert into public.discord_resources (kind, label, discord_id, discord_parent_id, metadata)
select 'scheduled_event', activity, (1734567890123456700 + day)::text, '1078630751077142608', jsonb_build_object(
  'managedBy', 'reaper-event-sync', 'siteEventKey', activity, 'source', 'data/guild-schedule.json', 'entityType', 'EXTERNAL',
  'location', 'https://www.twitch.tv/mochiriiguild', 'websiteLocation', 'https://www.twitch.tv/mochiriiguild',
  'startIso', '2099-01-0' || (5 + day)::text || 'T13:30:00.000Z', 'endIso', '2099-01-0' || (5 + day)::text || 'T15:30:00.000Z',
  'coverImageUrl', null, 'coverImageSha256', null, 'discordImageHash', null,
  'recurrenceRule', jsonb_build_object('start', '2099-01-0' || (5 + day)::text || 'T13:30:00.000Z', 'frequency', 2, 'interval', 1, 'by_weekday', jsonb_build_array(day)))
from (values ('twitch-mochi-monday', 0), ('twitch-mochi-tuesday', 1), ('twitch-mochi-wednesday', 2)) as streaming(activity, day);

create function pg_temp.stream_guard_rejects(p_patch jsonb, p_remove text default null, p_key text default 'twitch-mochi-monday')
returns boolean language plpgsql as $$
declare original jsonb; resource_id uuid; rejected boolean;
begin
  select id, metadata into strict resource_id, original from public.discord_resources where discord_parent_id = '1078630751077142608' and metadata->>'siteEventKey' = p_key;
  update public.discord_resources set metadata = (original || p_patch) - coalesce(p_remove, '') where id = resource_id;
  rejected := not private.reaper_event_advancement_registry_ready();
  update public.discord_resources set metadata = original where id = resource_id;
  return rejected;
end;
$$;

select is(private.reaper_event_advancement_registry_ready(), true, 'eleven unique activities and three exact native Twitch series reconcile across database timezones');
select ok(not (select prosecdef from pg_proc where oid = 'private.reaper_event_advancement_registry_ready()'::regprocedure), 'replacement guard remains security invoker');
select ok((select proconfig = array['search_path=""'] from pg_proc where oid = 'private.reaper_event_advancement_registry_ready()'::regprocedure), 'replacement guard retains empty search path');
select ok(has_function_privilege('service_role', 'private.reaper_event_advancement_registry_ready()', 'execute') and not has_function_privilege('anon', 'private.reaper_event_advancement_registry_ready()', 'execute') and not has_function_privilege('authenticated', 'private.reaper_event_advancement_registry_ready()', 'execute'), 'replacement retains backend-only execute grants');
select is((select activity_keys from private.reaper_event_advancement_policy), array['breaking-army', 'showdown']::text[], 'native streams do not expand rolling target scope');
select is((select revision from private.reaper_event_advancement_policy), 1, 'dispatch protocol revision is unchanged');
select is((select enabled from private.reaper_event_advancement_policy), false, 'new migration does not activate advancement');

select ok(pg_temp.stream_guard_rejects('{"siteEventKey":"twitch-mochi-friday"}'), 'unknown eleventh key fails closed');
select ok(pg_temp.stream_guard_rejects('{"siteEventKey":"twitch-mochi-tuesday"}'), 'duplicate stream key cannot hide missing Monday');
select ok(pg_temp.stream_guard_rejects('{}', 'source'), 'missing stream source fails closed');
select ok(pg_temp.stream_guard_rejects('{"source":"data/events.json"}'), 'timing cannot use an alternate source');
select ok(pg_temp.stream_guard_rejects('{"entityType":"VOICE"}'), 'streams must remain external events');
select ok(pg_temp.stream_guard_rejects('{"location":"https://www.twitch.tv/other"}'), 'another Twitch channel fails closed');
select ok(pg_temp.stream_guard_rejects('{"location":"https://www.twitch.tv/mochiriiguild/"}'), 'noncanonical Twitch location fails closed');
select ok(pg_temp.stream_guard_rejects('{}', 'websiteLocation'), 'missing authoritative stream location fails closed');
select ok(pg_temp.stream_guard_rejects('{"websiteLocation":"https://mochirii.com/events"}'), 'different website location fails closed');
select ok(pg_temp.stream_guard_rejects('{}', 'coverImageUrl'), 'absent cover metadata is distinct from verified no-cover receipt');
select ok(pg_temp.stream_guard_rejects('{"coverImageUrl":"https://mochirii.com/assets/other.png"}'), 'unapproved artwork fails closed');
select ok(pg_temp.stream_guard_rejects('{"coverImageSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'), 'source cover digest must be explicit null');
select ok(pg_temp.stream_guard_rejects('{"discordImageHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'), 'provider cover receipt must be explicit null');
select ok(pg_temp.stream_guard_rejects('{"startIso":"2099-01-05T13:30:00.000001Z"}'), 'fractional start drift fails exact authoritative clock');
select ok(pg_temp.stream_guard_rejects('{"startIso":"2099-01-05T14:30:00Z","endIso":"2099-01-05T16:30:00Z"}'), 'two-hour duration cannot mask wrong start clock');
select ok(pg_temp.stream_guard_rejects('{"startIso":"2099-01-06T13:30:00Z","endIso":"2099-01-06T15:30:00Z"}'), 'wrong weekday fails even with correct UTC clock');
select ok(pg_temp.stream_guard_rejects('{"endIso":"2099-01-05T15:30:00.000001Z"}'), 'stream duration is exactly two hours');
select ok(pg_temp.stream_guard_rejects('{"startIso":"2099-02-30T13:30:00Z"}'), 'invalid calendar fails closed');
select ok(pg_temp.stream_guard_rejects('{}', 'recurrenceRule'), 'native recurrence must be present');
select ok(pg_temp.stream_guard_rejects('{"recurrenceRule":null}'), 'streams cannot become rolling one-offs');
select ok(pg_temp.stream_guard_rejects('{"recurrenceRule":{"start":"2099-01-05T13:30:00Z","frequency":3,"interval":1,"by_weekday":[0]}}'), 'daily frequency is not a weekly stream');
select ok(pg_temp.stream_guard_rejects('{"recurrenceRule":{"start":"2099-01-05T13:30:00Z","frequency":2,"interval":2,"by_weekday":[0]}}'), 'biweekly interval fails closed');
select ok(pg_temp.stream_guard_rejects('{"recurrenceRule":{"start":"2099-01-05T13:30:00Z","frequency":2,"interval":1,"by_weekday":[0,2]}}'), 'one stream series cannot add another weekday');
select ok(pg_temp.stream_guard_rejects('{"recurrenceRule":{"start":"2099-01-05T13:30:00Z","frequency":2,"interval":1,"by_weekday":[0],"count":2}}'), 'finite recurrence is not silently accepted');
select ok(pg_temp.stream_guard_rejects('{"recurrenceRule":{"start":"2099-01-05T13:30:00Z","frequency":2,"interval":1,"by_weekday":[0],"end":"2099-02-01T13:30:00Z"}}'), 'finite recurrence end fails closed');
select ok(pg_temp.stream_guard_rejects('{"recurrenceRule":{"start":"2099-01-12T13:30:00Z","frequency":2,"interval":1,"by_weekday":[0]}}'), 'future recurrence anchor fails closed');
select ok(pg_temp.stream_guard_rejects('{"recurrenceRule":{"start":"2099-01-04T13:30:00Z","frequency":2,"interval":1,"by_weekday":[0]}}'), 'anchor must align with the actual weekly occurrence');
select ok(pg_temp.stream_guard_rejects('{}', 'entityType', 'guild-wars'), 'unchanged eight-key incomplete-metadata protection remains enforced');
select ok(pg_temp.stream_guard_rejects('{"recurrenceRule":{}}', null, 'breaking-army'), 'Army remains explicitly nonrecurring');

update public.discord_resources set metadata = metadata || '{"recurrenceRule":{"start":"2098-12-29T13:30:00Z","frequency":2,"interval":1,"by_weekday":[0],"end":null,"count":null,"by_month":null}}'::jsonb where metadata->>'siteEventKey' = 'twitch-mochi-monday' and discord_parent_id = '1078630751077142608';
select is(private.reaper_event_advancement_registry_ready(), true, 'prior valid weekly anchor and provider null optional selectors remain compatible');

select throws_ok($$update public.discord_resources set discord_id = '1558076114486698016' where metadata->>'siteEventKey' = 'twitch-mochi-monday' and discord_parent_id = '1078630751077142608'$$, '23505', null, 'existing registry uniqueness forbids streams sharing a guild activity target ID');
update public.discord_resources set discord_id = '1558076114486698017' where metadata->>'siteEventKey' = 'guild-party' and discord_parent_id = '1078630751077142608';
select is(private.reaper_event_advancement_registry_ready(), false, 'approved Party keeper cannot change');
update public.discord_resources set discord_id = '1558076114486698016' where metadata->>'siteEventKey' = 'guild-party' and discord_parent_id = '1078630751077142608';
update public.discord_resources set enabled = false where metadata->>'siteEventKey' = 'twitch-mochi-wednesday' and discord_parent_id = '1078630751077142608';
select is(public.reaper_set_event_advancement(true), false, 'disabled stream prevents activation');
update public.discord_resources set enabled = true where metadata->>'siteEventKey' = 'twitch-mochi-wednesday' and discord_parent_id = '1078630751077142608';

insert into public.discord_resources (kind, label, discord_id, discord_parent_id, metadata)
select kind, label, '1834567890123456789', '2078630751077142608', metadata from public.discord_resources where metadata->>'siteEventKey' = 'twitch-mochi-monday' and discord_parent_id = '1078630751077142608';
select is(private.reaper_event_advancement_registry_ready(), true, 'another guild cannot contaminate the fixed-guild guard');
select is((select array_agg(key order by key) from jsonb_object_keys(private.reaper_event_advance_due_targets('2100-01-01T00:00:00Z')) key), array['breaking-army', 'showdown']::text[], 'past native Twitch occurrences never become rolling targets');
select is(public.reaper_set_event_advancement(true), true, 'eleven reconciled activities permit only explicit activation');
select is(private.reaper_dispatch_event_advance(), null::uuid, 'no due rolling target means no capability or request');
select is((select count(*)::integer from private.reaper_event_advance_dispatches), 0, 'native streams do not enqueue unattended jobs');
update public.discord_resources set metadata = metadata || '{"location":"https://www.twitch.tv/other"}'::jsonb where metadata->>'siteEventKey' = 'twitch-mochi-monday' and discord_parent_id = '1078630751077142608';
select is(private.reaper_dispatch_event_advance(), null::uuid, 'postactivation stream drift sends no request');
select is((select enabled from private.reaper_event_advancement_policy), false, 'postactivation stream drift latches advancement disabled');
select is((select disabled_reason from private.reaper_event_advancement_policy), 'registry-drift', 'existing fail-stop reason is preserved');

select * from finish();
rollback;
