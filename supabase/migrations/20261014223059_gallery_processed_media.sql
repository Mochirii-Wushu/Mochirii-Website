-- Release-gated: increasing the provider's global Storage limit and plan
-- requires separate approval. This migration changes only the private bucket.
alter table public.gallery_submissions drop constraint gallery_submissions_size_bytes_check;
alter table public.gallery_submissions add constraint gallery_submissions_size_bytes_check
  check (size_bytes between 1 and 104857600);
update storage.buckets set file_size_limit = 104857600 where id = 'member-gallery' and public = false;
grant insert (id) on public.gallery_submissions to authenticated;

alter table public.gallery_submissions
  add column viewer_revision_id uuid,
  add column viewer_storage_path text,
  add column viewer_mime_type text,
  add column viewer_size_bytes bigint,
  add column viewer_width integer,
  add column viewer_height integer,
  add column source_sha256 text,
  add column source_etag text,
  add column processing_version text;
alter table public.gallery_submissions add constraint gallery_viewer_complete_check check (
  num_nonnulls(viewer_revision_id,viewer_storage_path,viewer_mime_type,viewer_size_bytes,
    viewer_width,viewer_height,source_sha256,source_etag,processing_version) = 0
  or (num_nonnulls(viewer_revision_id,viewer_storage_path,viewer_mime_type,viewer_size_bytes,
    viewer_width,viewer_height,source_sha256,source_etag,processing_version) = 9
    and (viewer_revision_id = thumbnail_revision_id
      and viewer_storage_path = '_approved/full/' || id::text || '/' || viewer_revision_id::text || '.webp'
      and viewer_mime_type = 'image/webp' and viewer_size_bytes between 1 and 3145728
      and viewer_width between 1 and 2560 and viewer_height between 1 and 2560
      and source_sha256 ~ '^[0-9a-f]{64}$' and source_etag ~ '^[0-9a-f]{32}(-[1-9][0-9]{0,5})?$'
      and processing_version = 'gallery-media-v1') is true)
);
create or replace function public.enforce_gallery_original_immutability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(old.id,old.user_id,old.storage_bucket,old.storage_path,old.mime_type,old.size_bytes)
    is distinct from row(new.id,new.user_id,new.storage_bucket,new.storage_path,new.mime_type,new.size_bytes) then
    raise exception 'A gallery original is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create or replace function private.member_gallery_original_mutation_allowed(
  p_user_id uuid,p_bucket_id text,p_object_name text,p_allow_orphan boolean
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id=auth.uid() and p_bucket_id='member-gallery'
    and (storage.foldername(p_object_name))[1]=p_user_id::text and p_allow_orphan
    and not exists(select 1 from public.gallery_submissions s
      where s.storage_bucket=p_bucket_id and s.storage_path=p_object_name);
$$;

-- Keep the reviewed thumbnail/audit transaction private, with no old public
-- approval overload that could bypass full-view preparation.
alter function public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid) set schema private;
revoke all on function private.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid)
  from public,anon,authenticated,service_role;
