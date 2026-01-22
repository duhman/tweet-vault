# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Tweet Vault is a Twitter/X bookmarks intelligence system. It captures bookmarked tweets, extracts links, generates embeddings, and enables semantic search via MCP server.

**Status**: Operational on Supabase Cloud (`brawengrbiuvnmsyqhoe.supabase.co`, schema: `tweet_vault`)

## Development Commands

```bash
# Install dependencies
bun install

# Type checking
bun run typecheck

# Run MCP server locally
bun run mcp

# Sync bookmarks from Twitter (requires Safari login)
bun run sync              # Latest 50
bun run sync:all          # All bookmarks

# Import from JSON file
bun run import path/to/bookmarks.json

# Deploy Edge Function
supabase functions deploy process-tweets --project-ref brawengrbiuvnmsyqhoe
```

## Architecture

**Single Source of Truth**: Supabase Cloud

```
┌─────────────────────────────────────────────────────────────────┐
│  Data Ingestion (CLI)                                            │
│  bun run sync ─► Bird CLI ─► Twitter GraphQL ─► Supabase        │
│                                                                  │
│  Processing (Edge Function - daily 6 AM UTC via pg_cron)        │
│  ├─ Generate tweet embeddings (batch 20)                        │
│  ├─ Fetch link metadata (batch 10)                              │
│  └─ Generate link embeddings (batch 10)                         │
│                                                                  │
│  Supabase Database (tweet_vault schema)                         │
│  ├─ tweets (1536d embeddings, HNSW vector index)                │
│  ├─ links (1536d embeddings, HNSW vector index)                 │
│  └─ sync_state (checkpoint tracking)                            │
│                                                                  │
│  MCP Server                                                      │
│  └─ 7 tools: search_tweets, search_links, get_tweet, etc.       │
└─────────────────────────────────────────────────────────────────┘
```

**Daily Processing**: Supabase pg_cron at 6 AM UTC triggers Edge Function `process-tweets`.

## Key Files

| Path                                 | Purpose                            |
| ------------------------------------ | ---------------------------------- |
| `mcp-server/index.ts`                | MCP server (7 tools for Claude)    |
| `scripts/sync-from-bird.ts`          | CLI sync from Twitter via Bird     |
| `src/process/*.ts`                   | Processing helpers (tweets, links) |
| `src/utils/supabase.ts`              | Supabase client utilities          |
| `supabase/functions/process-tweets/` | Edge Function for daily processing |
| `supabase/migrations/`               | Database schema and RPC functions  |

## MCP Server Tools

| Tool                   | Description                            |
| ---------------------- | -------------------------------------- |
| `search_tweets`        | Semantic search over bookmarked tweets |
| `search_links`         | Semantic search over extracted links   |
| `get_tweet`            | Get specific tweet by ID with links    |
| `list_links_by_domain` | Browse links by domain                 |
| `find_related`         | Find tweets and links for a topic      |
| `vault_stats`          | Vault statistics                       |
| `list_authors`         | List tweets from specific author       |

## Environment Variables

### Local CLI (.env)

| Variable                    | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `SUPABASE_URL`              | `https://brawengrbiuvnmsyqhoe.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Database access for CLI sync               |
| `OPENAI_API_KEY`            | Embedding generation                       |

### Supabase Edge Function (Dashboard → Edge Functions → Secrets)

- `OPENAI_API_KEY` - For embedding generation in daily cron

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

## Tech Stack

- **Runtime**: Bun 1.2+
- **Database**: Supabase Cloud (pgvector with HNSW indexes)
- **Processing**: Supabase Edge Functions (Deno) + pg_cron
- **Embeddings**: OpenAI text-embedding-3-small (1536d)
- **Twitter Integration**: @steipete/bird (GraphQL API via Safari cookies)
- **MCP**: @modelcontextprotocol/sdk
- **Validation**: Zod
