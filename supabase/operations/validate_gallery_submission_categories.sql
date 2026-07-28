-- Read-only closeout for reviewed public Gallery categories.
--
-- Legacy null or noncanonical gallery_submissions.category values are allowed
-- to remain private. A moderator must choose a canonical category as part of
-- an explicit republication; never infer it from provenance, filenames,
-- captions, or provider metadata.

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
    where publication.visible_until is null
      and (
        submission.status <> 'approved'
        or submission.gallery_publication_id is distinct from publication.publication_id
        or submission.category is null
        or submission.category not in (
          'portraits',
          'gatherings',
          'action',
          'scenery',
          'companions'
        )
        or publication.public_category <> submission.category
      )
  ) then
    raise exception 'An active Gallery publication has an unreviewed or mismatched category.';
  end if;
end
$$;

commit;
