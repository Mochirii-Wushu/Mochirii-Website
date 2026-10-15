-- Conservative admission accounting, not a physical/billing hard cap: Storage
-- multipart staging and unrelated service-role writers remain provider gates.
-- Never expire reservations or delete originals to recover capacity implicitly.
create table private.gallery_upload_reservations (
  id uuid primary key,
  user_id uuid not null,
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  source text not null check (source in ('website','discord')),
  discord_message_id text,
  discord_attachment_id text,
  state text not null default 'reserved' check (state in ('reserved','submitted')),
  created_at timestamptz not null default clock_timestamp(),
  constraint gallery_upload_reservation_source_check check (
    (source='website' and discord_message_id is null and discord_attachment_id is null)
    or (source='discord' and discord_message_id ~ '^[0-9]{16,22}$'
      and discord_attachment_id ~ '^[0-9]{16,22}$') is true)
);
create unique index gallery_upload_reservation_discord_key
  on private.gallery_upload_reservations(discord_message_id,discord_attachment_id) where source='discord';
create index gallery_upload_reservation_member_day_idx
  on private.gallery_upload_reservations(user_id,created_at);
alter table private.gallery_upload_reservations enable row level security;
revoke all on private.gallery_upload_reservations from public,anon,authenticated,service_role;

create table private.gallery_processing_slot (
  singleton boolean primary key default true check (singleton),
  actor_id uuid,
  submission_id uuid,
  lease_id uuid,
  acquired_at timestamptz,
  held_bytes bigint not null default 0 check (held_bytes in (0,3227648)),
  check (num_nonnulls(actor_id,submission_id,lease_id,acquired_at) in (0,4))
);
insert into private.gallery_processing_slot(singleton) values(true);
create table private.gallery_processing_tokens (
  lease_id uuid primary key,
  actor_id uuid not null,
  submission_id uuid not null,
  acquired_at timestamptz not null,
  released_at timestamptz
);
alter table private.gallery_processing_slot enable row level security;
alter table private.gallery_processing_tokens enable row level security;
revoke all on private.gallery_processing_slot,private.gallery_processing_tokens
  from public,anon,authenticated,service_role;

-- All admission functions take this transaction lock before any row lock.
-- Storage permission probes remain read-only and do not consume reservations.
create function private.gallery_admission_bytes() returns numeric
language plpgsql stable security definer set search_path='' as $$
declare total numeric; original_holds numeric; derivative_holds numeric;
begin
  if exists(select 1 from storage.objects where metadata is null
    or jsonb_typeof(metadata)<>'object'
    or coalesce(metadata->>'size','') !~ '^[0-9]{1,18}$') then return null; end if;
  select coalesce(sum((metadata->>'size')::numeric),0) into total from storage.objects;
  select coalesce(sum(greatest(52428800-coalesce((o.metadata->>'size')::numeric,0),0)),0)
    into original_holds from private.gallery_upload_reservations r
    left join storage.objects o on o.bucket_id='member-gallery' and o.name=r.storage_path
    where r.state='reserved';
  select coalesce(sum(3227648),0) into derivative_holds
    from private.gallery_upload_reservations r
    left join public.gallery_submissions s on s.id=r.id
    where (r.state='reserved' or s.status='pending') and not exists(
      select 1 from private.gallery_processing_slot p where p.singleton and p.lease_id is not null and p.submission_id=r.id);
  -- Existing pending originals also retain preparation headroom. Missing legacy
  -- objects are charged, not silently treated as available capacity.
  select total+original_holds+derivative_holds
    +coalesce(sum(case when exists(select 1 from private.gallery_processing_slot p
      where p.singleton and p.lease_id is not null and p.submission_id=s.id) then 0 else 3227648 end
      +greatest(s.size_bytes-coalesce((o.metadata->>'size')::numeric,0),0)),0)
    into total from public.gallery_submissions s
    left join storage.objects o on o.bucket_id=s.storage_bucket and o.name=s.storage_path
    where s.status='pending' and not exists(
      select 1 from private.gallery_upload_reservations r where r.id=s.id);
  return total+(select held_bytes from private.gallery_processing_slot where singleton);
