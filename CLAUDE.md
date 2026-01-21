# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Tweet Vault is a Twitter/X bookmarks intelligence system. It captures bookmarked tweets, extracts links, generates embeddings, and enables semantic search via MCP server.

**Status**: Operational on Convex (`https://harmless-shrimp-967.convex.cloud`)

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

# Convex development (generates types, hot reload)
npx convex dev

# Run Convex actions directly
npx convex run tweetVault:syncTweetVault '{"count": 50}'
npx convex run tweetVault:processTweetVault '{}'

# Full backfill (ignores checkpoint)
npx convex run tweetVault:syncTweetVault '{"fetchAll": true, "ignoreCheckpoint": true}'
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Data Sources                                                    │
│  ├─ Bird CLI (@steipete/bird) → Safari cookie extraction        │
│  └─ JSON export (manual)                                        │
│                         ↓                                        │
│  Processing Pipeline (Convex actions)                           │
│  ├─ Fetch bookmarks from Twitter GraphQL                        │
│  ├─ Dedupe against existing tweet_ids                           │
│  ├─ Extract links from tweet content                            │
│  ├─ Fetch link metadata (og:title, og:description)              │
│  └─ Generate embeddings (OpenAI text-embedding-3-small)         │
│                         ↓                                        │
│  Convex Database                                                 │
│  ├─ tweets (1536d embeddings, vector index)                     │
│  ├─ links (1536d embeddings, vector index)                      │
│  └─ sync_state (checkpoint tracking)                            │
│                         ↓                                        │
│  MCP Server (Supabase)                                           │
│  ├─ Database: brawengrbiuvnmsyqhoe.supabase.co (tweet_vault)    │
│  ├─ Uses: @supabase/supabase-js, OpenAI embeddings              │
│  └─ 7 tools: search_tweets, search_links, get_tweet, etc.       │
└─────────────────────────────────────────────────────────────────┘
```

**Note**: The sync pipeline uses Convex backend, while the MCP server queries Supabase directly for better performance with Claude Code.

**Daily Sync**: Convex cron at 6 AM UTC (`convex/crons.ts`) calls `syncTweetVault`.

## Key Files

| Path                            | Purpose                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `convex/schema.ts`              | Database schema (tweets, links, sync_state, twitter_likes) |
| `convex/tweetVault.ts`          | Main sync action - fetches bookmarks, runs pipeline        |
| `convex/tweetVaultQueries.ts`   | Search actions (vector search for tweets/links)            |
| `convex/tweetVaultMutations.ts` | CRUD mutations for tweets/links                            |
| `convex/tweetVaultInternal.ts`  | Internal queries (for actions to call)                     |
| `convex/lib/embeddings.ts`      | OpenAI embedding helper with retry logic                   |
| `convex/crons.ts`               | Daily sync schedule                                        |
| `mcp-server/index.ts`           | MCP server exposing 7 tools to Claude                      |
| `scripts/sync-from-bird.ts`     | Local CLI for Bird-based sync                              |
| `src/process/*.ts`              | Local processing helpers (tweets, links, embeddings)       |
| `src/utils/convex.ts`           | Convex HTTP client utilities                               |

## Convex Function Organization

- **Actions** (can call external APIs, run mutations/queries):
  - `tweetVault.syncTweetVault` - Main orchestrator
  - `tweetVault.processTweetVault` - Process embeddings only
  - `tweetVaultQueries.searchTweets/searchLinks` - Vector search

- **Mutations** (write to database):
  - `tweetVaultMutations.upsertTweets`
  - `tweetVaultLinks.backfillLinks`

- **Queries** (read from database):
  - `tweetVaultQueries.getTweet`, `vaultStats`, `listAuthors`

- **Internal** (only callable from actions):
  - `tweetVaultInternal.*` - Helper queries/mutations

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

### CLI Operations (.env)

- `CONVEX_URL` - Convex deployment URL (required for sync commands)

### Convex Dashboard (set via `npx convex env set`)

- `OPENAI_API_KEY` - For embeddings
- `TWITTER_AUTH_TOKEN` - For bookmark sync
- `TWITTER_CT0` - For bookmark sync

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
4. If needed, add Convex query/action in `convex/tweetVaultQueries.ts`

### Modifying the schema

1. Edit `convex/schema.ts`
2. Run `npx convex dev` to apply changes
3. Update relevant mutations/queries

### Adding a new processing step

1. Add logic to `runProcessingPipeline` in `convex/tweetVault.ts`
2. Add any needed internal queries/mutations to `convex/tweetVaultInternal.ts`

## Tech Stack

- **Runtime**: Bun 1.2+
- **Database**: Convex (vector indexes for semantic search)
- **Embeddings**: OpenAI text-embedding-3-small (1536d)
- **Twitter Integration**: @steipete/bird (GraphQL API via Safari cookies)
- **MCP**: @modelcontextprotocol/sdk
- **Validation**: Zod
