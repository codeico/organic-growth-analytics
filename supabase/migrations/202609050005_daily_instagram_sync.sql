create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'instagram-daily-sync';

select cron.schedule(
  'instagram-daily-sync',
  '17 1 * * *',
  $$
  select net.http_post(
    url := 'https://fqwpwisjsvolpoqigbms.supabase.co/functions/v1/instagram-sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'instagram_sync_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
