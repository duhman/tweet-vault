# 🐦 Tweet Vault

**Twitter Bookmarks Intelligence System** — Capture your bookmarked tweets, extract links, generate embeddings, and search them semantically via Claude MCP.

Ever bookmark interesting tweets and never find them again? Tweet Vault makes your Twitter/X bookmarks searchable with natural language queries like _"that thread about system design"_ or _"AI tools someone recommended"_.

## Features

- 🔍 **Semantic Search** — Find tweets and links by meaning, not just keywords
- 🔗 **Link Extraction** — Automatically extracts and indexes URLs with metadata
- 🤖 **Claude MCP Integration** — Query your bookmarks directly from Claude
- 🐦 **Bird CLI Integration** — Sync bookmarks automatically from Twitter
- ⏰ **Daily Sync** — Automatically processes new bookmarks via pg_cron
- 🧠 **Smart Embeddings** — OpenAI text-embedding-3-small (1536 dimensions)
- ⚡ **Fast Vector Search** — PostgreSQL pgvector with HNSW indexing

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        Data Ingestion                          │
├────────────────────────────────────────────────────────────────┤
│  Bird CLI ────┐                                                │
│  (automated)  │                                                │
│               ├──→ Processing Pipeline ──→ Supabase (pgvector) │
│  JSON Export ─┘    (dedupe, links,              ↓              │
│  (manual)          embeddings)           MCP Server → Claude   │
└────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.2+
- [Supabase](https://supabase.com) instance (cloud or self-hosted)
- [OpenAI API key](https://platform.openai.com/api-keys)
- Twitter/X account with bookmarks

### Installation

```bash
# Clone the repository
git clone https://github.com/duhman/tweet-vault.git
cd tweet-vault

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your credentials
```

### Database Setup

Run the migrations in your Supabase SQL editor:

```bash
# Apply migrations in order
cat supabase/migrations/001_initial_schema.sql
cat supabase/migrations/002_cron_daily_sync.sql
```

### Import Your Bookmarks

**Option 1: Bird CLI (Recommended)**

```bash
# Install Bird CLI globally
npm install -g @steipete/bird

# Sync latest bookmarks (requires Safari login to Twitter)
bun run sync

# Sync all bookmarks
bun run sync:all
```

**Option 2: Manual JSON Export**

```bash
# Export bookmarks using twitter-web-exporter browser extension
# Then import the JSON file
bun run import path/to/bookmarks.json
```

See [docs/EXTRACTION.md](docs/EXTRACTION.md) for detailed extraction methods.

## MCP Server Setup

Add to your Claude MCP configuration (`~/.mcp.json` or Claude Desktop settings):

```json
{
  "mcpServers": {
    "tweet-vault": {
      "command": "bun",
      "args": ["run", "/path/to/tweet-vault/mcp-server/index.ts"],
      "env": {
        "SUPABASE_URL": "your-supabase-url",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "OPENAI_API_KEY": "your-openai-key"
      }
    }
  }
}
```

### Available MCP Tools

| Tool                   | Description                               |
| ---------------------- | ----------------------------------------- |
| `search_tweets`        | Semantic search over bookmarked tweets    |
| `search_links`         | Semantic search over extracted links      |
| `get_tweet`            | Get specific tweet by ID                  |
| `list_links_by_domain` | Browse links by domain (e.g., github.com) |
| `find_related`         | Find tweets and links for a topic         |
| `vault_stats`          | Show vault statistics                     |
| `list_authors`         | List tweets from specific author          |

### Example Queries

Once configured, ask Claude things like:

- _"Search my bookmarks for tweets about TypeScript best practices"_
- _"Find GitHub links I've bookmarked about testing"_
- _"What did @swyx tweet that I saved?"_
- _"Show me bookmarks related to AI agents"_

## Commands

| Command                 | Description                              |
| ----------------------- | ---------------------------------------- |
| `bun run sync`          | Sync bookmarks from Twitter via Bird CLI |
| `bun run sync:all`      | Sync ALL bookmarks (may take a while)    |
| `bun run import <file>` | Import tweets from JSON export           |
| `bun run process`       | Generate pending embeddings              |
| `bun run mcp`           | Run MCP server standalone                |
| `bun run typecheck`     | TypeScript type checking                 |

## Environment Variables

| Variable                    | Required | Description                             |
| --------------------------- | -------- | --------------------------------------- |
| `SUPABASE_URL`              | Yes      | Your Supabase project URL               |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Service role key (for admin operations) |
| `SUPABASE_ANON_KEY`         | No       | Anon key (for MCP server)               |
| `OPENAI_API_KEY`            | Yes      | OpenAI API key for embeddings           |
| `TWITTER_AUTH_TOKEN`        | No       | Twitter session cookie (for direct API) |
| `TWITTER_CT0`               | No       | Twitter CSRF token (for direct API)     |

## Database Schema

### Tables

| Table        | Purpose                                        |
| ------------ | ---------------------------------------------- |
| `tweets`     | Bookmarked tweets with metadata and embeddings |
| `links`      | Extracted URLs with og:tags and embeddings     |
| `sync_state` | Sync history and statistics                    |

### Key Functions

- `search_tweets(embedding, threshold, limit)` — Semantic tweet search
- `search_links(embedding, threshold, limit)` — Semantic link search
- `get_tweet_with_links(tweet_id)` — Full tweet with extracted links
- `get_tweet_vault_stats()` — Vault statistics

## Processing Pipeline

1. **Parse** — Read exported JSON, validate with Zod schemas
2. **Deduplicate** — Check against existing tweet_ids
3. **Extract Links** — Parse URLs from tweet content and entities
4. **Fetch Metadata** — GET each URL, extract og:title, og:description
5. **Generate Embeddings** — OpenAI text-embedding-3-small (1536d)
6. **Store** — Upsert to Supabase with HNSW-indexed vectors

## Bookmark Extraction Methods

| Method                 | Best For          | Auth Required |
| ---------------------- | ----------------- | ------------- |
| **Bird CLI**           | Automated sync    | Safari login  |
| **Browser Extension**  | One-time export   | Logged in     |
| **DevTools Intercept** | Power users       | Logged in     |
| **Playwright MCP**     | Claude automation | Manual login  |

See [docs/EXTRACTION.md](docs/EXTRACTION.md) for step-by-step instructions.

## Automated Daily Sync

For automated syncing, deploy the Edge Function and configure pg_cron:

```sql
-- Schedule daily sync at 6 AM UTC
SELECT cron.schedule(
  'tweet-vault-daily-sync',
  '0 6 * * *',
  $$SELECT trigger_tweet_vault_sync()$$
);
```

See `supabase/functions/process-tweets/` for the Edge Function code.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) 1.2+
- **Language**: TypeScript 5.7
- **Database**: PostgreSQL + [pgvector](https://github.com/pgvector/pgvector)
- **Embeddings**: OpenAI text-embedding-3-small (1536d)
- **Vector Index**: HNSW (m=16, ef_construction=64)
- **HTML Parsing**: [cheerio](https://cheerio.js.org)
- **Validation**: [Zod](https://zod.dev)
- **MCP**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Twitter Sync**: [Bird CLI](https://github.com/steipete/bird)

## Related Projects

- [Star Vault](https://github.com/duhman/star-vault) — Same concept for GitHub stars
- [Bird CLI](https://github.com/steipete/bird) — Twitter/X CLI tool used for sync

## License

MIT
