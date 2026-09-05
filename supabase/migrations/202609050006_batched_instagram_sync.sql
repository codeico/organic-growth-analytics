alter table public.instagram_accounts
add column next_sync_at timestamptz not null default now();

create index instagram_accounts_next_sync_idx
on public.instagram_accounts(next_sync_at)
where status <> 'disconnected';

create or replace function public.instagram_accounts_for_sync_v2(
  target_user_id uuid default null,
  target_account_id uuid default null
)
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
    and (target_user_id is null or a.user_id = target_user_id)
    and (target_account_id is null or a.id = target_account_id)
  order by a.next_sync_at, a.id
  limit 20;
$$;

revoke execute on function public.instagram_accounts_for_sync_v2(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.instagram_accounts_for_sync_v2(uuid, uuid)
to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'instagram-daily-sync') then
    perform cron.unschedule('instagram-daily-sync');
  end if;
end
$$;

select cron.schedule(
  'instagram-daily-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://fqwpwisjsvolpoqigbms.supabase.co/functions/v1/instagram-sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'instagram_sync_cron_secret'
        order by created_at desc
        limit 1
      )
    ),
    body := jsonb_build_object('account_id', account.id)
  )
  from (
    select id
    from public.instagram_accounts
    where status <> 'disconnected'
      and next_sync_at <= now()
    order by next_sync_at, id
    limit 20
    for update skip locked
  ) account;
  $$
);
