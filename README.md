# 🐦 Tweet Vault

**Twitter Bookmarks Intelligence System** — Capture your bookmarked tweets, extract links, generate embeddings, and search them semantically via Claude MCP.

Ever bookmark interesting tweets and never find them again? Tweet Vault makes your Twitter/X bookmarks searchable with natural language queries like _"that thread about system design"_ or _"AI tools someone recommended"_.

## Features

- 🔍 **Semantic Search** — Find tweets and links by meaning, not just keywords
- 🔗 **Link Extraction** — Automatically extracts and indexes URLs with metadata
- 🤖 **Claude MCP Integration** — Query your bookmarks directly from Claude
- 🐦 **Bird CLI Integration** — Sync bookmarks automatically from Twitter
- ⏰ **Daily Sync** — Automatically processes new bookmarks via Convex cron
- 🧠 **Smart Embeddings** — OpenAI text-embedding-3-small (1536 dimensions)
- ⚡ **Fast Vector Search** — Convex vector index

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        Data Ingestion                          │
├────────────────────────────────────────────────────────────────┤
│  Bird CLI ────┐                                                │
│  (automated)  │                                                │
│               ├──→ Processing Pipeline ──→ Convex              │
│  JSON Export ─┘    (dedupe, links,              ↓              │
│  (manual)          embeddings)           MCP Server → Claude   │
└────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.2+
- [Convex](https://docs.convex.dev) deployment (self-host project)
- [OpenAI API key](https://platform.openai.com/api-keys) (set in Convex env)
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

Convex schema and cron jobs live in `/Users/bigmac/projects/personal/self-host/convex/`.
Deploy with:

```bash
cd /Users/bigmac/projects/personal/self-host
CONVEX_DEPLOY_KEY="$(cat .convex-deploy-key)" npx convex deploy
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
        "CONVEX_URL": "https://utmost-gerbil-770.convex.cloud"
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
| `bun run process`       | Generate pending embeddings (Convex)     |
| `bun run mcp`           | Run MCP server standalone                |
| `bun run typecheck`     | TypeScript type checking                 |

## Environment Variables

| Variable             | Required | Description                                   |
| -------------------- | -------- | --------------------------------------------- |
| `CONVEX_URL`         | Yes      | Convex deployment URL                         |
| `CONVEX_DEPLOY_KEY`  | No       | Needed for CLI deploy/run in self-host project|
| `OPENAI_API_KEY`     | No       | Set in Convex env for embeddings              |
| `TWITTER_AUTH_TOKEN`        | No       | Twitter session cookie (for direct API) |
| `TWITTER_CT0`               | No       | Twitter CSRF token (for direct API)     |

## Database Schema

### Tables

| Table        | Purpose                                        |
| ------------ | ---------------------------------------------- |
| `tweets`     | Bookmarked tweets with metadata and embeddings |
| `links`      | Extracted URLs with og:tags and embeddings     |
| `sync_state` | Sync history and statistics                    |

### Key Functions (Convex)

- `tweetVaultQueries.searchTweets` — Semantic tweet search
- `tweetVaultQueries.searchLinks` — Semantic link search
- `tweetVaultQueries.getTweet` — Full tweet with extracted links
- `tweetVaultQueries.vaultStats` — Vault statistics

## Processing Pipeline

1. **Parse** — Read exported JSON, validate with Zod schemas
2. **Deduplicate** — Check against existing tweet_ids
3. **Extract Links** — Parse URLs from tweet content and entities
4. **Fetch Metadata** — GET each URL, extract og:title, og:description
5. **Generate Embeddings** — OpenAI text-embedding-3-small (1536d)
6. **Store** — Upsert to Convex with vector indexes

## Bookmark Extraction Methods

| Method                 | Best For          | Auth Required |
| ---------------------- | ----------------- | ------------- |
| **Bird CLI**           | Automated sync    | Safari login  |
| **Browser Extension**  | One-time export   | Logged in     |
| **DevTools Intercept** | Power users       | Logged in     |
| **Playwright MCP**     | Claude automation | Manual login  |

See [docs/EXTRACTION.md](docs/EXTRACTION.md) for step-by-step instructions.

## Automated Daily Sync

Automated sync runs via Convex cron in `convex/crons.ts` (6 AM UTC), calling
`tweetVault.processTweetVault`.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) 1.2+
- **Language**: TypeScript 5.7
- **Database**: [Convex](https://docs.convex.dev)
- **Embeddings**: OpenAI text-embedding-3-small (1536d)
- **Vector Index**: Convex vector index
- **Validation**: [Zod](https://zod.dev)
- **MCP**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Twitter Sync**: [Bird CLI](https://github.com/steipete/bird)

## Related Projects

- [Star Vault](https://github.com/duhman/star-vault) — Same concept for GitHub stars
- [Bird CLI](https://github.com/steipete/bird) — Twitter/X CLI tool used for sync

## License

MIT
