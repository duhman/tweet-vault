---
description: Extract Twitter/X bookmarks using Playwright browser automation
---

# Extract Twitter Bookmarks

Use Playwright MCP to extract bookmarks from Twitter/X.

## Workflow

1. **Launch browser**: Navigate to `https://x.com/i/bookmarks`

2. **Wait for login**: If not authenticated, pause and let user log in manually

3. **Scroll and capture**:
   - Scroll slowly through the bookmarks page
   - For each visible tweet, extract:
     - Tweet ID (from the article's data attributes or link URL)
     - Author username and display name
     - Tweet text content
     - Any media URLs
     - Any links in the tweet
     - Engagement metrics (likes, retweets, replies)

4. **Export to JSON**: Save captured tweets to `~/Downloads/tweet-vault-export.json`

5. **Import to database**: Run the import command:
   ```bash
   cd ~/projects/personal/tweet-vault
   npm run import ~/Downloads/tweet-vault-export.json
   ```

## Tweet Data Structure

```json
{
  "id": "1234567890123456789",
  "author_username": "username",
  "author_name": "Display Name",
  "content": "Tweet text content...",
  "created_at": "2024-01-15T10:30:00Z",
  "media_urls": ["https://..."],
  "metrics": {
    "likes": 42,
    "retweets": 10,
    "replies": 5
  },
  "entities": {
    "urls": [
      {
        "url": "https://t.co/abc",
        "expanded_url": "https://example.com/article"
      }
    ]
  }
}
```

## Extraction Script (for Playwright)

When extracting tweets from the page, use JavaScript like:

```javascript
const tweets = [];
document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
  const links = article.querySelectorAll('a[href*="/status/"]');
  const tweetLink = Array.from(links).find((a) => a.href.includes("/status/"));
  const tweetId = tweetLink?.href.match(/status\/(\d+)/)?.[1];

  const username = article.querySelector('a[href^="/"]')?.href.split("/")[3];
  const text = article.querySelector('[data-testid="tweetText"]')?.innerText;

  if (tweetId && text) {
    tweets.push({
      id: tweetId,
      author_username: username,
      content: text,
      created_at: new Date().toISOString(),
    });
  }
});
console.log(JSON.stringify(tweets, null, 2));
```

## Notes

- Twitter requires authentication - can't bypass login
- Scroll slowly to allow tweets to load
- GraphQL intercept method captures more complete data
- For large bookmark collections, consider the browser extension method
