# 🐦 Tweet Vault

**Twitter Bookmarks Intelligence System** — Capture your bookmarked tweets, extract links, generate embeddings, and search them semantically via Claude MCP.

Ever bookmark interesting tweets and never find them again? Tweet Vault makes your Twitter/X bookmarks searchable with natural language queries like _"that thread about system design"_ or _"AI tools someone recommended"_.

## Features

- 🔍 **Semantic Search** — Find tweets and links by meaning, not just keywords
- 🔗 **Link Extraction** — Automatically extracts and indexes URLs with metadata
- 🤖 **Claude MCP Integration** — Query your bookmarks directly from Claude
- 🐦 **Bird CLI Integration** — Sync bookmarks automatically from Twitter
- ⏰ **Daily Processing** — Automatically processes embeddings via Supabase pg_cron
- 🧠 **Smart Embeddings** — OpenAI text-embedding-3-small (1536 dimensions)
- ⚡ **Fast Vector Search** — pgvector with HNSW indexes

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Data Ingestion (CLI)                                          │
│  bun run sync ─► Bird CLI ─► Twitter GraphQL ─► Supabase       │
│                                                                │
│  Processing (Edge Function - daily 6 AM UTC via pg_cron)       │
│  ├─ Generate tweet embeddings (batch 20)                       │
│  ├─ Fetch link metadata (batch 10)                             │
│  └─ Generate link embeddings (batch 10)                        │
│                                                                │
│  Supabase Database (tweet_vault schema)                        │
│  ├─ tweets (1536d embeddings, HNSW vector index)               │
│  ├─ links (1536d embeddings, HNSW vector index)                │
│  └─ sync_state (checkpoint tracking)                           │
│                                                                │
│  MCP Server ─► Claude                                          │
│  └─ 7 tools: search_tweets, search_links, get_tweet, etc.      │
└────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.2+
- [Supabase](https://supabase.com) project with pgvector extension
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

### Database Setup (Supabase)

1. Create a Supabase project
2. Run migrations from `supabase/migrations/` in order
3. Deploy the Edge Function:

```bash
supabase functions deploy process-tweets --project-ref <your-project-ref>
supabase secrets set OPENAI_API_KEY="<your-key>" --project-ref <your-project-ref>
```

### Import Your Bookmarks

**Option 1: Bird CLI (Recommended)**

```bash
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

## MCP Server Setup

Add to your Claude MCP configuration (`~/.claude.json` or Claude Desktop settings):

```json
{
  "mcpServers": {
    "tweet-vault": {
      "command": "bun",
      "args": ["run", "/path/to/tweet-vault/mcp-server/index.ts"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
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
| `bun run mcp`           | Run MCP server standalone                |
| `bun run typecheck`     | TypeScript type checking                 |

## Environment Variables

### Local CLI (.env)

| Variable                    | Required | Description                          |
| --------------------------- | -------- | ------------------------------------ |
| `SUPABASE_URL`              | Yes      | Supabase project URL                 |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Supabase service role key            |
| `OPENAI_API_KEY`            | Yes      | OpenAI API key for embeddings        |
| `SUPABASE_SCHEMA`           | No       | Schema name (default: `tweet_vault`) |

### Edge Function (Supabase Dashboard)

| Variable         | Description              |
| ---------------- | ------------------------ |
| `OPENAI_API_KEY` | For embedding generation |

## Database Schema

### Tables (tweet_vault schema)

| Table        | Purpose                                        |
| ------------ | ---------------------------------------------- |
| `tweets`     | Bookmarked tweets with metadata and embeddings |
| `links`      | Extracted URLs with og:tags and embeddings     |
| `sync_state` | Sync history and statistics                    |

### RPC Functions

- `search_tweets` — Semantic tweet search via pgvector
- `search_links` — Semantic link search via pgvector

## Processing Pipeline

1. **Fetch** — Bird CLI fetches bookmarks from Twitter GraphQL API
2. **Parse** — Validate with Zod schemas, transform to database format
3. **Deduplicate** — Check against existing tweet_ids
4. **Store** — Upsert to Supabase
5. **Extract Links** — Parse URLs from tweet content (Edge Function)
6. **Fetch Metadata** — GET each URL, extract og:title, og:description
7. **Generate Embeddings** — OpenAI text-embedding-3-small (1536d)

## Automated Daily Processing

The Edge Function `process-tweets` runs daily at 6 AM UTC via Supabase pg_cron:

- Generates embeddings for tweets without them (batch of 20)
- Fetches metadata for links without it (batch of 10)
- Generates embeddings for links with metadata (batch of 10)

Manual trigger:

```bash
curl -X POST "https://your-project.supabase.co/functions/v1/process-tweets" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) 1.2+
- **Language**: TypeScript 5.7
- **Database**: [Supabase](https://supabase.com) (PostgreSQL + pgvector)
- **Processing**: Supabase Edge Functions (Deno) + pg_cron
- **Embeddings**: OpenAI text-embedding-3-small (1536d)
- **Vector Index**: pgvector HNSW
- **Validation**: [Zod](https://zod.dev)
- **MCP**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Twitter Sync**: [Bird CLI](https://github.com/steipete/bird)

## Related Projects

- [Star Vault](https://github.com/duhman/star-vault) — Same concept for GitHub stars
- [Bird CLI](https://github.com/steipete/bird) — Twitter/X CLI tool used for sync

## License

MIT
