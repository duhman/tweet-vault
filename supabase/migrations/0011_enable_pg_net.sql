-- Migration: Enable pg_net extension for HTTP requests
-- Description: Required for net.http_post used by cron schedules
-- Rollback: DROP EXTENSION IF EXISTS pg_net;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_net extension not available (expected on local dev)';
END
$$;
-- Verify net.http_post is available (non-fatal on local dev)
DO $$
BEGIN
  PERFORM 'net.http_post'::regproc;
  RAISE NOTICE 'pg_net extension enabled successfully';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_net extension not available';
END
$$;
