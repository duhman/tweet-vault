-- Tweet Vault: Initial Schema
-- Stores Twitter/X bookmarked tweets with vector embeddings for semantic search
-- Enable required extensions
create extension if not exists vector
with
  schema extensions;

-- Tweets table: Core bookmark storage
create table if not exists public.tweets (
  id bigserial primary key,
  tweet_id text unique not null,
  author_username text not null,
  author_name text,
  author_profile_image text,
  content text not null,
  created_at timestamptz,
  media_urls text[] default '{}',
  metrics jsonb default '{}', -- likes, retweets, replies, quotes, bookmarks
  raw_data jsonb, -- full API/GraphQL response for future use
  fetched_at timestamptz default now(),
  processed_at timestamptz,
  embedding vector (1536), -- OpenAI text-embedding-3-small
  constraint tweets_content_check check (char_length(content) > 0)
);

-- Extracted links from tweets
create table if not exists public.links (
  id bigserial primary key,
  tweet_id bigint references public.tweets (id) on delete cascade,
  url text not null,
  expanded_url text, -- t.co → actual URL
  display_url text, -- shortened display version
  title text,
  description text,
  og_image text, -- Open Graph image
  domain text,
  content_type text, -- article, video, image, etc.
  fetched_at timestamptz,
  fetch_error text,
  embedding vector (1536), -- embedding of title + description
  constraint links_url_check check (char_length(url) > 0)
);

-- Sync state tracking
create table if not exists public.sync_state (
  id serial primary key,
  last_sync_at timestamptz default now(),
  tweets_added int default 0,
  links_processed int default 0,
  embeddings_generated int default 0,
  sync_type text default 'manual', -- manual, scheduled, incremental
  error_message text,
  metadata jsonb default '{}'
);

-- Create HNSW index for fast semantic search on tweets
create index if not exists tweets_embedding_hnsw_idx on public.tweets using hnsw (embedding vector_cosine_ops)
with
  (m = 16, ef_construction = 64);

-- HNSW index for link embeddings
create index if not exists links_embedding_hnsw_idx on public.links using hnsw (embedding vector_cosine_ops)
with
  (m = 16, ef_construction = 64);

-- Performance indexes
create index if not exists tweets_created_at_idx on public.tweets (created_at desc);

create index if not exists tweets_author_idx on public.tweets (author_username);

create index if not exists tweets_fetched_at_idx on public.tweets (fetched_at desc);

create index if not exists tweets_tweet_id_idx on public.tweets (tweet_id);

create index if not exists links_domain_idx on public.links (domain);

create index if not exists links_tweet_id_idx on public.links (tweet_id);

-- Full text search on tweet content
create index if not exists tweets_content_fts_idx on public.tweets using gin (to_tsvector('english', content));

-- Function: Semantic search for tweets
create or replace function public.search_tweets (
  query_embedding vector (1536),
  match_threshold float default 0.7,
  match_count int default 10
) returns table (
  id bigint,
  tweet_id text,
  author_username text,
  author_name text,
  content text,
  created_at timestamptz,
  media_urls text[],
  metrics jsonb,
  similarity float
) language plpgsql as $$
begin
    return query
    select
        t.id,
        t.tweet_id,
        t.author_username,
        t.author_name,
        t.content,
        t.created_at,
        t.media_urls,
        t.metrics,
        1 - (t.embedding <=> query_embedding) as similarity
    from public.tweets t
    where t.embedding is not null
      and 1 - (t.embedding <=> query_embedding) > match_threshold
    order by t.embedding <=> query_embedding
    limit match_count;
end;
$$;

-- Function: Semantic search for links
create or replace function public.search_links (
  query_embedding vector (1536),
  match_threshold float default 0.7,
  match_count int default 10
) returns table (
  id bigint,
  tweet_id bigint,
  url text,
  expanded_url text,
  title text,
  description text,
  domain text,
  similarity float
) language plpgsql as $$
begin
    return query
    select
        l.id,
        l.tweet_id,
        l.url,
        l.expanded_url,
        l.title,
        l.description,
        l.domain,
        1 - (l.embedding <=> query_embedding) as similarity
    from public.links l
    where l.embedding is not null
      and 1 - (l.embedding <=> query_embedding) > match_threshold
    order by l.embedding <=> query_embedding
    limit match_count;
end;
$$;

-- Function: Get tweet with all its links
create or replace function public.get_tweet_with_links (p_tweet_id text) returns jsonb language plpgsql as $$
declare
    result jsonb;
begin
    select jsonb_build_object(
        'tweet', row_to_json(t.*),
        'links', coalesce(
            (select jsonb_agg(row_to_json(l.*))
             from public.links l
             where l.tweet_id = t.id),
            '[]'::jsonb
        )
    ) into result
    from public.tweets t
    where t.tweet_id = p_tweet_id;

    return result;
end;
$$;

-- Function: Get stats
create or replace function public.get_tweet_vault_stats () returns jsonb language plpgsql as $$
declare
    result jsonb;
begin
    select jsonb_build_object(
        'total_tweets', (select count(*) from public.tweets),
        'total_links', (select count(*) from public.links),
        'tweets_with_embeddings', (select count(*) from public.tweets where embedding is not null),
        'links_with_embeddings', (select count(*) from public.links where embedding is not null),
        'top_authors', (
            select jsonb_agg(row_to_json(a))
            from (
                select author_username, count(*) as tweet_count
                from public.tweets
                group by author_username
                order by count(*) desc
                limit 10
            ) a
        ),
        'top_domains', (
            select jsonb_agg(row_to_json(d))
            from (
                select domain, count(*) as link_count
                from public.links
                where domain is not null
                group by domain
                order by count(*) desc
                limit 10
            ) d
        ),
        'last_sync', (
            select row_to_json(s)
            from public.sync_state s
            order by last_sync_at desc
            limit 1
        )
    ) into result;

    return result;
end;
$$;

-- Grant permissions for PostgREST API access
grant usage on schema public to anon,
authenticated;

grant
select
,
  insert,
update on public.tweets to anon,
authenticated;

grant
select
,
  insert,
update on public.links to anon,
authenticated;

grant
select
,
  insert on public.sync_state to anon,
  authenticated;

grant usage,
select
  on all sequences in schema public to anon,
  authenticated;

grant
execute on function public.search_tweets to anon,
authenticated;

grant
execute on function public.search_links to anon,
authenticated;

grant
execute on function public.get_tweet_with_links to anon,
authenticated;

grant
execute on function public.get_tweet_vault_stats to anon,
authenticated;

-- Comment for documentation
comment on table public.tweets is 'Twitter/X bookmarked tweets with vector embeddings for semantic search';

comment on table public.links is 'Extracted and enriched links from bookmarked tweets';

comment on table public.sync_state is 'Tracking state for bookmark sync operations';

comment on function public.search_tweets is 'Semantic search over tweet embeddings using cosine similarity';

comment on function public.search_links is 'Semantic search over link embeddings using cosine similarity';
