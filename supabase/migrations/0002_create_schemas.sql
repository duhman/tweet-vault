-- Migration: Create project schemas
-- Description: Creates isolated schemas for star_vault, tweet_vault, and self_host
-- Rollback: DROP SCHEMA IF EXISTS star_vault CASCADE; DROP SCHEMA IF EXISTS tweet_vault CASCADE; DROP SCHEMA IF EXISTS self_host CASCADE;
-- Create schemas for each project
CREATE SCHEMA IF NOT EXISTS star_vault;
CREATE SCHEMA IF NOT EXISTS tweet_vault;
CREATE SCHEMA IF NOT EXISTS self_host;
-- Grant usage conservatively. tweet_vault is a personal service-role
-- automation surface, not a public PostgREST API.
GRANT USAGE ON SCHEMA star_vault TO anon,
authenticated,
service_role;
GRANT USAGE ON SCHEMA tweet_vault TO service_role;
GRANT USAGE ON SCHEMA self_host TO anon,
authenticated,
service_role;
-- Grant default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA star_vault
GRANT
SELECT
,
  INSERT,
UPDATE,
DELETE ON TABLES TO anon,
authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA tweet_vault
GRANT
SELECT
,
  INSERT,
UPDATE,
DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA self_host
GRANT
SELECT
,
  INSERT,
UPDATE,
DELETE ON TABLES TO anon,
authenticated;
-- Grant sequence usage for auto-increment columns
ALTER DEFAULT PRIVILEGES IN SCHEMA star_vault
GRANT USAGE,
SELECT
  ON SEQUENCES TO anon,
  authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA tweet_vault
GRANT USAGE,
SELECT
  ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA self_host
GRANT USAGE,
SELECT
  ON SEQUENCES TO anon,
  authenticated;
-- Grant execute on functions
ALTER DEFAULT PRIVILEGES IN SCHEMA star_vault
GRANT
EXECUTE ON FUNCTIONS TO anon,
authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA tweet_vault
GRANT
EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA self_host
GRANT
EXECUTE ON FUNCTIONS TO anon,
authenticated;
COMMENT ON SCHEMA star_vault IS 'GitHub starred repositories intelligence system';
COMMENT ON SCHEMA tweet_vault IS 'Twitter bookmarks intelligence system';
COMMENT ON SCHEMA self_host IS 'Personal tools and agent knowledge';