end;
$$;
revoke all on function private.gallery_admission_bytes() from public,anon,authenticated,service_role;

create function private.gallery_reserve_upload(
  p_user_id uuid,p_upload_id uuid,p_storage_path text,p_size_bytes bigint,p_mime_type text,
  p_source text,p_discord_message_id text,p_discord_attachment_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.gallery_upload_reservations%rowtype; day_start timestamptz;
  new_count bigint; pending_count bigint; pending_bytes numeric; project_bytes numeric;
begin
  if coalesce(auth.role(),'')='authenticated' then
    if p_source is distinct from 'website' or p_user_id is distinct from auth.uid() then
      return jsonb_build_object('ok',false,'code','upload_access_denied'); end if;
  elsif coalesce(auth.role(),'')<>'service_role' or p_source is distinct from 'discord' then
    return jsonb_build_object('ok',false,'code','upload_access_denied');
  end if;
  if p_user_id is null or not private.member_has_gallery_upload_access(p_user_id) then
    return jsonb_build_object('ok',false,'code','upload_access_denied'); end if;
  if p_upload_id is null or p_size_bytes is null or p_size_bytes not between 1 and 52428800
    or p_mime_type is null or p_mime_type not in ('image/jpeg','image/png','image/webp')
    or p_storage_path is null or char_length(p_storage_path)>1000
    or split_part(p_storage_path,'/',1)<>p_user_id::text
    or p_storage_path ~ '(^|/)\.\.?(/|$)' or p_storage_path ~ '[[:cntrl:]\\?#%]' or position('//' in p_storage_path)>0
    or (p_source='website' and (p_storage_path<>p_user_id::text || '/' || p_upload_id::text || '.' || split_part(p_mime_type,'/',2)
      or p_discord_message_id is not null or p_discord_attachment_id is not null))
    or (p_source='discord' and (left(p_storage_path,char_length(p_user_id::text)+9)<>p_user_id::text || '/discord/'
      or p_discord_message_id is null or p_discord_message_id !~ '^[0-9]{16,22}$'
      or p_discord_attachment_id is null or p_discord_attachment_id !~ '^[0-9]{16,22}$')) then
    return jsonb_build_object('ok',false,'code','upload_conflict'); end if;
  perform pg_advisory_xact_lock(731924,1);
  select * into r from private.gallery_upload_reservations where id=p_upload_id for update;
  if found then
    if row(r.user_id,r.storage_path,r.size_bytes,r.mime_type,r.source,r.discord_message_id,r.discord_attachment_id)
      is distinct from row(p_user_id,p_storage_path,p_size_bytes,p_mime_type,p_source,p_discord_message_id,p_discord_attachment_id) then
      return jsonb_build_object('ok',false,'code','upload_conflict'); end if;
    return jsonb_build_object('ok',true,'upload_id',r.id,'storage_path',r.storage_path,'state',r.state)
      || case when r.state='submitted' then jsonb_build_object('submission_id',r.id) else '{}'::jsonb end;
  end if;
  if exists(select 1 from public.gallery_submissions where id=p_upload_id
      or (storage_bucket='member-gallery' and storage_path=p_storage_path))
    or exists(select 1 from private.gallery_upload_reservations where storage_path=p_storage_path)
    or exists(select 1 from storage.objects where bucket_id='member-gallery' and name=p_storage_path) then
    return jsonb_build_object('ok',false,'code','upload_conflict'); end if;
  day_start:=date_trunc('day',clock_timestamp() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore';
  select (select count(*) from private.gallery_upload_reservations where user_id=p_user_id and created_at>=day_start)
    +(select count(*) from public.gallery_submissions s where user_id=p_user_id and created_at>=day_start
      and not exists(select 1 from private.gallery_upload_reservations prior_reservation where prior_reservation.id=s.id)) into new_count;
  if new_count>=20 then return jsonb_build_object('ok',false,'code','upload_daily_limit'); end if;
  select count(*),coalesce(sum(size_bytes),0) into pending_count,pending_bytes
    from public.gallery_submissions where user_id=p_user_id and status='pending';
  select pending_count+count(*),pending_bytes+coalesce(sum(52428800),0) into pending_count,pending_bytes
    from private.gallery_upload_reservations where user_id=p_user_id and state='reserved';
  if pending_count>=5 then return jsonb_build_object('ok',false,'code','upload_pending_limit'); end if;
  if pending_bytes+52428800>262144000 then return jsonb_build_object('ok',false,'code','upload_storage_limit'); end if;
  project_bytes:=private.gallery_admission_bytes();
  if project_bytes is null or project_bytes+55656448>786432000 then
    return jsonb_build_object('ok',false,'code','upload_project_limit'); end if;
  insert into private.gallery_upload_reservations(id,user_id,storage_path,size_bytes,mime_type,source,discord_message_id,discord_attachment_id)
    values(p_upload_id,p_user_id,p_storage_path,p_size_bytes,p_mime_type,p_source,p_discord_message_id,p_discord_attachment_id)
    returning * into r;
  return jsonb_build_object('ok',true,'upload_id',r.id,'storage_path',r.storage_path,'state',r.state);
end;
$$;
revoke all on function private.gallery_reserve_upload(uuid,uuid,text,bigint,text,text,text,text) from public,anon;
grant execute on function private.gallery_reserve_upload(uuid,uuid,text,bigint,text,text,text,text) to authenticated,service_role;

create function public.gallery_reserve_upload(p_upload_id uuid,p_size_bytes bigint,p_mime_type text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.gallery_reserve_upload(auth.uid(),p_upload_id,
    auth.uid()::text || '/' || p_upload_id::text || '.' || split_part(p_mime_type,'/',2),
    p_size_bytes,p_mime_type,'website',null,null);
$$;
revoke all on function public.gallery_reserve_upload(uuid,bigint,text) from public,anon,service_role;
grant execute on function public.gallery_reserve_upload(uuid,bigint,text) to authenticated;

create function private.gallery_reserve_discord_upload(
  p_user_id uuid,p_storage_path text,p_size_bytes bigint,p_mime_type text,p_discord_message_id text,p_discord_attachment_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare upload_id uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then return jsonb_build_object('ok',false,'code','upload_access_denied'); end if;
  perform pg_advisory_xact_lock(731924,1);
  select id into upload_id from private.gallery_upload_reservations
    where source='discord' and discord_message_id=p_discord_message_id and discord_attachment_id=p_discord_attachment_id;
  return private.gallery_reserve_upload(p_user_id,coalesce(upload_id,gen_random_uuid()),p_storage_path,
    p_size_bytes,p_mime_type,'discord',p_discord_message_id,p_discord_attachment_id);
end;
$$;
revoke all on function private.gallery_reserve_discord_upload(uuid,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function private.gallery_reserve_discord_upload(uuid,text,bigint,text,text,text) to service_role;
create function public.gallery_reserve_discord_upload(
  p_user_id uuid,p_storage_path text,p_size_bytes bigint,p_mime_type text,p_discord_message_id text,p_discord_attachment_id text
) returns jsonb language sql security invoker set search_path='' as $$
  select private.gallery_reserve_discord_upload(p_user_id,p_storage_path,p_size_bytes,p_mime_type,p_discord_message_id,p_discord_attachment_id);
$$;
revoke all on function public.gallery_reserve_discord_upload(uuid,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.gallery_reserve_discord_upload(uuid,text,bigint,text,text,text) to service_role;

create function private.gallery_complete_upload(p_upload_id uuid,p_metadata jsonb,p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.gallery_upload_reservations%rowtype; s public.gallery_submissions%rowtype;
  object_metadata jsonb; opt_in boolean; copy_version text; allowed text[];
begin
  if (p_source='website' and coalesce(auth.role(),'')<>'authenticated')
    or (p_source='discord' and coalesce(auth.role(),'')<>'service_role')
    or p_source is null or p_source not in ('website','discord') then
    return jsonb_build_object('ok',false,'code','upload_access_denied'); end if;
  perform pg_advisory_xact_lock(731924,1);
  select * into r from private.gallery_upload_reservations where id=p_upload_id for update;
  if not found or r.source<>p_source or (p_source='website' and r.user_id is distinct from auth.uid()) then
    return jsonb_build_object('ok',false,'code','upload_access_denied'); end if;
  if not private.member_has_gallery_upload_access(r.user_id) then
    return jsonb_build_object('ok',false,'code','upload_access_denied'); end if;
  select * into s from public.gallery_submissions where id=r.id for update;
  if found then
    if row(s.user_id,s.storage_path,s.size_bytes,s.mime_type,s.submission_source)
      is distinct from row(r.user_id,r.storage_path,r.size_bytes,r.mime_type,r.source) then
      return jsonb_build_object('ok',false,'code','upload_conflict'); end if;
    return jsonb_build_object('ok',true,'submission',to_jsonb(s));
  end if;
  if r.state<>'reserved' then return jsonb_build_object('ok',false,'code','upload_conflict'); end if;
  allowed:=array['original_filename','title','caption','category','instagram_opt_in','instagram_opt_in_copy_version'];
  if p_source='discord' then allowed:=allowed||array['discord_guild_id','discord_channel_id','discord_user_id']; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' then
    return jsonb_build_object('ok',false,'code','upload_conflict'); end if;
  if exists(select 1 from jsonb_object_keys(p_metadata) k where not k=any(allowed))
    or exists(select 1 from jsonb_each(p_metadata) e where e.key<>'instagram_opt_in'
      and jsonb_typeof(e.value) not in ('string','null'))
    or (p_metadata ? 'instagram_opt_in' and jsonb_typeof(p_metadata->'instagram_opt_in')<>'boolean')
    or char_length(coalesce(p_metadata->>'original_filename',''))>255
    or char_length(coalesce(p_metadata->>'title',''))>80
    or char_length(coalesce(p_metadata->>'caption',''))>300
    or char_length(coalesce(p_metadata->>'category',''))>40 then
    return jsonb_build_object('ok',false,'code','upload_conflict'); end if;
  opt_in:=coalesce((p_metadata->>'instagram_opt_in')::boolean,false);
  copy_version:=case when p_source='website' then '2026-06-website-upload-v1' else '2026-06-discord-submit-v1' end;
  if (opt_in and p_metadata->>'instagram_opt_in_copy_version' is distinct from copy_version)
    or (not opt_in and p_metadata->>'instagram_opt_in_copy_version' is not null)
    or (p_source='discord' and (p_metadata->>'discord_guild_id' is distinct from '1078630751077142608'
      or coalesce(p_metadata->>'discord_channel_id','') !~ '^[0-9]{16,22}$'
      or coalesce(p_metadata->>'discord_user_id','') !~ '^[0-9]{16,22}$'
      or not exists(select 1 from public.member_profiles where id=r.user_id
        and discord_user_id=p_metadata->>'discord_user_id'))) then
    return jsonb_build_object('ok',false,'code','upload_conflict'); end if;
  select metadata into object_metadata from storage.objects
    where bucket_id='member-gallery' and name=r.storage_path for share;
  if not found or object_metadata->>'size' is distinct from r.size_bytes::text
    or object_metadata->>'mimetype' is distinct from r.mime_type then
    return jsonb_build_object('ok',false,'code','upload_conflict'); end if;
  insert into public.gallery_submissions(id,user_id,storage_bucket,storage_path,original_filename,mime_type,size_bytes,
    title,caption,category,submission_source,discord_guild_id,discord_channel_id,discord_message_id,discord_attachment_id,
    discord_user_id,instagram_opt_in,instagram_opt_in_at,instagram_opt_in_source,instagram_opt_in_copy_version)
  values(r.id,r.user_id,'member-gallery',r.storage_path,p_metadata->>'original_filename',r.mime_type,r.size_bytes,
    p_metadata->>'title',p_metadata->>'caption',case when r.source='discord' then 'discord' else p_metadata->>'category' end,r.source,
    p_metadata->>'discord_guild_id',p_metadata->>'discord_channel_id',r.discord_message_id,r.discord_attachment_id,
    p_metadata->>'discord_user_id',opt_in,case when opt_in then clock_timestamp() else null end,
    case when opt_in then case when r.source='website' then 'website_upload' else 'discord_slash_command' end else null end,
    case when opt_in then copy_version else null end) returning * into s;
  update private.gallery_upload_reservations set state='submitted' where id=r.id;
  return jsonb_build_object('ok',true,'submission',to_jsonb(s));
end;
$$;
revoke all on function private.gallery_complete_upload(uuid,jsonb,text) from public,anon;
grant execute on function private.gallery_complete_upload(uuid,jsonb,text) to authenticated,service_role;
create function public.gallery_complete_upload(p_upload_id uuid,p_metadata jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.gallery_complete_upload(p_upload_id,p_metadata,'website');
$$;
revoke all on function public.gallery_complete_upload(uuid,jsonb) from public,anon,service_role;
grant execute on function public.gallery_complete_upload(uuid,jsonb) to authenticated;
create function public.gallery_complete_discord_upload(p_upload_id uuid,p_metadata jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.gallery_complete_upload(p_upload_id,p_metadata,'discord');
$$;
revoke all on function public.gallery_complete_discord_upload(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gallery_complete_discord_upload(uuid,jsonb) to service_role;

create function private.gallery_storage_insert_allowed(p_name text,p_metadata jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(auth.role(),'')='authenticated' and auth.uid() is not null
    and private.member_has_gallery_upload_access(auth.uid()) and exists(
      select 1 from private.gallery_upload_reservations r where r.user_id=auth.uid()
        and r.storage_path=p_name and r.state='reserved'
        and jsonb_typeof(p_metadata)='object' and p_metadata->>'mimetype'=r.mime_type
        and (p_metadata ? 'size' or p_metadata ? 'contentLength')
        and (not p_metadata ? 'size' or p_metadata->>'size'=r.size_bytes::text)
        and (not p_metadata ? 'contentLength' or p_metadata->>'contentLength'=r.size_bytes::text));
$$;
revoke all on function private.gallery_storage_insert_allowed(text,jsonb) from public,anon,service_role;
grant execute on function private.gallery_storage_insert_allowed(text,jsonb) to authenticated;
drop policy if exists "Members upload own gallery objects" on storage.objects;
create policy "Members upload reserved gallery originals" on storage.objects for insert to authenticated
  with check(bucket_id='member-gallery' and private.gallery_storage_insert_allowed(name,metadata));
drop policy if exists "Members update own gallery objects" on storage.objects;
drop policy if exists "Members update own pending gallery originals" on storage.objects;
drop policy if exists "Members delete own gallery objects" on storage.objects;
drop policy if exists "Members delete own pending or orphaned gallery originals" on storage.objects;
revoke insert on public.gallery_submissions from authenticated;
revoke insert(id,user_id,storage_bucket,storage_path,original_filename,mime_type,size_bytes,title,caption,category,
  instagram_opt_in,instagram_opt_in_at,instagram_opt_in_source,instagram_opt_in_copy_version)
  on public.gallery_submissions from authenticated;

create function private.gallery_processing_admission(p_actor_id uuid,p_submission_id uuid,p_lease_id uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare slot private.gallery_processing_slot%rowtype; token private.gallery_processing_tokens%rowtype;
  extra_bytes bigint; total numeric;
begin
  if coalesce(auth.role(),'')<>'service_role' or p_actor_id is null or p_submission_id is null or p_lease_id is null
    or p_operation is null or p_operation not in ('acquire','release') then
    return jsonb_build_object('acquired',false,'code','not_owner'); end if;
  perform pg_advisory_xact_lock(731924,1);
  select * into slot from private.gallery_processing_slot where singleton for update;
  if not found then return jsonb_build_object('acquired',false,'code','not_owner'); end if;
  select * into token from private.gallery_processing_tokens where lease_id=p_lease_id;
  if p_operation='release' then
    if row(slot.actor_id,slot.submission_id,slot.lease_id) is not distinct from row(p_actor_id,p_submission_id,p_lease_id) then
      update private.gallery_processing_tokens set released_at=clock_timestamp() where lease_id=p_lease_id;
      update private.gallery_processing_slot set actor_id=null,submission_id=null,lease_id=null,acquired_at=null,held_bytes=0 where singleton;
      return jsonb_build_object('acquired',false,'code','released');
    end if;
    if token.released_at is not null and token.actor_id=p_actor_id and token.submission_id=p_submission_id then
      return jsonb_build_object('acquired',false,'code','released'); end if;
    return jsonb_build_object('acquired',false,'code','not_owner');
  end if;
  if token.lease_id is not null then
    if token.released_at is null and row(slot.actor_id,slot.submission_id,slot.lease_id)
      is not distinct from row(p_actor_id,p_submission_id,p_lease_id) then
      if clock_timestamp()>=slot.acquired_at+interval '120 seconds' then
        return jsonb_build_object('acquired',false,'code','stale'); end if;
      return jsonb_build_object('acquired',true,'code','acquired');
    end if;
    return jsonb_build_object('acquired',false,'code','not_owner');
  end if;
  if slot.lease_id is not null then
    return jsonb_build_object('acquired',false,'code',case when clock_timestamp()>=slot.acquired_at+interval '120 seconds' then 'stale' else 'busy' end);
  end if;
  -- Fresh moderator authority is verified by the service's real Auth/Discord
  -- handler and HMAC before this call, never by member-editable role metadata.
  if not exists(select 1 from auth.users where id=p_actor_id)
    or not exists(select 1 from public.gallery_submissions where id=p_submission_id and status in ('pending','approved')) then
    return jsonb_build_object('acquired',false,'code','not_owner'); end if;
  select case when status='pending' then 0 else 3227648 end into extra_bytes
    from public.gallery_submissions where id=p_submission_id;
  total:=private.gallery_admission_bytes();
  if total is null or total+extra_bytes>786432000 then
    return jsonb_build_object('acquired',false,'code','busy'); end if;
  insert into private.gallery_processing_tokens(lease_id,actor_id,submission_id,acquired_at)
    values(p_lease_id,p_actor_id,p_submission_id,clock_timestamp());
  update private.gallery_processing_slot set actor_id=p_actor_id,submission_id=p_submission_id,lease_id=p_lease_id,
    acquired_at=clock_timestamp(),held_bytes=3227648 where singleton;
  return jsonb_build_object('acquired',true,'code','acquired');
end;
$$;
revoke all on function private.gallery_processing_admission(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.gallery_processing_admission(uuid,uuid,uuid,text) to service_role;
create function public.gallery_processing_admission(p_actor_id uuid,p_submission_id uuid,p_lease_id uuid,p_operation text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.gallery_processing_admission(p_actor_id,p_submission_id,p_lease_id,p_operation);
$$;
revoke all on function public.gallery_processing_admission(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gallery_processing_admission(uuid,uuid,uuid,text) to service_role;
