# Tweet Vault - Twitter Bookmarks Intelligence System

Capture Twitter/X bookmarked tweets, extract links and content, generate embeddings, and make them searchable via semantic search.

## Status: ✅ Operational

| Metric               | Value                                 |
| -------------------- | ------------------------------------- |
| Tweets imported      | 290                                   |
| Embeddings generated | 290 (100%)                            |
| Daily sync           | 6 AM UTC via pg_cron                  |
| MCP Server           | Configured in ~/.claude/settings.json |

## Quick Start

```bash
# Install dependencies
bun install

# Copy and configure environment
cp .env.example .env
# Edit .env with your credentials

# Import tweets from JSON export
bun run import path/to/bookmarks.json

# Or run individual steps
bun run process        # Generate embeddings
bun run fetch-links    # Fetch link metadata
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Data Ingestion                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Bird CLI (NEW)  ──┐                                                     │
│  - npm run sync    │                                                     │
│  - Auto-extract    ├──→ Processing Pipeline ──→ Supabase (pgvector)     │
│                    │    (dedupe, links,        │                         │
│  Manual Export ────┘     embeddings)           ↓                         │
│  - JSON file                              MCP Server → Claude            │
└─────────────────────────────────────────────────────────────────────────┘
```

**Recommended**: Use `bun run sync` to fetch bookmarks directly from Twitter via Bird.

## Database

Uses self-hosted Supabase at `srv1209224.hstgr.cloud`

| Table        | Purpose                                   |
| ------------ | ----------------------------------------- |
| `tweets`     | Bookmarked tweets with 1536d embeddings   |
| `links`      | Extracted URLs with metadata + embeddings |
| `sync_state` | Sync history and stats                    |

### Key Functions

- `search_tweets(embedding, threshold, limit)` - Semantic tweet search
- `search_links(embedding, threshold, limit)` - Semantic link search
- `get_tweet_with_links(tweet_id)` - Full tweet with all links
- `get_tweet_vault_stats()` - Vault statistics

## MCP Server

The MCP server exposes these tools to Claude:

| Tool                   | Description                                |
| ---------------------- | ------------------------------------------ |
| `search_tweets`        | Semantic search over bookmarked tweets     |
| `search_links`         | Semantic search over extracted links       |
| `get_tweet`            | Get specific tweet by ID with full details |
| `list_links_by_domain` | Browse links by domain                     |
| `find_related`         | Find tweets and links for a topic          |
| `vault_stats`          | Show vault statistics                      |
| `list_authors`         | List tweets from specific author           |

### Setup MCP Server

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "tweet-vault": {
      "command": "bun",
      "args": [
        "run",
        "/Users/bigmac/projects/personal/tweet-vault/mcp-server/index.ts"
      ],
      "env": {
        "SUPABASE_URL": "${SUPABASE_SELFHOSTED_URL}",
        "SUPABASE_SERVICE_ROLE_KEY": "${SUPABASE_SELFHOSTED_SERVICE_KEY}",
        "OPENAI_API_KEY": "${OPENAI_API_KEY}"
      }
    }
  }
}
```

## Extracting Bookmarks

See [docs/EXTRACTION.md](docs/EXTRACTION.md) for detailed instructions.

### Quick Start Options

| Method                 | Best For                         | Auth Required           |
| ---------------------- | -------------------------------- | ----------------------- |
| **Playwright MCP**     | Automated extraction with Claude | Yes (manual login)      |
| **Browser Extension**  | Easy one-time export             | Yes (already logged in) |
| **DevTools Intercept** | Power users, complete data       | Yes                     |

### Option 1: Playwright MCP (Recommended)

```bash
# Install Playwright MCP (already done)
claude mcp add playwright -- npx @playwright/mcp@latest

