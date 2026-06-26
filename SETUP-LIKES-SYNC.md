# Likes + Bookmarks Sync Setup

This project now uses a unified canonical model:

- `tweets` = canonical tweet record
- `tweet_interactions` = source interaction (`bookmark` / `like`)
- `twitter_likes` = compatibility view derived from canonical tables

## 1. Apply migrations

```bash
cd /Users/workboi/projects/tweet-vault
supabase db push --linked
```

If your project is not linked:

```bash
supabase db push --project-ref <project-ref>
```

## 2. Deploy processing functions

```bash
supabase functions deploy tweet-vault-sync --project-ref <project-ref>
supabase functions deploy process-tweets --project-ref <project-ref>
supabase functions deploy sync-likes --project-ref <project-ref>
```

`tweet-vault-sync` is the scheduled acquisition function. `process-tweets` drains metadata and embedding backlog. `sync-likes` is a legacy compatibility endpoint writing into canonical tables; prefer `bun run sync --likes-only` for normal local operation.

## 3. Run sync locally

```bash
# Default: bookmarks + likes
bun run sync

# Full sync with pagination cap
bun run sync:all --max-pages=10

# Timeline-specific modes
bun run sync --bookmarks-only
bun run sync --likes-only
```

## 4. Verify data contract

```sql
select count(*) from tweet_vault.tweets;
select interaction_type, count(*) from tweet_vault.tweet_interactions group by 1 order by 1;
select count(*) from tweet_vault.twitter_likes;
```

## 5. MCP validation

Use MCP tools after sync:

- `search_tweets` with `interaction_type: "all"`
- `search_tweets` with `interaction_type: "like"`
- `search_likes`
- `vault_stats`
- `vault_health`

## Troubleshooting

- `relation "tweet_interactions" does not exist`:
  Run migration `003_unified_interactions.sql` via `supabase db push`.

- `search_likes` returns no results:
  Confirm likes were fetched (`bun run sync --likes-only --count=20`) and that rows exist in `tweet_interactions` with `interaction_type='like'`.

- Metadata retries seem stalled:
  Failed link metadata now uses cooldown logic (24h); clear `fetch_error` on specific rows to force immediate retry.

- Backlog health is unclear:
  Run `bun run health` for pending embeddings, missing metadata, recent syncs, and cron status.
