-- Migration: Setup pg_cron schedules for automated syncs
-- Uses anon JWT Authorization header for Edge Functions
-- Star Vault daily sync at 7 AM UTC
SELECT
  cron.schedule (
    'star-vault-daily-sync',
    '0 7 * * *',
    $$
  SELECT net.http_post(
    url := 'https://brawengrbiuvnmsyqhoe.supabase.co/functions/v1/star-vault-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyYXdlbmdyYml1dm5tc3lxaG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NDgxOTMsImV4cCI6MjA4NDQyNDE5M30.x-WVsIRCT20-AbcntWScm77CAjyGz3_iriaeY_0lTzY", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyYXdlbmdyYml1dm5tc3lxaG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NDgxOTMsImV4cCI6MjA4NDQyNDE5M30.x-WVsIRCT20-AbcntWScm77CAjyGz3_iriaeY_0lTzY"}'::jsonb,
    body := '{"fetchRepos": true, "contentLimit": 20, "embeddingLimit": 20, "syncType": "cron"}'::jsonb
  );
  $$
  );
-- Tweet Vault daily sync at 6 AM UTC
SELECT
  cron.schedule (
    'tweet-vault-daily-sync',
    '0 6 * * *',
    $$
  SELECT net.http_post(
    url := 'https://brawengrbiuvnmsyqhoe.supabase.co/functions/v1/tweet-vault-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyYXdlbmdyYml1dm5tc3lxaG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NDgxOTMsImV4cCI6MjA4NDQyNDE5M30.x-WVsIRCT20-AbcntWScm77CAjyGz3_iriaeY_0lTzY", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyYXdlbmdyYml1dm5tc3lxaG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NDgxOTMsImV4cCI6MjA4NDQyNDE5M30.x-WVsIRCT20-AbcntWScm77CAjyGz3_iriaeY_0lTzY"}'::jsonb,
    body := '{"count": 100, "embeddingLimit": 20, "syncType": "cron"}'::jsonb
  );
  $$
  );
-- Verify: SELECT * FROM cron.job;
-- Unschedule: SELECT cron.unschedule('star-vault-daily-sync');;
