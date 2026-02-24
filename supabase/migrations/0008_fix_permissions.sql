-- Migration: Fix table permissions
-- Description: Grant explicit permissions on existing tables to all roles
-- Star Vault
GRANT ALL ON ALL TABLES IN SCHEMA star_vault TO postgres,
service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA star_vault TO postgres,
service_role;
GRANT
SELECT
,
  INSERT,
UPDATE,
DELETE ON ALL TABLES IN SCHEMA star_vault TO anon,
authenticated;
GRANT USAGE,
SELECT
  ON ALL SEQUENCES IN SCHEMA star_vault TO anon,
  authenticated;
-- Tweet Vault
GRANT ALL ON ALL TABLES IN SCHEMA tweet_vault TO postgres,
service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA tweet_vault TO postgres,
service_role;
GRANT
SELECT
,
  INSERT,
UPDATE,
DELETE ON ALL TABLES IN SCHEMA tweet_vault TO anon,
authenticated;
GRANT USAGE,
SELECT
  ON ALL SEQUENCES IN SCHEMA tweet_vault TO anon,
  authenticated;
-- Self Host
GRANT ALL ON ALL TABLES IN SCHEMA self_host TO postgres,
service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA self_host TO postgres,
service_role;
GRANT
SELECT
,
  INSERT,
UPDATE,
DELETE ON ALL TABLES IN SCHEMA self_host TO anon,
authenticated;
GRANT USAGE,
SELECT
  ON ALL SEQUENCES IN SCHEMA self_host TO anon,
  authenticated;