# Ask Claude to extract bookmarks
# "Use Playwright to extract my Twitter bookmarks"
```

### Option 2: Claude-in-Chrome (Used for initial import)

1. Use Claude Code with claude-in-chrome MCP
2. Navigate to x.com/i/bookmarks
3. Run extraction script in browser console (scroll + capture loop)
4. Download JSON via blob URL
5. Transform with `npx tsx scripts/transform-bookmarks.ts`

### Option 3: Twitter Web Exporter (Browser Extension)

1. Install [twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter)
2. Go to x.com/i/bookmarks
3. Scroll through all bookmarks
4. Export as JSON

## Processing Pipeline

1. **Parse**: Read exported JSON, validate with Zod schemas
2. **Deduplicate**: Check against existing tweet_ids in database
3. **Extract Links**: Parse URLs from tweet content and entities
4. **Fetch Metadata**: GET each URL, extract og:title, og:description, og:image
5. **Generate Embeddings**: OpenAI text-embedding-3-small (1536d)
6. **Store**: Upsert to Supabase with HNSW-indexed vectors

## Daily Sync (pg_cron)

A cron job runs daily at 6 AM UTC to process pending embeddings and link metadata.

### Cron Job Status

```sql
-- Check scheduled jobs
SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE '%tweet%';

-- Check recent runs
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
```

### Edge Function Deployment

Deploy the processing Edge Function to self-hosted Supabase:

```bash
# SSH into the Supabase server
ssh root@srv1209224.hstgr.cloud

# Deploy the Edge Function
cd /root/supabase
docker compose exec -T supabase-edge-functions \
  deno run --allow-all /home/deno/functions/process-tweets/index.ts

# Or copy the function files and restart
docker cp supabase/functions/process-tweets supabase-edge-functions:/home/deno/functions/
docker compose restart supabase-edge-functions
```

### Manual Trigger

```bash
curl -X POST https://srv1209224.hstgr.cloud/functions/v1/process-tweets \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

### Vault Secrets

The cron job uses vault secrets for authentication:

```sql
-- Check secrets are configured
SELECT name FROM vault.secrets WHERE name IN ('tweet_vault_service_key', 'openai_api_key');
```

## Tech Stack

- **Runtime**: Bun 1.2+, TypeScript 5.7
- **Database**: Supabase (PostgreSQL + pgvector)
- **Embeddings**: OpenAI text-embedding-3-small (1536d)
- **Vector Index**: HNSW (m=16, ef_construction=64)
- **HTML Parsing**: cheerio
- **Concurrency**: p-limit
- **Validation**: Zod
- **MCP**: @modelcontextprotocol/sdk

## Environment Variables

| Variable                    | Required | Description                          |
| --------------------------- | -------- | ------------------------------------ |
| `SUPABASE_URL`              | Yes      | Self-hosted Supabase URL             |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Service role key for database access |
| `OPENAI_API_KEY`            | Yes      | OpenAI API key for embeddings        |

## Commands

| Command                 | Description                           |
| ----------------------- | ------------------------------------- |
| `bun run sync`          | Sync bookmarks from Twitter via Bird  |
| `bun run sync:all`      | Sync ALL bookmarks (may take a while) |
| `bun run import <file>` | Import tweets from JSON file          |
| `bun run process`       | Generate pending embeddings           |
| `bun run fetch-links`   | Fetch link metadata                   |
| `bun run mcp`           | Run MCP server standalone             |
| `bun run dev`           | Development mode (watch)              |
| `bun run typecheck`     | Type checking                         |

## Bird Integration

Tweet Vault now integrates with [Bird CLI](https://github.com/steipete/bird) for automated bookmark syncing:

```bash
# Sync latest 50 bookmarks (default)
bun run sync

# Sync all bookmarks
bun run sync:all

# Sync specific count
bun run scripts/sync-from-bird.ts --count=100
```

**Authentication**: Bird extracts cookies from Safari automatically. Must be logged into Twitter in Safari.

**Companion MCP**: The `bird` MCP server provides real-time read/write access (post tweets, reply, search). Tweet Vault provides semantic search over stored bookmarks.
