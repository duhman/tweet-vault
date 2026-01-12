-- Create twitter_likes table for storing liked tweets
-- Run this once in your self-hosted Supabase instance

CREATE TABLE IF NOT EXISTS twitter_likes (
  id BIGSERIAL PRIMARY KEY,
  tweet_id TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT,
  liked_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Embedding for semantic search
  embedding vector(1536),
  
  -- Metadata
  metadata JSONB,
  source TEXT DEFAULT 'bird-cli',
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexing
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_twitter_likes_tweet_id ON twitter_likes(tweet_id);
CREATE INDEX idx_twitter_likes_author_id ON twitter_likes(author_id);
CREATE INDEX idx_twitter_likes_liked_at ON twitter_likes(liked_at DESC);
CREATE INDEX idx_twitter_likes_synced_at ON twitter_likes(synced_at DESC);

-- Vector index for semantic search
CREATE INDEX idx_twitter_likes_embedding ON twitter_likes 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON twitter_likes TO anon, authenticated;

-- Add comment
COMMENT ON TABLE twitter_likes IS 'Twitter likes synced via bird-cli (v0.7.0+)';
COMMENT ON COLUMN twitter_likes.embedding IS 'Semantic search vector (1536-dim, OpenAI text-embedding-3-small)';
