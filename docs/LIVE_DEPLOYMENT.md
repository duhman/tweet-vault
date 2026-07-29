# Live Deployment Notes

Last verified: 2026-06-26

Tweet Vault is live in Supabase project `brawengrbiuvnmsyqhoe` (`Privatebase`) with schema `tweet_vault`.

## Deployed Functions

| Function           | Status | Verified version |
| ------------------ | ------ | ---------------- |
| `tweet-vault-sync` | ACTIVE | 10               |
| `process-tweets`   | ACTIVE | 7                |

`tweet-vault-sync` is the acquisition function. It fetches saved X/Twitter content and records canonical tweets/interactions.

`process-tweets` is the enrichment function. It fetches link metadata and drains pending tweet/link embeddings. The live function verified Gemini fallback on 2026-06-26.

## Cron Jobs

| Job                                  | Schedule     | Purpose                                                        |
| ------------------------------------ | ------------ | -------------------------------------------------------------- |
| `tweet-vault-daily-sync`             | `0 6 * * *`  | Scheduled acquisition via `tweet-vault-sync`                   |
| `tweet-vault-process-tweets-backlog` | `30 6 * * *` | Scheduled metadata/embedding backlog pass via `process-tweets` |

Cron SQL is rendered from `supabase/templates/tweet-vault-cron.sql` with private credentials and applied from a temp file. Never commit rendered cron SQL, JWTs, or service-role keys.

## Security Posture

Migration `0015_tweet_vault_security_hardening.sql` has been applied and marked as applied in Supabase migration history.

Live verification on 2026-06-26 returned zero `anon` / `authenticated` table privileges for `tweet_vault`.

## Health Snapshot

After a manual `process-tweets` invocation on 2026-06-26:

| Metric                                  | Value |
| --------------------------------------- | ----- |
| Tweets                                  | 3,030 |
| Links                                   | 586   |
| Tweet embeddings                        | 2,300 |
| Link embeddings                         | 151   |
| Pending tweet embeddings                | 730   |
| Pending link metadata                   | 298   |
| Pending link embeddings                 | 435   |
| Metadata-ready links missing embeddings | 137   |
| Link fetch errors                       | 16    |

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

## Update: 2026-07-29

- **Health snapshot** (`bun run health`): 3,391 tweets (100% embedded), 652 links, 1,060 bookmarks / 51 likes. Remaining backlog is link-only: 321 missing metadata, 501 missing embeddings, 17 permanent fetch errors — tweet embedding is fully caught up.
- **Embedding provider confirmed 100% Gemini**, verified two ways: (a) direct query of `star_vault.repos.embedding_provider` (tweet_vault has no equivalent tracking column — see caveat below) returned zero `openai` rows; (b) both projects' `OPENAI_API_KEY` returned HTTP 401 (invalid, not just quota-limited) when tested directly against OpenAI's API this date.
- **Gemini API key rotated** across all five live locations (local `.env` for both projects, `hermes-vps` `.env` for both projects, Supabase Edge secrets `GEMINI_API_KEY`+`GOOGLE_API_KEY`) after the prior key accrued unexpected spend. Verified end-to-end by manually invoking the deployed `sync-embeddings` function post-rotation (200 real embeddings generated, `embedding_provider: gemini`). The old key still needs manual revocation in the Google console (operator action, not done from this session).
- **Known gap, not yet fixed**: unlike `star_vault.repos`, `tweet_vault.tweets`/`links` have no `embedding_provider` column, so mixed-provider vectors (if any predate the 2026-06-30 Gemini-preference switch) can't be filtered or detected the way `star_vault.search_repos` does. Flagged, out of scope for this update.
- **`export:obsidian` retired.** The Supabase-bypassing direct-to-Obsidian export (`scripts/export-to-obsidian.ts`, `bun run export:obsidian`) was removed — it wrote to `00-Inbox/feeds/twitter`, which never existed on disk, meaning it had never actually been used. Bookmarks now reach Obsidian exclusively through the vault's `/bookmark <url>` skill (manual, or via the `bookmark-supabase-sync` Hermes cron job once registered — see `~/projects/obsidian-memory/03-Resources/bookmarks/wiki/bookmark-automation-health-dashboard.md` for current status), which already enriches from this project via `get_tweet`/`find_related`.
