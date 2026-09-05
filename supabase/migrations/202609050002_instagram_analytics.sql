create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instagram_user_id text not null,
  username text not null,
  name text,
  account_type text not null check (account_type in ('BUSINESS', 'MEDIA_CREATOR')),
  profile_picture_url text,
  status text not null default 'active' check (status in ('active', 'reconnect_required', 'disconnected')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, instagram_user_id)
);

create table private.instagram_tokens (
  account_id uuid primary key references public.instagram_accounts(id) on delete cascade,
  encrypted_access_token text not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on table private.instagram_tokens from public, anon, authenticated;

create table public.instagram_account_metrics (
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  metric_date date not null,
  followers_count bigint check (followers_count >= 0),
  reach bigint check (reach >= 0),
  total_interactions bigint check (total_interactions >= 0),
  accounts_engaged bigint check (accounts_engaged >= 0),
  primary key (account_id, metric_date)
);

create table public.instagram_media (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  instagram_media_id text not null,
  caption text,
  media_type text not null,
  thumbnail_url text,
  permalink text,
  published_at timestamptz not null,
  reach bigint check (reach >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  saved bigint check (saved >= 0),
  shares bigint check (shares >= 0),
  total_interactions bigint check (total_interactions >= 0),
  unique (account_id, instagram_media_id)
);

create table public.instagram_audience_demographics (
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  snapshot_date date not null,
  dimension text not null,
  label text not null,
  value bigint not null check (value >= 0),
  primary key (account_id, snapshot_date, dimension, label)
);

create index instagram_accounts_user_id_idx on public.instagram_accounts(user_id);
create index instagram_metrics_account_date_idx on public.instagram_account_metrics(account_id, metric_date desc);
create index instagram_media_account_published_idx on public.instagram_media(account_id, published_at desc);
create index instagram_audience_account_date_idx on public.instagram_audience_demographics(account_id, snapshot_date desc);

create or replace function private.limit_instagram_accounts()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if new.status <> 'disconnected' and (
    select count(*) from public.instagram_accounts
    where user_id = new.user_id
      and status <> 'disconnected'
      and id <> new.id
  ) >= 5 then
    raise exception 'Maximum 5 Instagram accounts per user';
  end if;
  return new;
end;
$$;

create trigger limit_instagram_accounts
before insert or update of user_id, status on public.instagram_accounts
for each row execute function private.limit_instagram_accounts();

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger instagram_accounts_set_updated_at
before update on public.instagram_accounts
for each row execute function private.set_updated_at();

alter table public.instagram_accounts enable row level security;
alter table public.instagram_account_metrics enable row level security;
alter table public.instagram_media enable row level security;
alter table public.instagram_audience_demographics enable row level security;

revoke all on table public.instagram_accounts from anon, authenticated;
revoke all on table public.instagram_account_metrics from anon, authenticated;
revoke all on table public.instagram_media from anon, authenticated;
revoke all on table public.instagram_audience_demographics from anon, authenticated;
grant select on table public.instagram_accounts to authenticated;
grant select on table public.instagram_account_metrics to authenticated;
grant select on table public.instagram_media to authenticated;
grant select on table public.instagram_audience_demographics to authenticated;

create policy "Users can view their Instagram accounts"
on public.instagram_accounts for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their Instagram metrics"
on public.instagram_account_metrics for select to authenticated
using (exists (
  select 1 from public.instagram_accounts
  where instagram_accounts.id = instagram_account_metrics.account_id
    and instagram_accounts.user_id = (select auth.uid())
));

create policy "Users can view their Instagram media"
on public.instagram_media for select to authenticated
using (exists (
  select 1 from public.instagram_accounts
  where instagram_accounts.id = instagram_media.account_id
    and instagram_accounts.user_id = (select auth.uid())
));

create policy "Users can view their audience demographics"
on public.instagram_audience_demographics for select to authenticated
using (exists (
  select 1 from public.instagram_accounts
  where instagram_accounts.id = instagram_audience_demographics.account_id
    and instagram_accounts.user_id = (select auth.uid())
));
