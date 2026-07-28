-- Read-only closeout for the immutable Gallery publication contract.
--
-- Run only after every intended historical item has been explicitly reviewed
-- and republished through the moderator workflow. An approved legacy
-- gallery_submissions row without gallery_publication_id is deliberately
-- private and is not a validation failure. Never bulk-promote or infer public
-- media from legacy thumbnail fields.

begin transaction isolation level repeatable read read only;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $$
begin
  if exists (
    select 1
    from private.gallery_publication_revisions as publication
    join public.gallery_submissions as submission
      on submission.id = publication.submission_id
    left join storage.objects as display_object
      on display_object.bucket_id = publication.storage_bucket
      and display_object.name = publication.original_storage_path
    left join storage.objects as thumbnail_object
      on thumbnail_object.bucket_id = publication.storage_bucket
      and thumbnail_object.name = publication.thumbnail_storage_path
    where publication.visible_until is null
      and (
        submission.status <> 'approved'
        or submission.gallery_publication_id is distinct from publication.publication_id
        or submission.thumbnail_revision_id is distinct from publication.id
        or submission.thumbnail_storage_path is distinct from publication.thumbnail_storage_path
        or publication.storage_bucket <> 'member-gallery'
        or publication.original_storage_path <> (
          '_approved/publications/' || publication.publication_id::text || '/display.webp'
        )
        or publication.original_mime_type <> 'image/webp'
        or publication.original_size_bytes not between 1 and 2097152
        or publication.original_width not between 1 and 2560
        or publication.original_height not between 1 and 2560
        or publication.thumbnail_storage_path <> (
          '_approved/publications/' || publication.publication_id::text ||
          '/revisions/' || publication.id::text || '/thumbnail.webp'
        )
        or publication.thumbnail_mime_type <> 'image/webp'
        or publication.thumbnail_size_bytes not between 1 and 81920
        or publication.thumbnail_width not between 1 and 720
        or publication.thumbnail_height not between 1 and 720
        or display_object.id is null
        or (case
          when coalesce(display_object.metadata ->> 'size', '') ~ '^[0-9]+$'
            then (display_object.metadata ->> 'size')::bigint
          else null
        end) is distinct from publication.original_size_bytes
        or lower(coalesce(display_object.metadata ->> 'mimetype', ''))
          <> publication.original_mime_type
        or thumbnail_object.id is null
        or (case
          when coalesce(thumbnail_object.metadata ->> 'size', '') ~ '^[0-9]+$'
            then (thumbnail_object.metadata ->> 'size')::bigint
          else null
        end) is distinct from publication.thumbnail_size_bytes
        or lower(coalesce(thumbnail_object.metadata ->> 'mimetype', ''))
          <> publication.thumbnail_mime_type
      )
  ) then
    raise exception 'Active Gallery publication media is incomplete or mismatched.';
  end if;

  if exists (
    select 1
    from public.gallery_submissions as submission
    where submission.status = 'approved'
      and submission.gallery_publication_id is not null
      and not exists (
        select 1
        from private.gallery_publication_revisions as publication
        where publication.submission_id = submission.id
          and publication.publication_id = submission.gallery_publication_id
          and publication.id = submission.thumbnail_revision_id
          and publication.visible_until is null
      )
  ) then
    raise exception 'A linked approved Gallery submission has no matching active publication revision.';
  end if;
end
$$;

commit;
