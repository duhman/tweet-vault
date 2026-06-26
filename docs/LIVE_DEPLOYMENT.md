# Live Deployment Notes

Last verified: 2026-06-26

Tweet Vault is live in Supabase project `brawengrbiuvnmsyqhoe` (`Privatebase`) with schema `tweet_vault`.

## Deployed Functions

| Function | Status | Verified version |
| --- | --- | --- |
| `tweet-vault-sync` | ACTIVE | 10 |
| `process-tweets` | ACTIVE | 7 |

`tweet-vault-sync` is the acquisition function. It fetches saved X/Twitter content and records canonical tweets/interactions.

`process-tweets` is the enrichment function. It fetches link metadata and drains pending tweet/link embeddings. The live function verified Gemini fallback on 2026-06-26.

## Cron Jobs

| Job | Schedule | Purpose |
| --- | --- | --- |
| `tweet-vault-daily-sync` | `0 6 * * *` | Scheduled acquisition via `tweet-vault-sync` |
| `tweet-vault-process-tweets-backlog` | `30 6 * * *` | Scheduled metadata/embedding backlog pass via `process-tweets` |

Cron SQL is rendered from `supabase/templates/tweet-vault-cron.sql` with private credentials and applied from a temp file. Never commit rendered cron SQL, JWTs, or service-role keys.

## Security Posture

Migration `0015_tweet_vault_security_hardening.sql` has been applied and marked as applied in Supabase migration history.

Live verification on 2026-06-26 returned zero `anon` / `authenticated` table privileges for `tweet_vault`.

## Health Snapshot

After a manual `process-tweets` invocation on 2026-06-26:

| Metric | Value |
| --- | --- |
| Tweets | 3,030 |
| Links | 586 |
| Tweet embeddings | 2,300 |
| Link embeddings | 151 |
| Pending tweet embeddings | 730 |
| Pending link metadata | 298 |
| Pending link embeddings | 435 |
| Metadata-ready links missing embeddings | 137 |
| Link fetch errors | 16 |

Manual invocation result:

```json
{
  "tweets_embedded": 20,
  "links_metadata_fetched": 0,
  "links_embedded": 1,
  "embedding_provider": "gemini",
  "errors": []
}
```

## Operational Commands

```bash
bun run health
bun run mcp -- --healthcheck
bun run process:backlog
```

`bun run process:backlog` is local and uses the configured local embedding provider. Use it only when intentionally draining backlog outside the scheduled Supabase function.

## Migration History Caveat

The remote Supabase migration history includes remote-only versions `0016` through `0023` that are not present in this checkout. They were not modified during the reliability hardening deployment. Reconcile those separately before relying on `supabase db push` for full-history drift management.
