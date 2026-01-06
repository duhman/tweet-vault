-- Daily sync cron job for Tweet Vault
-- Runs at 6 AM UTC every day to process pending embeddings and link metadata
-- First, ensure extensions are available
CREATE EXTENSION IF NOT EXISTS pg_cron
WITH
  SCHEMA pg_catalog;

CREATE EXTENSION IF NOT EXISTS pg_net
WITH
  SCHEMA extensions;

-- Store the service role key in vault for secure access
-- Note: You need to run this separately with your actual key:
-- SELECT vault.create_secret('tweet_vault_service_key', 'your-service-role-key');
-- Create a function to call the Edge Function
CREATE OR REPLACE FUNCTION public.trigger_tweet_vault_sync () RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  service_key text;
  response_id bigint;
BEGIN
  -- Get the service key from vault (or use env var)
  -- For self-hosted, we can use the service_role key directly
  service_key := current_setting('app.settings.service_role_key', true);

  -- If not set via app settings, try vault
  IF service_key IS NULL THEN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'tweet_vault_service_key'
    LIMIT 1;
  END IF;

  -- If still null, use a fallback (for development)
  IF service_key IS NULL THEN
    RAISE NOTICE 'No service key found, skipping sync';
    RETURN;
  END IF;

  -- Call the Edge Function via pg_net
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/process-tweets',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) INTO response_id;

  RAISE NOTICE 'Tweet vault sync triggered, request_id: %', response_id;
END;
$$;

-- Schedule the cron job to run daily at 6 AM UTC
-- Using cron.schedule which is the standard pg_cron function
SELECT
  cron.schedule (
    'tweet-vault-daily-sync', -- job name
    '0 6 * * *', -- cron expression: 6 AM UTC daily
    $$SELECT public.trigger_tweet_vault_sync()$$
  );

-- Grant execute permission
GRANT
EXECUTE ON FUNCTION public.trigger_tweet_vault_sync () TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION public.trigger_tweet_vault_sync () IS 'Triggers the Tweet Vault Edge Function to process pending embeddings and link metadata. Called daily at 6 AM UTC via pg_cron.';
