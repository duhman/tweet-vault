# 🐦 Tweet Vault

**Twitter Bookmark + Likes Intelligence System** — Capture your saved tweets, extract links, generate embeddings, and search semantically via Claude MCP.

Tweet Vault makes your Twitter/X bookmarks and likes searchable with natural language queries like _"that thread about system design"_ or _"AI tools someone recommended"_.

## Features

- 🔍 **Semantic Search** — Find tweets and links by meaning, not just keywords
- 🔗 **Link Extraction** — Automatically extracts and indexes URLs with metadata
- 🤖 **Claude MCP Integration** — Query bookmarks + likes directly from Claude
- 🐦 **Bird CLI Integration** — Sync bookmarks and likes automatically from Twitter
- ⏰ **Daily Processing** — Syncs new tweets and drains enrichment backlog via Supabase pg_cron or local backlog commands
- 🧠 **Smart Embeddings** — Gemini `gemini-embedding-001` or OpenAI `text-embedding-3-small` with 1536 dimensions
- ⚡ **Fast Vector Search** — pgvector with HNSW indexes

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Data Ingestion (CLI)                                          │
│  bun run sync ─► Bird CLI ─► Twitter GraphQL ─► Supabase       │
│                                                                │
│  Processing                                                     │
│  ├─ tweet-vault-sync: scheduled acquisition from X/Twitter      │
│  ├─ process-tweets: metadata + embedding backlog processor      │
│  └─ bun run process:backlog: local manual backlog drain         │
│                                                                │
│  Supabase Database (tweet_vault schema)                        │
│  ├─ tweets (canonical tweet storage, 1536d embeddings)         │
│  ├─ tweet_interactions (bookmark/like interaction model)       │
│  ├─ links (1536d embeddings, HNSW vector index)                │
│  └─ sync_state (checkpoint tracking)                           │
│                                                                │
│  MCP Server ─► Claude                                          │
│  └─ 9 tools: search_tweets, vault_health, search_links, etc.    │
└────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.2+
- [Supabase](https://supabase.com) project with pgvector extension
- Google/Gemini API key for embeddings, or OpenAI as fallback
- Twitter/X account with bookmarks/likes

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
3. Deploy the Edge Functions:

```bash
supabase functions deploy tweet-vault-sync --project-ref <your-project-ref>
supabase functions deploy process-tweets --project-ref <your-project-ref>
supabase secrets set GOOGLE_API_KEY="<your-key>" --project-ref <your-project-ref>
```

Cron schedules contain project-specific function URLs and invocation headers. Do not commit rendered schedules; apply them from `supabase/templates/tweet-vault-cron.sql` with private deployment credentials.

### Import From Twitter

**Option 1: Bird CLI (Recommended)**

```bash
# Sync bookmarks + likes (latest window, requires Safari login or cookies)
bun run sync

# Sync all available pages for both timelines
bun run sync:all

# Sync likes only
bun run sync --likes-only

# Sync bookmarks only
bun run sync --bookmarks-only
```

**Option 2: Direct Obsidian Export (No Supabase Required)**

If the immediate goal is to get saved tweets into the brain, you can bypass Supabase and export straight into the Obsidian inbox using your Safari-authenticated X session:

```bash
# Export recent bookmarks to the Obsidian inbox
bun run export:obsidian -- --bookmarks-only --count=20

# Export likes instead
bun run export:obsidian -- --likes-only --count=20

# Override destination folder if needed
bun run export:obsidian -- --bookmarks-only --output=/path/to/00-Inbox/feeds/twitter
```

This creates deterministic markdown notes suitable for downstream triage and promotion in `obsidian-memory`.

**Option 3: Manual JSON Export**

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
        "GOOGLE_API_KEY": "your-google-key"
      }
    }
  }
}
```

### Available MCP Tools

| Tool                   | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `search_tweets`        | Semantic search over saved tweets (bookmarks + likes) |
| `search_likes`         | Semantic search over liked tweets only                |
| `search_links`         | Semantic search over extracted links                  |
| `get_tweet`            | Get specific tweet by ID                              |
| `list_links_by_domain` | Browse links by domain (e.g., github.com)             |
| `find_related`         | Find tweets and links for a topic                     |
| `vault_stats`          | Show vault statistics                                 |
| `vault_health`         | Show backlog, recent sync, cron, and warning status   |
| `list_authors`         | List tweets from specific author                      |

### Codex / Bookmark Enrichment

For Codex, the canonical MCP entry is managed from
`/Users/workboi/agents/mcp/servers/tweet-vault/server.yaml` and launches with:

```toml
[mcp_servers.tweet-vault]
command = "bun"
args = ["run", "--cwd", "/Users/workboi/projects/tweet-vault", "mcp"]
env = { "SUPABASE_SCHEMA" = "tweet_vault" }
```

The `--cwd` is intentional: it lets the MCP server load this project's `.env`
without copying secrets into Codex config. During bookmark ingestion, use
`get_tweet` for exact X/Twitter URLs and `find_related` / `search_links` for
nearby saved context before falling back to public oEmbed extraction.

### Example Queries

Once configured, ask Claude things like:

- _"Search my saved tweets for TypeScript best practices"_
- _"Search my likes for tweets about pgvector"_
- _"Find GitHub links I've bookmarked about testing"_
- _"What did @swyx tweet that I saved?"_
- _"Show me bookmarks related to AI agents"_

## Commands

| Command                                                  | Description                                       |
| -------------------------------------------------------- | ------------------------------------------------- |
| `bun run sync`                                           | Sync bookmarks + likes from Twitter via Bird      |
| `bun run sync:all`                                       | Sync all available pages (bookmarks + likes)      |
| `bun run export:obsidian -- --bookmarks-only --count=20` | Export recent tweets directly into Obsidian inbox |
| `bun run import <file>`                                  | Import tweets from JSON export                    |
| `bun run health`                                         | Show read-only backlog, sync, and cron health     |
| `bun run process:backlog`                                | Drain more pending embeddings locally             |
| `bun run mcp`                                            | Run MCP server standalone                         |
| `bun run smoke:mcp`                                      | Validate MCP startup and env wiring               |
| `bun run typecheck`                                      | TypeScript type checking                          |
| `bun run test`                                           | Run regression tests                              |
| `bun run verify`                                         | Run typecheck, build, and tests                   |

## Environment Variables

### Local CLI (.env)

| Variable                            | Required  | Description                                                    |
| ----------------------------------- | --------- | -------------------------------------------------------------- |
| `SUPABASE_URL`                      | Yes       | Supabase project URL                                           |
| `SUPABASE_SERVICE_ROLE_KEY`         | Yes       | Supabase service role key                                      |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Preferred | Gemini API key for embeddings                                  |
| `OPENAI_API_KEY`                    | Fallback  | OpenAI API key for embeddings when no Google/Gemini key is set |
| `SUPABASE_SCHEMA`                   | No        | Schema name (default: `tweet_vault`)                           |

### Edge Function (Supabase Dashboard)

| Variable                            | Description                                             |
| ----------------------------------- | ------------------------------------------------------- |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Preferred Gemini embedding key                          |
| `OPENAI_API_KEY`                    | Fallback embedding key when no Google/Gemini key is set |

## Database Schema

### Tables (tweet_vault schema)

| Table                | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `tweets`             | Canonical saved tweets with metadata and embeddings |
| `tweet_interactions` | Per-tweet interactions (`bookmark` / `like`)        |
| `links`              | Extracted URLs with og:tags and embeddings          |
| `sync_state`         | Sync history and statistics                         |

### RPC Functions

- `search_tweets` — Interaction-aware semantic tweet search via pgvector
- `vault_stats` — Aggregate stats including likes/bookmarks counts
- `search_links` — Semantic link search via pgvector

## Processing Pipeline

1. **Fetch** — Bird CLI fetches bookmarks and likes from Twitter GraphQL API
2. **Parse** — Validate with Zod schemas, transform to database format
3. **Deduplicate** — Check against existing tweet_ids
4. **Store** — Upsert to Supabase
5. **Extract Links** — Parse URLs from tweet content (Edge Function)
6. **Fetch Metadata** — GET each URL, extract og:title, og:description
7. **Generate Embeddings** — Gemini preferred, OpenAI fallback, both 1536d

## Automated Processing

Tweet Vault has two processing surfaces:

- `tweet-vault-sync`: acquisition job that fetches new X/Twitter bookmarks.
- `process-tweets`: enrichment job that fetches link metadata and generates pending embeddings.

The safe cron template is `supabase/templates/tweet-vault-cron.sql`. It schedules acquisition first and a separate enrichment/backlog pass afterward.

Local backlog drain:

```bash
bun run process:backlog
```

Manual trigger:

```bash
curl -X POST "https://your-project.supabase.co/functions/v1/process-tweets" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Obsidian Brain Integration

