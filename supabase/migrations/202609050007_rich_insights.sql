-- Richer daily account metrics (all from the official Instagram Insights API).
alter table public.instagram_account_metrics
  add column if not exists views bigint check (views >= 0),
  add column if not exists follows bigint check (follows >= 0),
  add column if not exists unfollows bigint check (unfollows >= 0),
  add column if not exists profile_links_taps bigint check (profile_links_taps >= 0),
  add column if not exists likes bigint check (likes >= 0),
  add column if not exists comments bigint check (comments >= 0),
  add column if not exists saves bigint check (saves >= 0),
  add column if not exists shares bigint check (shares >= 0),
  add column if not exists replies bigint check (replies >= 0);

-- Daily metric split by surface (FEED / REELS / STORY / AD).
create table if not exists public.instagram_metric_breakdowns (
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  metric_date date not null,
  metric text not null,
  product_type text not null,
  value bigint not null check (value >= 0),
  primary key (account_id, metric_date, metric, product_type)
);
create index if not exists instagram_metric_breakdowns_account_date_idx
  on public.instagram_metric_breakdowns(account_id, metric_date desc);

alter table public.instagram_metric_breakdowns enable row level security;
revoke all on table public.instagram_metric_breakdowns from anon, authenticated;
grant select on table public.instagram_metric_breakdowns to authenticated;
create policy "Users can view their metric breakdowns"
on public.instagram_metric_breakdowns for select to authenticated
using (exists (
  select 1 from public.instagram_accounts
  where instagram_accounts.id = instagram_metric_breakdowns.account_id
    and instagram_accounts.user_id = (select auth.uid())
));

-- Media: surface + views so content can be compared by type.
alter table public.instagram_media
  add column if not exists media_product_type text,
  add column if not exists views bigint check (views >= 0);
