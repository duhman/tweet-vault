-- Migration: Create star_vault tables
-- Description: Tables for GitHub starred repositories with embeddings
-- Rollback: DROP TABLE IF EXISTS star_vault.sync_state; DROP TABLE IF EXISTS star_vault.repos;
SET
  search_path TO star_vault,
  extensions,
  public;
-- Main repos table
CREATE TABLE repos (
  id BIGSERIAL PRIMARY KEY,
  github_id BIGINT UNIQUE NOT NULL,
  full_name TEXT UNIQUE NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  topics TEXT[],
  language TEXT,
  stargazers_count INTEGER,
  forks_count INTEGER,
  license TEXT,
  html_url TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  starred_at TIMESTAMPTZ,
  readme_content TEXT,
  package_json JSONB,
  raw_data JSONB,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  content_fetched_at TIMESTAMPTZ,
  embedding vector (1536),
  -- Ensure full_name matches owner/name format
  CONSTRAINT full_name_format CHECK (full_name ~ '^[^/]+/[^/]+$')
);
-- Sync state tracking
CREATE TABLE sync_state (
  id BIGSERIAL PRIMARY KEY,
  last_sync_at TIMESTAMPTZ DEFAULT NOW(),
  repos_added INTEGER DEFAULT 0,
  repos_updated INTEGER DEFAULT 0,
  content_fetched INTEGER DEFAULT 0,
  embeddings_generated INTEGER DEFAULT 0,
  sync_type TEXT DEFAULT 'manual',
  metadata JSONB
);
-- Add comments for documentation
COMMENT ON TABLE repos IS 'GitHub starred repositories with metadata and embeddings';
COMMENT ON COLUMN repos.embedding IS 'OpenAI text-embedding-3-small (1536 dimensions)';
COMMENT ON COLUMN repos.github_id IS 'Unique GitHub repository ID';
COMMENT ON COLUMN repos.starred_at IS 'When the user starred this repo';
COMMENT ON TABLE sync_state IS 'Tracks GitHub sync operations';
