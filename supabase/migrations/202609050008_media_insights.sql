-- Per-media metrics the Graph API exposes but we did not store yet.
-- Watch time / skip rate are REELS-only; profile_visits / follows are FEED-only.
alter table public.instagram_media
  add column if not exists reposts bigint check (reposts >= 0),
  add column if not exists profile_visits bigint check (profile_visits >= 0),
  add column if not exists follows bigint check (follows >= 0),
  add column if not exists avg_watch_time_ms bigint check (avg_watch_time_ms >= 0),
  add column if not exists total_watch_time_ms bigint check (total_watch_time_ms >= 0),
  add column if not exists skip_rate numeric check (skip_rate >= 0),
  add column if not exists insights_synced_at timestamptz;
