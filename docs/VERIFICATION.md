# Verification

Use this flow after changing Tweet Vault so we validate the end-to-end contracts, not just TypeScript.

For the current production deployment status and cron/security notes, see [LIVE_DEPLOYMENT.md](LIVE_DEPLOYMENT.md).

## Local checks

```bash
bun run typecheck
bun run build
bun test
bun run smoke:mcp
bun run health
```

`bun run smoke:mcp` validates required MCP env vars and startup wiring. If you want to run it without contacting Supabase, set `MCP_SKIP_REMOTE_VALIDATION=1`.
`bun run health` is read-only and reports pending embeddings, missing metadata, recent sync rows, and cron status.

## Processing sanity check

1. Run `bun run sync -- --bookmarks-only --count=5 --skip-embeddings` if Twitter access is available.
2. Run `bun run process` for a normal pass or `bun run process:backlog` to drain more pending embeddings.
3. Run `bun run mcp -- --healthcheck` and then `bun run mcp` to confirm the MCP server starts cleanly.

## Supabase deployment checklist

1. Deploy `supabase/functions/tweet-vault-sync`.
2. Deploy `supabase/functions/process-tweets`.
3. Apply security migration `0015_tweet_vault_security_hardening.sql`.
4. Apply cron schedules from `supabase/templates/tweet-vault-cron.sql` using private project credentials; do not commit the rendered SQL.
5. Confirm acquisition cron invokes `.../functions/v1/tweet-vault-sync`.
6. Confirm enrichment cron invokes `.../functions/v1/process-tweets`.
7. Confirm `sync_state.metadata.function_name` is `tweet-vault-sync` or `process-tweets` after each run.
8. Confirm pending `tweets.embedding` and `links.title` / `links.embedding` rows decrease after enrichment runs.
9. Confirm no broad `anon` / `authenticated` grants remain on `tweet_vault` tables, sequences, or functions.
