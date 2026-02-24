-- Tweet Vault: Unified interactions model (bookmarks + likes)
-- Forward-only migration to align runtime contracts with live tweet_vault schema.

begin;

create schema if not exists tweet_vault;

create table if not exists tweet_vault.tweet_interactions (
  id bigserial primary key,
  tweet_id text not null references tweet_vault.tweets (tweet_id) on delete cascade,
  interaction_type text not null check (interaction_type in ('bookmark', 'like')),
  interaction_at timestamptz,
  source text default 'unknown',
  metadata jsonb default '{}'::jsonb,
  synced_at timestamptz default now()
);

create unique index if not exists tweet_interactions_tweet_type_uniq
  on tweet_vault.tweet_interactions (tweet_id, interaction_type);

create index if not exists tweet_interactions_type_at_idx
  on tweet_vault.tweet_interactions (interaction_type, interaction_at desc);

create index if not exists tweet_interactions_tweet_id_idx
  on tweet_vault.tweet_interactions (tweet_id);

-- Backfill existing tweets as bookmarks.
insert into tweet_vault.tweet_interactions (
  tweet_id,
  interaction_type,
  interaction_at,
  source,
  metadata,
  synced_at
)
select
  t.tweet_id,
  'bookmark',
  coalesce(t.fetched_at, t.created_at, now()),
  'backfill',
  jsonb_build_object('backfilled', true),
  now()
from tweet_vault.tweets t
on conflict (tweet_id, interaction_type) do nothing;

-- Normalize links.tweet_id to text if a legacy numeric type exists.
do $$
declare
  tweet_id_udt text;
begin
  select c.udt_name
  into tweet_id_udt
  from information_schema.columns c
  where c.table_schema = 'tweet_vault'
    and c.table_name = 'links'
    and c.column_name = 'tweet_id';

  if tweet_id_udt in ('int8', 'int4', 'int2') then
    alter table tweet_vault.links add column if not exists tweet_id_text text;

    update tweet_vault.links l
    set tweet_id_text = t.tweet_id
    from tweet_vault.tweets t
    where t.id = l.tweet_id
      and l.tweet_id_text is null;

    update tweet_vault.links
    set tweet_id_text = coalesce(tweet_id_text, tweet_id::text)
    where tweet_id_text is null;

    alter table tweet_vault.links drop column tweet_id;
    alter table tweet_vault.links rename column tweet_id_text to tweet_id;
  end if;
end
$$;

-- Ensure link dedupe and lookup contracts are explicit.
create index if not exists links_tweet_id_idx
  on tweet_vault.links (tweet_id);

-- Remove historical duplicates before enforcing unique constraint.
with ranked as (
  select
    id,
    row_number() over (
      partition by tweet_id, url
      order by id desc
    ) as rn
  from tweet_vault.links
)
delete from tweet_vault.links l
using ranked r
where l.id = r.id
  and r.rn > 1;

create unique index if not exists links_tweet_url_uniq
  on tweet_vault.links (tweet_id, url);

create or replace function tweet_vault.vault_stats()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'total_tweets', (select count(*) from tweet_vault.tweets),
    'total_links', (select count(*) from tweet_vault.links),
    'tweets_with_embeddings', (select count(*) from tweet_vault.tweets where embedding is not null),
    'links_with_embeddings', (select count(*) from tweet_vault.links where embedding is not null),
    'bookmarks_count', (select count(*) from tweet_vault.tweet_interactions where interaction_type = 'bookmark'),
    'likes_count', (select count(*) from tweet_vault.tweet_interactions where interaction_type = 'like'),
    'top_authors', (
      select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb)
      from (
        select author_username, count(*) as tweet_count
        from tweet_vault.tweets
        group by author_username
        order by count(*) desc
        limit 10
      ) a
    ),
    'top_domains', (
      select coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb)
      from (
        select domain, count(*) as link_count
        from tweet_vault.links
        where domain is not null
        group by domain
        order by count(*) desc
        limit 10
      ) d
    ),
    'last_sync', (
      select row_to_json(s)
      from tweet_vault.sync_state s
      order by last_sync_at desc
      limit 1
    )
  );
$$;

create or replace function tweet_vault.get_tweet_vault_stats()
returns jsonb
language sql
stable
as $$
  select tweet_vault.vault_stats();
$$;

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

grant select, insert, update on tweet_vault.tweet_interactions to anon, authenticated;
grant select on tweet_vault.twitter_likes to anon, authenticated;
grant usage, select on all sequences in schema tweet_vault to anon, authenticated;
grant execute on function tweet_vault.vault_stats to anon, authenticated;
grant execute on function tweet_vault.get_tweet_vault_stats to anon, authenticated;

comment on table tweet_vault.tweet_interactions is 'Interaction log for canonical tweets (bookmark/like).';
comment on view tweet_vault.twitter_likes is 'Compatibility view over canonical tweets + like interactions.';
comment on function tweet_vault.vault_stats is 'Returns aggregate Tweet Vault stats including likes/bookmarks counts.';

commit;
