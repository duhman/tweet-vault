-- Migration: Cron schedule placeholder
-- Cron schedules are project-specific because they include Supabase project
-- URLs and function invocation credentials. Do not commit live JWTs or
-- project-specific headers in migrations. Apply schedules from
-- supabase/templates/tweet-vault-cron.sql using private deployment secrets.

DO $$
BEGIN
  RAISE NOTICE 'Cron schedules are intentionally applied from private templates, not tracked migrations.';
END
$$;
