-- Migration: Create self_host tables
-- Description: Tables for personal tools, agent knowledge, and persistent memory
-- Rollback: DROP TABLE IF EXISTS self_host.persistent_memory; DROP TABLE IF EXISTS self_host.local_agent_knowledge;
SET
  search_path TO self_host,
  extensions,
  public;
-- Agent knowledge base (RAG for Claude Code)
CREATE TABLE local_agent_knowledge (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector (1536),
  source TEXT,
  category TEXT,
  subcategory TEXT,
  file_path TEXT,
  chunk_index INTEGER,
  importance FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Persistent memory for cross-session learning
CREATE TABLE persistent_memory (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector (1536),
  category TEXT,
  tags TEXT[],
  importance FLOAT DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Add comments for documentation
COMMENT ON TABLE local_agent_knowledge IS 'RAG knowledge base for Claude Code assistance';
COMMENT ON COLUMN local_agent_knowledge.embedding IS 'OpenAI text-embedding-3-small (1536 dimensions)';
COMMENT ON COLUMN local_agent_knowledge.chunk_index IS 'Position in chunked document';
COMMENT ON TABLE persistent_memory IS 'Cross-session semantic memory';
COMMENT ON COLUMN persistent_memory.importance IS 'Memory importance score (0-1)';
COMMENT ON COLUMN persistent_memory.access_count IS 'Number of times this memory was accessed';