Supabase Tweet Vault is the cloud enrichment/search layer. The Obsidian bookmark vault remains the durable markdown/canon layer. `bun run export:obsidian` writes v1.1 frontmatter with `vault_enrichment` metadata so downstream bookmark validators and promotion workflows can connect notes back to Tweet Vault.

## Verification

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the full checklist. The short version is:

```bash
bun run typecheck
bun run build
bun run test
bun run smoke:mcp
```

For the current live deployment state, cron topology, and security-hardening verification, see [docs/LIVE_DEPLOYMENT.md](docs/LIVE_DEPLOYMENT.md).

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) 1.2+
- **Language**: TypeScript 5.7
- **Database**: [Supabase](https://supabase.com) (PostgreSQL + pgvector)
- **Processing**: Supabase Edge Functions (Deno) + pg_cron
- **Embeddings**: Gemini `gemini-embedding-001` preferred; OpenAI `text-embedding-3-small` fallback; both 1536d
- **Vector Index**: pgvector HNSW
- **Validation**: [Zod](https://zod.dev)
- **MCP**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Twitter Sync**: [Bird CLI](https://github.com/steipete/bird)

## Related Projects

- [Star Vault](https://github.com/duhman/star-vault) — Same concept for GitHub stars
- [Bird CLI](https://github.com/steipete/bird) — Twitter/X CLI tool used for sync

## License

MIT
