-- Tweet Vault: remove tracked legacy cron schedule names.
-- Project-specific schedules are applied from private templates, not committed
-- migrations, because net.http_post headers contain invocation credentials.

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

do $$
begin
  raise notice 'Apply tweet-vault cron schedules from supabase/templates/tweet-vault-cron.sql with private credentials.';
end
$$;

commit;
