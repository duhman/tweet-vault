# Twitter Bookmark Extraction Guide

Two methods to extract your Twitter/X bookmarks for import into Tweet Vault.

---

## Method 1: Playwright MCP (Recommended)

Uses Claude's browser automation to extract bookmarks directly.

### Prerequisites

1. Playwright MCP installed:

   ```bash
   claude mcp add playwright -- npx @playwright/mcp@latest
   ```

2. Logged into Twitter/X in your browser

### Extraction Steps

Ask Claude:

> "Use Playwright to navigate to x.com/i/bookmarks, then help me extract all my bookmarks by scrolling through the page and capturing the tweet data."

Claude will:

1. Open a browser and navigate to your bookmarks
2. You'll need to log in if not already authenticated
3. Claude will scroll through and capture tweet data
4. Export to JSON format

### Manual Playwright Workflow

If you prefer more control:

1. **Start browser session**:

   > "Open a Playwright browser and go to https://x.com/i/bookmarks"

2. **Authenticate** (if needed):

   > "I need to log in - please wait while I enter my credentials"

3. **Capture bookmarks**:

   > "Scroll through the bookmarks page slowly, and for each tweet visible, extract: the tweet ID (from the URL), author username, tweet text, and any links"

4. **Export data**:
   > "Save all captured tweets to a JSON file at ~/Downloads/bookmarks.json"

---

## Method 2: Twitter Web Exporter (Browser Extension)

A browser extension that intercepts Twitter's GraphQL API.

### Setup

1. Install [twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter):
   - Chrome: Install from releases or load unpacked
   - Firefox: Install from releases

2. Go to https://x.com/i/bookmarks

3. Open the extension popup

4. Scroll through ALL your bookmarks (the extension captures as you scroll)

5. Click "Export" → JSON format

6. Save the file

### Export Format

The extension exports in this format:

```json
[
  {
    "id": "1234567890",
    "user": {
      "screen_name": "username",
      "name": "Display Name"
    },
    "full_text": "Tweet content...",
    "created_at": "2024-01-15T10:30:00Z",
    "entities": {
      "urls": [...]
    }
  }
]
```

---

## Method 3: GraphQL Intercept (Manual DevTools)

For power users who want full control.

### Steps

1. Open https://x.com/i/bookmarks

2. Open DevTools (F12) → Network tab

3. Filter by "Bookmarks" in the search

4. Scroll through your bookmarks

5. For each `Bookmarks` GraphQL request:
   - Right-click → Copy → Copy response
   - Save to a file

6. Combine all responses into a single JSON array

### Processing GraphQL Responses

The GraphQL response structure:

```json
{
  "data": {
    "bookmark_timeline_v2": {
      "timeline": {
        "instructions": [
          {
            "entries": [
              {
                "content": {
                  "itemContent": {
                    "tweet_results": {
                      "result": {
                        "rest_id": "...",
                        "core": { "user_results": {...} },
                        "legacy": { "full_text": "..." }
                      }
                    }
                  }
                }
              }
            ]
          }
        ]
      }
    }
  }
}
```

---

## Importing to Tweet Vault

After extraction, import your bookmarks:

```bash
cd ~/projects/personal/tweet-vault
npm run import path/to/bookmarks.json
```

The import script handles multiple formats:

- Twitter Web Exporter JSON
- GraphQL intercept responses
- Custom exports with `id`, `author`, `text` fields

### What Happens During Import

1. **Parse**: Validates and normalizes tweet data
2. **Deduplicate**: Skips tweets already in database
3. **Extract Links**: Finds URLs in tweet content
4. **Fetch Metadata**: Gets title/description for each link
5. **Generate Embeddings**: Creates 1536d vectors via OpenAI
6. **Store**: Saves to Supabase with pgvector indexes

---

## Troubleshooting

### "No tweets found"

- Make sure the JSON file is valid
- Check if the format matches one of the supported types
- Try wrapping single tweets in an array: `[{...}]`

### Rate Limiting

- Link metadata + embeddings run via Edge Function (daily) or CLI
- Adjust batch sizes via `fetchAllLinkMetadata(batchSize)` and `processAllEmbeddings(concurrency)`

### Twitter Login Required

- Playwright can't bypass login
- Log in manually when the browser opens
- Consider using the browser extension method for easier auth