create function public.gallery_commit_moderation(
  p_submission_id uuid,p_moderator_id uuid,p_action text,p_reason text default null,
  p_thumbnail_revision_id uuid default null,p_thumbnail_storage_path text default null,
  p_thumbnail_mime_type text default null,p_thumbnail_size_bytes bigint default null,
  p_expected_thumbnail_revision_id uuid default null,p_media jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_submission public.gallery_submissions%rowtype;
  selected public.gallery_submissions%rowtype;
  original_metadata jsonb;
  full_metadata jsonb;
  thumbnail_metadata jsonb;
  result jsonb;
  job public.gallery_instagram_publish_jobs%rowtype;
  full_path text;
  full_size bigint;
  full_width integer;
  full_height integer;
  job_status text;
  eligibility text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Service role required.' using errcode='42501';
  end if;
  if p_moderator_id is null or p_action is null or p_action not in ('approved','rejected','thumbnail') then
    raise exception 'Invalid moderation input.' using errcode='22023';
  end if;
  select * into current_submission from public.gallery_submissions where id=p_submission_id for update;
  if not found then return jsonb_build_object('committed',false,'reason','submission_not_found'); end if;
  if p_action in ('approved','rejected') and current_submission.status<>'pending'
    and current_submission.viewer_revision_id is distinct from p_thumbnail_revision_id then
    return jsonb_build_object('committed',false,'reason','submission_not_pending');
  end if;
  if p_action='thumbnail' and current_submission.status<>'approved' then
    return jsonb_build_object('committed',false,'reason','submission_not_approved');
  end if;
  if p_action='thumbnail' and current_submission.thumbnail_revision_id is distinct from p_expected_thumbnail_revision_id
    and current_submission.viewer_revision_id is distinct from p_thumbnail_revision_id then
    return jsonb_build_object('committed',false,'reason','stale_thumbnail_revision');
  end if;
  if p_action in ('approved','thumbnail') then
    if p_media is null or jsonb_typeof(p_media)<>'object' then
      raise exception 'Complete processed gallery media required.' using errcode='22023';
    end if;
    if not (p_media ?& array['storage_bucket','storage_path','mime_type','size_bytes','etag','sha256',
        'viewer_storage_path','viewer_size_bytes','viewer_width','viewer_height','processing_version'])
      or (select count(*) from jsonb_object_keys(p_media))<>11 or p_thumbnail_revision_id is null
      or p_media->>'storage_bucket' is distinct from current_submission.storage_bucket
      or p_media->>'storage_path' is distinct from current_submission.storage_path
      or p_media->>'mime_type' is distinct from current_submission.mime_type
      or p_media->>'size_bytes' is distinct from current_submission.size_bytes::text
      or coalesce(p_media->>'etag','') !~ '^[0-9a-f]{32}(-[1-9][0-9]{0,5})?$'
      or coalesce(p_media->>'sha256','') !~ '^[0-9a-f]{64}$'
      or p_media->>'processing_version' is distinct from 'gallery-media-v1'
      or coalesce(p_media->>'viewer_size_bytes','') !~ '^[0-9]{1,7}$'
      or coalesce(p_media->>'viewer_width','') !~ '^[0-9]{1,4}$'
      or coalesce(p_media->>'viewer_height','') !~ '^[0-9]{1,4}$' then
      raise exception 'Complete processed gallery media required.' using errcode='22023';
    end if;
    full_path:='_approved/full/' || p_submission_id::text || '/' || p_thumbnail_revision_id::text || '.webp';
    full_size:=(p_media->>'viewer_size_bytes')::bigint;
    full_width:=(p_media->>'viewer_width')::integer;
    full_height:=(p_media->>'viewer_height')::integer;
    if p_media->>'viewer_storage_path' is distinct from full_path or full_size not between 1 and 3145728
      or full_width not between 1 and 2560 or full_height not between 1 and 2560 then
      raise exception 'Invalid processed gallery bounds.' using errcode='22023';
    end if;
    if current_submission.status='approved' and current_submission.viewer_revision_id=p_thumbnail_revision_id then
      return jsonb_build_object('committed',true,'submission',to_jsonb(current_submission),'action',p_action);
    end if;
    select metadata into original_metadata from storage.objects
      where bucket_id=current_submission.storage_bucket and name=current_submission.storage_path for share;
    if not found or original_metadata->>'size' is distinct from current_submission.size_bytes::text
      or lower(original_metadata->>'mimetype') is distinct from current_submission.mime_type
      or lower(trim(both '"' from coalesce(original_metadata->>'eTag',original_metadata->>'etag','')))
      is distinct from p_media->>'etag' then
      return jsonb_build_object('committed',false,'reason','original_object_mismatch');
    end if;
    select metadata into full_metadata from storage.objects where bucket_id='member-gallery' and name=full_path for share;
    if not found or full_metadata->>'size' is distinct from full_size::text
      or full_metadata->>'mimetype' is distinct from 'image/webp' then
      return jsonb_build_object('committed',false,'reason','viewer_object_mismatch');
    end if;
    -- Hold non-key metadata stable as well as object existence until commit.
    select metadata into thumbnail_metadata from storage.objects
      where bucket_id='member-gallery' and name=p_thumbnail_storage_path for share;
    if not found or thumbnail_metadata->>'size' is distinct from p_thumbnail_size_bytes::text
      or thumbnail_metadata->>'mimetype' is distinct from 'image/webp' then
      return jsonb_build_object('committed',false,'reason','thumbnail_object_mismatch');
    end if;
  elsif p_media is not null then
    raise exception 'Rejected submissions cannot publish media.' using errcode='22023';
  end if;
  -- All preparation happened outside this short transaction. A conflict or
  -- audit failure rolls back both this temporary clearing and the selection.
  if p_action='thumbnail' then
    update public.gallery_submissions set viewer_revision_id=null,viewer_storage_path=null,
      viewer_mime_type=null,viewer_size_bytes=null,viewer_width=null,viewer_height=null,
      source_sha256=null,source_etag=null,processing_version=null where id=p_submission_id;
  end if;
  result:=private.gallery_commit_moderation(p_submission_id,p_moderator_id,p_action,p_reason,
    p_thumbnail_revision_id,p_thumbnail_storage_path,p_thumbnail_mime_type,p_thumbnail_size_bytes,p_expected_thumbnail_revision_id);
  if result->>'committed' is distinct from 'true' then
    raise exception 'Gallery moderation conflict.' using errcode='40001';
  end if;
  if p_action in ('approved','thumbnail') then
    update public.gallery_submissions set viewer_revision_id=p_thumbnail_revision_id,viewer_storage_path=full_path,
      viewer_mime_type='image/webp',viewer_size_bytes=full_size,viewer_width=full_width,viewer_height=full_height,
      source_sha256=p_media->>'sha256',source_etag=p_media->>'etag',processing_version='gallery-media-v1'
      where id=p_submission_id;
  end if;
  select * into selected from public.gallery_submissions where id=p_submission_id;
  if p_action='approved' and selected.instagram_opt_in then
    -- Keep the separate original-JPEG delivery path. This queues only; no
    -- external publishing or consent change occurs inside moderation.
    job_status:=case when selected.mime_type='image/jpeg' then 'queued' else 'ineligible' end;
    eligibility:=case when selected.mime_type='image/jpeg' then null else 'Instagram v1 publishing supports JPEG images only.' end;
    insert into public.gallery_instagram_publish_jobs(submission_id,status,eligibility_reason,caption,alt_text,queued_by)
      values(p_submission_id,job_status,eligibility,
        left(concat_ws(E'\n\n',nullif(selected.title,''),nullif(selected.caption,''),'Shared from the Mōchirīī guild gallery.'),2200),
        left('Mōchirīī guild gallery submission: ' || coalesce(nullif(selected.title,''),'Member gallery image'),1000),p_moderator_id)
      on conflict(submission_id) do nothing returning * into job;
    if found then
      insert into public.gallery_instagram_publish_events(job_id,submission_id,actor_id,action,details)
        values(job.id,p_submission_id,p_moderator_id,job_status,jsonb_build_object('reason',eligibility,'mime_type',selected.mime_type));
    end if;
  end if;
  return jsonb_build_object('committed',true,'submission',to_jsonb(selected),'action',p_action);
end;
$$;
revoke all on function public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gallery_commit_moderation(uuid,uuid,text,text,uuid,text,text,bigint,uuid,jsonb) to service_role;

-- Preserve legacy originals without automatic backfill. New revisions are
-- eligible only while both derivatives and their original ETag still match.
create or replace function public.gallery_publishable_submissions(p_limit integer default 80,p_offset integer default 0)
returns setof public.gallery_submissions language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
  return query select s.* from public.gallery_submissions s
    join storage.objects o on o.bucket_id=s.storage_bucket and o.name=s.storage_path
    join storage.objects t on t.bucket_id='member-gallery' and t.name=s.thumbnail_storage_path
    left join storage.objects v on v.bucket_id='member-gallery' and v.name=s.viewer_storage_path
    where s.status='approved' and s.thumbnail_revision_id is not null and s.thumbnail_mime_type='image/webp'
      and s.thumbnail_size_bytes between 1 and 81920
      and s.thumbnail_storage_path='_approved/thumbs/' || s.id::text || '/' || s.thumbnail_revision_id::text || '.webp'
      and o.metadata->>'size'=s.size_bytes::text and lower(o.metadata->>'mimetype')=s.mime_type
      and t.metadata->>'size'=s.thumbnail_size_bytes::text and t.metadata->>'mimetype'='image/webp'
      and (s.viewer_revision_id is null or (v.id is not null and v.metadata->>'size'=s.viewer_size_bytes::text
        and v.metadata->>'mimetype'='image/webp'
        and lower(trim(both '"' from coalesce(o.metadata->>'eTag',o.metadata->>'etag','')))=s.source_etag))
    order by s.reviewed_at desc nulls last,s.created_at desc,s.id desc
    limit least(greatest(coalesce(p_limit,80),1),80) offset least(greatest(coalesce(p_offset,0),0),10000);
end;
$$;
comment on column public.gallery_submissions.viewer_revision_id is 'Same immutable revision as thumbnail; nullable for legacy/unprocessed records.';
comment on column public.gallery_submissions.source_sha256 is 'Private trusted-decoder source binding; excluded from the public feed.';
