-- Migration: Create search functions
-- Description: Vector similarity search functions for each schema
-- Rollback: DROP FUNCTION IF EXISTS star_vault.search_repos; DROP FUNCTION IF EXISTS tweet_vault.search_tweets; DROP FUNCTION IF EXISTS tweet_vault.search_links; DROP FUNCTION IF EXISTS self_host.search_knowledge; DROP FUNCTION IF EXISTS self_host.search_memory;
-- ============================================================================
-- STAR_VAULT SEARCH FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION star_vault.search_repos (
  query_embedding vector (1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
) RETURNS TABLE (
  id BIGINT,
  full_name TEXT,
  description TEXT,
  topics TEXT[],
  language TEXT,
  html_url TEXT,
  starred_at TIMESTAMPTZ,
  similarity FLOAT
) LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = star_vault,
  extensions,
  public AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.full_name,
    r.description,
    r.topics,
    r.language,
    r.html_url,
    r.starred_at,
    1 - (r.embedding <=> query_embedding) AS similarity
  FROM star_vault.repos r
  WHERE r.embedding IS NOT NULL
    AND 1 - (r.embedding <=> query_embedding) > match_threshold
  ORDER BY r.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
COMMENT ON FUNCTION star_vault.search_repos IS 'Semantic search over starred GitHub repositories';
-- ============================================================================
-- TWEET_VAULT SEARCH FUNCTIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION tweet_vault.search_tweets (
  query_embedding vector (1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
) RETURNS TABLE (
  id BIGINT,
  tweet_id TEXT,
  author_username TEXT,
  content TEXT,
  created_at TIMESTAMPTZ,
  similarity FLOAT
) LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = tweet_vault,
  extensions,
  public AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.tweet_id,
    t.author_username,
    t.content,
    t.created_at,
    1 - (t.embedding <=> query_embedding) AS similarity
  FROM tweet_vault.tweets t
  WHERE t.embedding IS NOT NULL
    AND 1 - (t.embedding <=> query_embedding) > match_threshold
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
CREATE OR REPLACE FUNCTION tweet_vault.search_links (
  query_embedding vector (1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
) RETURNS TABLE (
  id BIGINT,
  tweet_id TEXT,
  url TEXT,
  title TEXT,
  description TEXT,
  domain TEXT,
  similarity FLOAT
) LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = tweet_vault,
  extensions,
  public AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.tweet_id,
    l.url,
    l.title,
    l.description,
    l.domain,
    1 - (l.embedding <=> query_embedding) AS similarity
  FROM tweet_vault.links l
  WHERE l.embedding IS NOT NULL
    AND 1 - (l.embedding <=> query_embedding) > match_threshold
  ORDER BY l.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
COMMENT ON FUNCTION tweet_vault.search_tweets IS 'Semantic search over bookmarked tweets';
COMMENT ON FUNCTION tweet_vault.search_links IS 'Semantic search over links from tweets';
-- ============================================================================
-- SELF_HOST SEARCH FUNCTIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION self_host.search_knowledge (
  query_embedding vector (1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10,
  filter_category TEXT DEFAULT NULL
) RETURNS TABLE (
  id BIGINT,
  content TEXT,
  source TEXT,
  category TEXT,
  file_path TEXT,
  importance FLOAT,
  similarity FLOAT
) LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = self_host,
  extensions,
  public AS $$
BEGIN
  RETURN QUERY
  SELECT
    k.id,
    k.content,
    k.source,
    k.category,
    k.file_path,
    k.importance,
    1 - (k.embedding <=> query_embedding) AS similarity
  FROM self_host.local_agent_knowledge k
  WHERE k.embedding IS NOT NULL
    AND 1 - (k.embedding <=> query_embedding) > match_threshold
    AND (filter_category IS NULL OR k.category = filter_category)
  ORDER BY k.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
CREATE OR REPLACE FUNCTION self_host.search_memory (
  query_embedding vector (1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10,
  min_importance FLOAT DEFAULT 0
) RETURNS TABLE (
  id BIGINT,
  content TEXT,
  category TEXT,
  tags TEXT[],
  importance FLOAT,
  access_count INTEGER,
  similarity FLOAT
) LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = self_host,
  extensions,
  public AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.category,
    m.tags,
    m.importance,
    m.access_count,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM self_host.persistent_memory m
  WHERE m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
    AND m.importance >= min_importance
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
-- Function to increment access count when memory is retrieved
CREATE OR REPLACE FUNCTION self_host.access_memory (memory_id BIGINT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = self_host AS $$
BEGIN
  UPDATE persistent_memory
  SET
    access_count = access_count + 1,
    last_accessed_at = NOW()
  WHERE id = memory_id;
END;
$$;
COMMENT ON FUNCTION self_host.search_knowledge IS 'Semantic search over agent knowledge base';
COMMENT ON FUNCTION self_host.search_memory IS 'Semantic search over persistent memory';
COMMENT ON FUNCTION self_host.access_memory IS 'Record memory access for learning optimization';
