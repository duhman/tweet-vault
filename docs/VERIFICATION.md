# Verification

Use this flow after changing Tweet Vault so we validate the end-to-end contracts, not just TypeScript.

## Local checks

```bash
bun run typecheck
bun run build
bun test
bun run smoke:mcp
```

`bun run smoke:mcp` validates required MCP env vars and startup wiring. If you want to run it without contacting Supabase, set `MCP_SKIP_REMOTE_VALIDATION=1`.

## Processing sanity check

1. Run `bun run sync -- --bookmarks-only --count=5 --skip-embeddings` if Twitter access is available.
2. Run `bun run process`.
3. Run `bun run mcp -- --healthcheck` and then `bun run mcp` to confirm the MCP server starts cleanly.

## Supabase deployment checklist

1. Deploy `supabase/functions/process-tweets`.
2. Apply migration `0014_fix_process_tweets_cron.sql`.
3. Confirm the scheduled job points to `.../functions/v1/process-tweets`.
4. Confirm `sync_state` receives a new `sync_type = 'cron'` row after a run.
5. Confirm pending `tweets.embedding` and `links.title` / `links.embedding` rows decrease after the function executes.
