begin;

set local lock_timeout = '5s';

create schema if not exists private;
revoke all on schema private from public, anon;

-- Each authenticated ingest request consumes one short-lived nonce. This
-- relation is deliberately outside the Data API, has no policies, and is
-- reachable only through the narrowly granted service-role RPC below.
create table private.discord_gallery_ingest_nonces (
  key_id text not null,
  nonce text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default statement_timestamp(),
  primary key (key_id, nonce),
  constraint discord_gallery_ingest_nonces_key_id_check
    check (key_id ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  constraint discord_gallery_ingest_nonces_nonce_check
    check (nonce ~ '^[0-9a-f]{32}$'),
  constraint discord_gallery_ingest_nonces_expiry_check
    check (
      expires_at >= consumed_at - interval '5 seconds'
      and expires_at <= consumed_at + interval '3 minutes'
    )
);

create index discord_gallery_ingest_nonces_expires_at_idx
on private.discord_gallery_ingest_nonces (expires_at);

alter table private.discord_gallery_ingest_nonces enable row level security;
alter table private.discord_gallery_ingest_nonces force row level security;
revoke all on table private.discord_gallery_ingest_nonces
from public, anon, authenticated, service_role;

create or replace function public.consume_discord_gallery_ingest_nonce(
  p_key_id text,
  p_nonce text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  inserted boolean := false;
begin
  if request_role <> 'service_role'
    and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'gallery_ingest_service_role_required'
      using errcode = '42501';
  end if;

  if coalesce(p_key_id, '') !~ '^[a-z0-9][a-z0-9_-]{0,31}$'
    or coalesce(p_nonce, '') !~ '^[0-9a-f]{32}$'
    or p_expires_at < statement_timestamp() - interval '5 seconds'
    or p_expires_at > statement_timestamp() + interval '3 minutes' then
    return false;
  end if;

  delete from private.discord_gallery_ingest_nonces
  where expires_at < statement_timestamp() - interval '5 seconds';

  insert into private.discord_gallery_ingest_nonces (
    key_id,
    nonce,
    expires_at
  ) values (
    p_key_id,
    p_nonce,
    p_expires_at
  )
  on conflict (key_id, nonce) do nothing
  returning true into inserted;

  return coalesce(inserted, false);
end;
$$;

revoke all on function public.consume_discord_gallery_ingest_nonce(
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.consume_discord_gallery_ingest_nonce(
  text,
  text,
  timestamptz
) to service_role;

comment on function public.consume_discord_gallery_ingest_nonce(
  text,
  text,
  timestamptz
) is 'Atomically consumes one short-lived Discord gallery ingest HMAC nonce for service-role callers.';

commit;
