-- Read-only closeout evidence for the immutable Gallery publication feed.
-- Run from a trusted database session only after the reviewed migration and
-- data operations are present. The result contains counts, never object paths,
-- signed URLs, source submission IDs, or member identifiers.

begin transaction read only;
set local statement_timeout = '30s';

with recursive feed_pages as (
  select
    1 as page_number,
    null::jsonb as prior_cursor,
    public.gallery_public_feed_page_v2(
      24, null, null, null, null, 'newest', null, null
    ) as page_data

  union all

  select
    prior.page_number + 1,
    prior.page_data -> 'nextCursor',
    public.gallery_public_feed_page_v2(
      24,
      (prior.page_data -> 'nextCursor' ->> 'snapshotAt')::timestamptz,
      (prior.page_data -> 'nextCursor' ->> 'reviewedAt')::timestamptz,
      (prior.page_data -> 'nextCursor' ->> 'createdAt')::timestamptz,
      (prior.page_data -> 'nextCursor' ->> 'id')::uuid,
      'newest',
      null,
      null
    )
  from feed_pages as prior
  where coalesce((prior.page_data ->> 'hasMore')::boolean, false)
    and jsonb_typeof(prior.page_data -> 'nextCursor') = 'object'
    and prior.page_data -> 'nextCursor' is distinct from prior.prior_cursor
    and prior.page_number < 10000
),
feed_items as (
  select (item ->> 'id')::uuid as publication_id
  from feed_pages
  cross join lateral jsonb_array_elements(page_data -> 'items') as item
),
first_page as (
  select page_data
  from feed_pages
  where page_number = 1
),
last_page as (
  select page_number, page_data
  from feed_pages
  order by page_number desc
  limit 1
),
summary as (
  select
    (first_page.page_data ->> 'totalEligible')::bigint as eligible_count,
    (select count(*) from feed_items) as traversed_count,
    (select count(distinct publication_id) from feed_items) as distinct_count,
    first_page.page_data -> 'facets' as facets,
    last_page.page_number as page_count,
    coalesce((last_page.page_data ->> 'hasMore')::boolean, false)
      as traversal_incomplete,
    bool_and(
      page.page_data -> 'facets' = first_page.page_data -> 'facets'
      and page.page_data ->> 'totalEligible'
        = first_page.page_data ->> 'totalEligible'
    ) as page_contract_stable
  from first_page
  cross join last_page
  cross join feed_pages as page
  group by first_page.page_data, last_page.page_number, last_page.page_data
),
result as (
  select
    *,
    jsonb_typeof(facets) = 'object'
      and facets ?& array[
        'member-submissions',
        'portraits',
        'gatherings',
        'action',
        'scenery',
        'companions'
      ]
      and (select count(*) from jsonb_object_keys(facets)) = 6
      and (facets ->> 'member-submissions')::bigint = eligible_count
      and (
        (facets ->> 'portraits')::bigint
        + (facets ->> 'gatherings')::bigint
        + (facets ->> 'action')::bigint
        + (facets ->> 'scenery')::bigint
        + (facets ->> 'companions')::bigint
      ) = eligible_count
      as facets_reconciled,
    eligible_count = traversed_count
      and traversed_count = distinct_count
      and not traversal_incomplete
      and page_contract_stable
      as traversal_reconciled
  from summary
),
guarded as (
  select
    *,
    facets_reconciled and traversal_reconciled as reconciled
  from result
)
select
  jsonb_build_object(
    'eligibleCount', eligible_count,
    'traversedCount', traversed_count,
    'distinctCount', distinct_count,
    'facets', facets,
    'pageCount', page_count,
    'facetsReconciled', facets_reconciled,
    'traversalReconciled', traversal_reconciled,
    'reconciled', reconciled
  ) as gallery_public_feed_reconciliation,
  case
    when reconciled then 1
    else concat(
      'gallery-public-feed-reconciliation-failed-',
      pg_backend_pid()
    )::integer
  end as reconciliation_guard
from guarded;

rollback;
