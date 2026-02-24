-- Deprecated: Likes are now stored via tweet_vault.tweet_interactions.
--
-- Keep this file for backward compatibility with old runbooks.
-- To set up likes support, apply migration `0012_unified_interactions.sql` instead.
--
-- This compatibility view mirrors legacy twitter_likes reads.

create schema if not exists tweet_vault;

drop view if exists tweet_vault.twitter_likes;
create view tweet_vault.twitter_likes as
select
  ti.id,
  t.tweet_id,
  t.content,
  null::text as author_id,
  t.author_name,
  coalesce(ti.interaction_at, t.created_at, t.fetched_at) as liked_at,
  t.embedding,
  coalesce(ti.metadata, '{}'::jsonb) || jsonb_build_object('metrics', coalesce(t.metrics, '{}'::jsonb)) as metadata,
  coalesce(ti.source, 'tweet-vault') as source,
  ti.synced_at,
  t.processed_at as updated_at,
  coalesce(t.created_at, t.fetched_at) as created_at
from tweet_vault.tweet_interactions ti
join tweet_vault.tweets t
  on t.tweet_id = ti.tweet_id
where ti.interaction_type = 'like';
