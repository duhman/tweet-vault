-- Private apply template for Tweet Vault cron schedules.
-- Replace placeholders at deploy time. Do not commit rendered JWTs or secrets.

begin;

select cron.schedule(
  'tweet-vault-daily-sync',
  '0 6 * * *',
  $$
  select net.http_post(
    url := '{{SUPABASE_URL}}/functions/v1/tweet-vault-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer {{FUNCTION_INVOKE_JWT}}',
      'apikey', '{{FUNCTION_INVOKE_JWT}}'
    ),
    body := '{"count": 100, "embeddingLimit": 20, "syncType": "cron"}'::jsonb
  );
  $$
);

select cron.schedule(
  'tweet-vault-process-tweets-backlog',
  '30 6 * * *',
  $$
  select net.http_post(
    url := '{{SUPABASE_URL}}/functions/v1/process-tweets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer {{FUNCTION_INVOKE_JWT}}',
      'apikey', '{{FUNCTION_INVOKE_JWT}}'
    ),
    body := '{}'::jsonb
  );
  $$
);

commit;
