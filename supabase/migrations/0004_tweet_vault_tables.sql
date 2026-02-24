-- Migration: Create tweet_vault tables
-- Description: Tables for Twitter bookmarks with embeddings
-- Rollback: DROP TABLE IF EXISTS tweet_vault.sync_state; DROP TABLE IF EXISTS tweet_vault.likes; DROP TABLE IF EXISTS tweet_vault.links; DROP TABLE IF EXISTS tweet_vault.tweets;
SET
  search_path TO tweet_vault,
  extensions,
  public;
-- Main tweets table
CREATE TABLE tweets (
  id BIGSERIAL PRIMARY KEY,
  tweet_id TEXT UNIQUE NOT NULL,
  author_username TEXT NOT NULL,
  author_name TEXT,
  author_profile_image TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  media_urls TEXT[],
  metrics JSONB,
  raw_data JSONB,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  links_extracted_at TIMESTAMPTZ,
  embedding vector (1536)
);
-- Links extracted from tweets
CREATE TABLE links (
  id BIGSERIAL PRIMARY KEY,
  tweet_id TEXT REFERENCES tweets (tweet_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  expanded_url TEXT,
  display_url TEXT,
  title TEXT,
  description TEXT,
  og_image TEXT,
  domain TEXT,
  content_type TEXT,
  fetched_at TIMESTAMPTZ,
  fetch_error TEXT,
  embedding vector (1536),
  search_text TEXT
);
-- Twitter likes (separate from bookmarks)
CREATE TABLE likes (
  id BIGSERIAL PRIMARY KEY,
  tweet_id TEXT UNIQUE NOT NULL,
  content TEXT,
  author_id TEXT,
  author_name TEXT,
  liked_at TIMESTAMPTZ,
  embedding vector (1536),
  metadata JSONB,
  source TEXT DEFAULT 'bird-cli',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Sync state tracking
CREATE TABLE sync_state (
  id BIGSERIAL PRIMARY KEY,
  last_sync_at TIMESTAMPTZ DEFAULT NOW(),
  tweets_added INTEGER DEFAULT 0,
  links_processed INTEGER DEFAULT 0,
  embeddings_generated INTEGER DEFAULT 0,
  sync_type TEXT DEFAULT 'manual',
  error_message TEXT,
  metadata JSONB
);
-- Add comments for documentation
COMMENT ON TABLE tweets IS 'Twitter bookmarked tweets with embeddings';
COMMENT ON COLUMN tweets.embedding IS 'OpenAI text-embedding-3-small (1536 dimensions)';
COMMENT ON TABLE links IS 'Links extracted from bookmarked tweets';
COMMENT ON TABLE likes IS 'Twitter likes (via Bird CLI)';
COMMENT ON TABLE sync_state IS 'Tracks Twitter sync operations';
