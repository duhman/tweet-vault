# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Tweet Vault is a Twitter/X saved-tweet intelligence system. It captures bookmarks and likes into one canonical tweet model, extracts links, generates embeddings, and enables semantic search via MCP server.

**Status**: Operational on Supabase Cloud (`brawengrbiuvnmsyqhoe.supabase.co`, schema: `tweet_vault`)

## Development Commands

```bash
# Install dependencies
bun install

# Type checking
bun run typecheck

# Tests and verification
bun run test
bun run smoke:mcp
bun run verify
bun run health

# Run MCP server locally
bun run mcp

# Sync bookmarks + likes from Twitter (requires Safari login or cookies)
bun run sync                            # Latest window (both timelines)
bun run sync:all                        # All pages (both timelines)
bun run sync --bookmarks-only --count=100
bun run sync --likes-only --all --max-pages=10

# Import from JSON file
bun run import path/to/bookmarks.json

# Deploy Edge Function
supabase functions deploy tweet-vault-sync --project-ref brawengrbiuvnmsyqhoe
supabase functions deploy process-tweets --project-ref brawengrbiuvnmsyqhoe
```

Cron schedules contain project-specific function URLs and invocation headers. Apply schedules from `supabase/templates/tweet-vault-cron.sql` with private deployment credentials; never commit rendered JWTs.

## Architecture

**Single Source of Truth**: Supabase Cloud

```
┌─────────────────────────────────────────────────────────────────┐
│  Data Ingestion (CLI)                                            │
│  bun run sync ─► Bird CLI ─► Twitter GraphQL ─► Supabase        │
│                                                                  │
│  Processing                                                     │
│  ├─ tweet-vault-sync: scheduled acquisition from X/Twitter      │
│  ├─ process-tweets: metadata + embedding backlog processor      │
│  └─ bun run process:backlog: local manual backlog drain         │
│                                                                  │
│  Supabase Database (tweet_vault schema)                         │
│  ├─ tweets (canonical tweet storage + embeddings)               │
│  ├─ tweet_interactions (bookmark/like interaction records)      │
│  ├─ links (1536d embeddings, HNSW vector index)                 │
│  └─ sync_state (checkpoint tracking)                            │
│                                                                  │
│  MCP Server                                                      │
│  └─ 9 tools: search_tweets, search_likes, vault_health, etc.    │
└─────────────────────────────────────────────────────────────────┘
```

**Daily Processing**: Supabase pg_cron acquisition uses `tweet-vault-sync`; backlog enrichment uses `process-tweets` or `bun run process:backlog`.

## Key Files

| Path                                 | Purpose                            |
| ------------------------------------ | ---------------------------------- |
| `mcp-server/index.ts`                | MCP server (9 tools for Claude)     |
| `scripts/sync-from-bird.ts`          | Canonical sync for bookmarks + likes |
| `src/process/*.ts`                   | Processing helpers (tweets, links) |
| `src/utils/supabase.ts`              | Supabase client utilities          |
| `supabase/functions/process-tweets/` | Edge Function for daily processing |
| `supabase/migrations/`               | Database schema and RPC functions  |

## MCP Server Tools

| Tool                   | Description                            |
| ---------------------- | -------------------------------------- |
| `search_tweets`        | Semantic search over bookmarks + likes |
| `search_likes`         | Semantic search over likes only        |
| `search_links`         | Semantic search over extracted links   |
| `get_tweet`            | Get specific tweet by ID with links    |
| `list_links_by_domain` | Browse links by domain                 |
| `find_related`         | Find tweets and links for a topic      |
| `vault_stats`          | Vault statistics                       |
| `vault_health`         | Backlog, cron, and sync health         |
| `list_authors`         | List tweets from specific author       |

## Environment Variables

### Local CLI (.env)

| Variable                    | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `SUPABASE_URL`              | `https://brawengrbiuvnmsyqhoe.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Database access for CLI sync               |
| `OPENAI_API_KEY`            | Embedding generation                       |

### Supabase Edge Function (Dashboard → Edge Functions → Secrets)

- `OPENAI_API_KEY` - For embedding generation
- `GOOGLE_API_KEY` / `GEMINI_API_KEY` - Optional Gemini fallback for Edge Function embeddings

### MCP Server (configured in MCP client configs)

| Variable                     | Value                                      |
| ---------------------------- | ------------------------------------------ |
| `SUPABASE_URL`               | `https://brawengrbiuvnmsyqhoe.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY`  | `${PRIVATEBASE_SERVICE_ROLE_KEY}`          |
| `OPENAI_API_KEY`             | `${OPENAI_API_KEY}`                        |
| `SUPABASE_SCHEMA` (optional) | `tweet_vault` (default)                    |

## Common Tasks

### Adding a new MCP tool

1. Add tool definition to `tools` array in `mcp-server/index.ts`
2. Add handler function (e.g., `handleNewTool`)
3. Add case to switch statement in `CallToolRequestSchema` handler
4. If using new RPC functions, add them to `supabase/migrations/`

### Modifying the schema

1. Create new migration in `supabase/migrations/`
2. Apply with `supabase db push` or via Dashboard
3. Update MCP server and Edge Function as needed

### Triggering processing manually

```bash
# Call Edge Function directly
curl -X POST "https://brawengrbiuvnmsyqhoe.supabase.co/functions/v1/process-tweets" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Verification

```bash
bun run typecheck
bun run build
bun run test
bun run smoke:mcp
```

## Tech Stack

- **Runtime**: Bun 1.2+
- **Database**: Supabase Cloud (pgvector with HNSW indexes)
- **Processing**: Supabase Edge Functions (Deno) + pg_cron
- **Embeddings**: OpenAI text-embedding-3-small (1536d)
- **Twitter Integration**: @steipete/bird (GraphQL API via Safari cookies)
- **MCP**: @modelcontextprotocol/sdk
- **Validation**: Zod
