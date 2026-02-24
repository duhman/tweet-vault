-- Migration: Create indexes for all tables
-- Description: HNSW indexes for vector search + standard B-tree indexes for filtering
-- Rollback: See individual DROP INDEX statements below
-- ============================================================================
-- STAR_VAULT INDEXES
-- ============================================================================
SET
  search_path TO star_vault,
  extensions,
  public;
-- HNSW index for vector similarity search
-- m=16: number of bi-directional links (higher = better recall, more memory)
-- ef_construction=64: size of dynamic candidate list during build (higher = better quality)
CREATE INDEX repos_embedding_hnsw_idx ON repos USING hnsw (embedding vector_cosine_ops)
WITH
  (m = 16, ef_construction = 64);
-- Rollback: DROP INDEX IF EXISTS star_vault.repos_embedding_hnsw_idx;
-- Standard indexes for filtering
CREATE INDEX repos_language_idx ON repos (language);
CREATE INDEX repos_starred_at_idx ON repos (starred_at DESC);
CREATE INDEX repos_topics_idx ON repos USING GIN (topics);
CREATE INDEX repos_owner_idx ON repos (owner);
CREATE INDEX repos_fetched_at_idx ON repos (fetched_at DESC);
-- ============================================================================
-- TWEET_VAULT INDEXES
-- ============================================================================
SET
  search_path TO tweet_vault,
  extensions,
  public;
-- HNSW indexes for vector search
CREATE INDEX tweets_embedding_hnsw_idx ON tweets USING hnsw (embedding vector_cosine_ops)
WITH
  (m = 16, ef_construction = 64);
CREATE INDEX links_embedding_hnsw_idx ON links USING hnsw (embedding vector_cosine_ops)
WITH
  (m = 16, ef_construction = 64);
CREATE INDEX likes_embedding_hnsw_idx ON likes USING hnsw (embedding vector_cosine_ops)
WITH
  (m = 16, ef_construction = 64);
-- Standard indexes for filtering
CREATE INDEX tweets_author_idx ON tweets (author_username);
CREATE INDEX tweets_created_at_idx ON tweets (created_at DESC);
CREATE INDEX links_domain_idx ON links (domain);
CREATE INDEX links_tweet_id_idx ON links (tweet_id);
CREATE INDEX likes_liked_at_idx ON likes (liked_at DESC);
-- ============================================================================
-- SELF_HOST INDEXES
-- ============================================================================
SET
  search_path TO self_host,
  extensions,
  public;
-- HNSW indexes for vector search
CREATE INDEX knowledge_embedding_hnsw_idx ON local_agent_knowledge USING hnsw (embedding vector_cosine_ops)
WITH
  (m = 16, ef_construction = 64);
CREATE INDEX memory_embedding_hnsw_idx ON persistent_memory USING hnsw (embedding vector_cosine_ops)
WITH
  (m = 16, ef_construction = 64);
-- Standard indexes for filtering
CREATE INDEX knowledge_category_idx ON local_agent_knowledge (category);
CREATE INDEX knowledge_source_idx ON local_agent_knowledge (source);
CREATE INDEX memory_category_idx ON persistent_memory (category);
CREATE INDEX memory_tags_idx ON persistent_memory USING GIN (tags);
CREATE INDEX memory_importance_idx ON persistent_memory (importance DESC);
