create table public.instagram_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  return_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index instagram_oauth_states_expires_at_idx
on public.instagram_oauth_states(expires_at);

alter table public.instagram_oauth_states enable row level security;
revoke all on table public.instagram_oauth_states from anon, authenticated;
grant all on table public.instagram_oauth_states to service_role;

create or replace function public.store_instagram_token(
  target_account_id uuid,
  encrypted_token text,
  token_expires_at timestamptz
)
returns void
language sql
security definer set search_path = ''
as $$
  insert into private.instagram_tokens (account_id, encrypted_access_token, expires_at)
  values (target_account_id, encrypted_token, token_expires_at)
  on conflict (account_id) do update set
    encrypted_access_token = excluded.encrypted_access_token,
    expires_at = excluded.expires_at,
    updated_at = now();
$$;

revoke execute on function public.store_instagram_token(uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.store_instagram_token(uuid, text, timestamptz)
to service_role;
