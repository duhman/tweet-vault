# Tweet Vault - Twitter Bookmarks Intelligence System

Capture Twitter/X bookmarked tweets, extract links and content, generate embeddings, and make them searchable via semantic search.

## Status: ✅ Operational (Convex)

| Metric               | Value                                 |
| -------------------- | ------------------------------------- |
| Tweets imported      | 300                                   |
| Embeddings generated | 300 (100%)                            |
| Daily sync           | 6 AM UTC via Convex cron              |
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
│  - Auto-extract    ├──→ Processing Pipeline ──→ Convex                  │
│                    │    (dedupe, links,        │                         │
│  Manual Export ────┘     embeddings)           ↓                         │
│  - JSON file                              MCP Server → Claude            │
└─────────────────────────────────────────────────────────────────────────┘
```

**Recommended**: Use `bun run sync` to fetch bookmarks directly from Twitter via Bird.

## Database

Uses Convex deployment `https://utmost-gerbil-770.convex.cloud`

| Table        | Purpose                                   |
| ------------ | ----------------------------------------- |
| `tweets`     | Bookmarked tweets with 1536d embeddings   |
| `links`      | Extracted URLs with metadata + embeddings |
| `sync_state` | Sync history and stats                    |

### Key Functions (Convex)

- `tweetVaultQueries.searchTweets` - Semantic tweet search
- `tweetVaultQueries.searchLinks` - Semantic link search
- `tweetVaultQueries.getTweet` - Full tweet with all links
- `tweetVaultQueries.vaultStats` - Vault statistics

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

## Alternative: Local Database Search

The `local-db-search` skill provides fast local queries if tweet-vault data is synced to local PostgreSQL:

- **Performance**: <40ms (faster than MCP server)
- **Offline**: Works without network
- **Database**: localhost:5432, database `elaway_kb`
- **Usage**: See `/Users/bigmac/agents/skills/local-db-search/SKILL.md`

**Note**: tweet-vault MCP provides semantic search (embeddings). Local-db-search provides fast keyword search.

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
        "CONVEX_URL": "https://utmost-gerbil-770.convex.cloud"
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
5. **Generate Embeddings**: OpenAI text-embedding-3-small (1536d) in Convex
6. **Store**: Upsert to Convex with vector indexes

## Daily Sync (Convex cron)

Cron jobs are defined in `/Users/bigmac/projects/personal/self-host/convex/crons.ts` and
call `tweetVault.processTweetVault` daily at 6 AM UTC.

## Tech Stack

- **Runtime**: Bun 1.2+, TypeScript 5.7
- **Database**: Convex
- **Embeddings**: OpenAI text-embedding-3-small (1536d)
- **Vector Index**: Convex vector index
- **Validation**: Zod
- **MCP**: @modelcontextprotocol/sdk

## Environment Variables

| Variable                    | Required | Description                          |
| --------------------------- | -------- | ------------------------------------ |
| `CONVEX_URL`                | Yes      | Convex deployment URL                |
| `CONVEX_DEPLOY_KEY`         | No       | Convex CLI deploy/run access         |
| `OPENAI_API_KEY`            | No       | Set in Convex env for embeddings     |

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
