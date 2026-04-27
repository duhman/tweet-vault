-- Tweet Vault: align pg_cron with the actual deployed Edge Function.
-- This is intentionally forward-only: 0009 references a legacy endpoint name,
-- and this migration replaces that schedule without rewriting migration history.
-- The URL/JWT remain project-specific because pg_cron schedules are persisted
-- in the live Supabase project rather than templated at deploy time.

begin;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tweet-vault-daily-sync') then
    perform cron.unschedule('tweet-vault-daily-sync');
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end
$$;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'tweet-vault-process-tweets-daily'
  ) then
    perform cron.unschedule('tweet-vault-process-tweets-daily');
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end
$$;

select cron.schedule(
  'tweet-vault-process-tweets-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://brawengrbiuvnmsyqhoe.supabase.co/functions/v1/process-tweets',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyYXdlbmdyYml1dm5tc3lxaG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NDgxOTMsImV4cCI6MjA4NDQyNDE5M30.x-WVsIRCT20-AbcntWScm77CAjyGz3_iriaeY_0lTzY", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyYXdlbmdyYml1dm5tc3lxaG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NDgxOTMsImV4cCI6MjA4NDQyNDE5M30.x-WVsIRCT20-AbcntWScm77CAjyGz3_iriaeY_0lTzY"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

commit;
