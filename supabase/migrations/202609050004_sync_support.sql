create table public.instagram_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index instagram_sync_runs_account_started_idx
on public.instagram_sync_runs(account_id, started_at desc);

alter table public.instagram_sync_runs enable row level security;
revoke all on table public.instagram_sync_runs from anon, authenticated;
grant select on table public.instagram_sync_runs to authenticated;

create policy "Users can view their Instagram sync runs"
on public.instagram_sync_runs for select to authenticated
using (exists (
  select 1 from public.instagram_accounts
  where instagram_accounts.id = instagram_sync_runs.account_id
    and instagram_accounts.user_id = (select auth.uid())
));

create or replace function public.instagram_accounts_for_sync(target_user_id uuid default null)
returns table (
  id uuid,
  user_id uuid,
  encrypted_access_token text,
  token_expires_at timestamptz
)
language sql
security definer set search_path = ''
as $$
  select a.id, a.user_id, t.encrypted_access_token, t.expires_at
  from public.instagram_accounts a
  join private.instagram_tokens t on t.account_id = a.id
  where a.status <> 'disconnected'
    and (target_user_id is null or a.user_id = target_user_id);
$$;

revoke execute on function public.instagram_accounts_for_sync(uuid)
from public, anon, authenticated;
grant execute on function public.instagram_accounts_for_sync(uuid)
to service_role;
