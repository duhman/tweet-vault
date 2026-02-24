-- Migration: Enable required extensions
-- Description: Enables pgvector for embeddings and pg_cron for scheduled jobs
-- Rollback: DROP EXTENSION IF EXISTS vector; DROP EXTENSION IF EXISTS pg_cron;
-- Enable pgvector for vector similarity search
-- Using extensions schema as recommended by Supabase
CREATE EXTENSION IF NOT EXISTS vector
WITH
  SCHEMA extensions;
-- Enable pg_cron for scheduled jobs
-- Note: pg_cron is only available on Supabase Cloud (not local dev)
-- This will silently fail on local but work when pushed to cloud
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron extension not available (expected on local dev)';
END
$$;
-- Verify vector extension is available
DO $$
BEGIN
  PERFORM 'extensions.vector'::regtype;
  RAISE NOTICE 'pgvector extension enabled successfully';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'pgvector extension failed to enable';
END
$$;
