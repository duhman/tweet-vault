# 🐦 Setting Up Likes Sync (Bird v0.7.0+)

**Status**: Ready to deploy  
**Time to setup**: 10 minutes  
**Requirements**: Supabase CLI, Bird 0.7.0+

---

## 📋 Setup Steps

### 1. Create the Likes Table

Run the SQL in your self-hosted Supabase:

```bash
# Option A: Via Supabase Dashboard
# 1. Go to SQL Editor
# 2. Copy sql/create-likes-table.sql
# 3. Click "Run"

# Option B: Via Supabase CLI
supabase db push --linked
```

SQL file location: `sql/create-likes-table.sql`

### 2. Deploy the Edge Function

```bash
# Make sure you're in the tweet-vault project
cd /Users/bigmac/projects/personal/tweet-vault

# Deploy the sync-likes function
supabase functions deploy sync-likes

# Verify deployment
supabase functions list
# Should show: sync-likes | https://srv1209224.hstgr.cloud/functions/v1/sync-likes
```

### 3. Configure Cron Job

Update your cron to use the new sync script:

**Clawdbot**: Update cron job to call:
```bash
bash /Users/bigmac/projects/personal/bird-mcp/sync-bookmarks-and-likes.sh
```

Schedule: **6 AM UTC daily**

### 4. Test the Sync

**Manual test**:
```bash
bash /Users/bigmac/projects/personal/bird-mcp/sync-bookmarks-and-likes.sh
```

**Check logs**:
```bash
tail -50 /Users/bigmac/projects/personal/bird-mcp/sync.log
```

**Verify in database**:
```bash
psql -h srv1209224.hstgr.cloud -U postgres -d postgres << EOF
SELECT COUNT(*) as like_count FROM twitter_likes;
SELECT * FROM twitter_likes LIMIT 5;
EOF
```

---

## 🎯 What Gets Synced

**Bookmarks**: Your bookmarked tweets
- Stored in: `tweets` table
- Updated: Daily at 6 AM UTC

**Likes** (NEW): Your liked tweets  
- Stored in: `twitter_likes` table
- Pagination: Syncs up to 10 pages (configurable)
- Updated: Daily at 6 AM UTC

**Both** include:
- Tweet ID, content, author
- Timestamps
- Metadata (metrics, raw API response)
- Vector embeddings for semantic search

---

## 🔄 Pagination Handling

The sync script handles pagination automatically:

```bash
# Fetch first page
bird likes --all --max-pages 1

# Script extracts cursor and fetches next page
# Repeats up to MAX_LIKES_PAGES (default: 10)

# Stores cursor in state file for next sync
```

**Configuration**:
```bash
# Change in sync script or environment:
export MAX_LIKES_PAGES=20  # Sync first 20 pages
bash sync-bookmarks-and-likes.sh
```

---

## 📊 Database Schema

### twitter_likes Table

| Column | Type | Purpose |
|--------|------|---------|
| id | BIGSERIAL | Auto-incrementing ID |
| tweet_id | TEXT UNIQUE | Twitter's tweet ID |
| content | TEXT | Full tweet text |
| author_id | TEXT | Tweet author's ID |
| author_name | TEXT | Author's display name |
| liked_at | TIMESTAMP | When you liked it |
| embedding | vector(1536) | Semantic search vector |
| metadata | JSONB | Raw metrics, API response |
| source | TEXT | Always "bird-cli" |
| synced_at | TIMESTAMP | Last sync time |
| created_at | TIMESTAMP | When record was created |

**Indexes**:
- `tweet_id` (unique, for upsert)
- `author_id` (fast filtering)
- `liked_at` (timeline queries)
- `synced_at` (recent syncs)
- `embedding` (semantic search - IVFFLAT)

---

## 🔍 Querying Likes

### Search Likes Semantically

```sql
-- Find likes about "AI" using embeddings
SELECT 
  tweet_id,
  content,
  author_name,
  1 - (embedding <=> embedding_query) as similarity
FROM twitter_likes
WHERE 1 - (embedding <=> embedding_query) > 0.7
ORDER BY similarity DESC
LIMIT 10;
```

### Find Likes by Author

```sql
SELECT content, liked_at
FROM twitter_likes
WHERE author_name = 'Jack Dorsey'
ORDER BY liked_at DESC;
```

### Recent Likes

```sql
SELECT tweet_id, content, author_name, liked_at
FROM twitter_likes
ORDER BY liked_at DESC
LIMIT 20;
```

### Combine Bookmarks + Likes

```sql
-- Find content liked AND bookmarked
SELECT 
  t.id,
  t.full_text,
  'bookmark' as source
FROM tweets t
WHERE t.tweet_id IN (
  SELECT DISTINCT tweet_id FROM twitter_likes
)
ORDER BY t.created_at DESC;
```

---

## 🚀 Using Tweet Vault MCP

Once synced, your likes are available via MCP:

```
search_tweets("my likes")          # Search bookmarks + likes
search_links("relevant topics")    # Find referenced links
vault_stats                        # Including likes count
```

---

## 📈 Monitoring Sync

### Check Sync State

```bash
cat /Users/bigmac/projects/personal/bird-mcp/.sync-state.json
```

Expected output:
```json
{
  "lastSync": "2026-01-12 06:00:00 UTC",
  "status": "success",
  "message": "Synced 150 bookmarks + 450 likes",
  "bookmarksCount": 150,
  "likesCount": 450,
  "totalCount": 600
}
```

### Monitor Logs

```bash
tail -f /Users/bigmac/projects/personal/bird-mcp/sync.log
```

### Cron Health

```bash
# In Clawdbot:
bash ~/.clawd/scripts/session-startup.sh
# Check "Twitter Bookmark Sync" job status
```

---

## ⚠️ Troubleshooting

### "Likes table not found"
- Run SQL: `sql/create-likes-table.sql`
- Verify in Supabase dashboard

### "sync-likes function not found"
- Deploy function: `supabase functions deploy sync-likes`
- Check: `supabase functions list`

### "bird likes: command not found"
- Upgrade Bird: `brew upgrade steipete/tap/bird`
- Verify: `bird --version` (should be 0.7.0+)

### Sync failed
- Check logs: `tail -50 sync.log`
- Verify credentials: `source .env.cloud && env | grep SUPABASE`
- Test Bird: `bird likes -n 5`

---

## 🎁 Pro Tips

### 1. Resume Interrupted Sync
Script automatically uses cursor to resume.

### 2. Adjust Page Limit
```bash
MAX_LIKES_PAGES=50 bash sync-bookmarks-and-likes.sh
```

### 3. Export Before Sync
```bash
bird likes --all --json > backup_likes_$(date +%s).json
```

### 4. Build Collections
After sync, group likes by topic:
```sql
CREATE VIEW ai_likes AS
SELECT * FROM twitter_likes
WHERE content ILIKE '%AI%'
   OR content ILIKE '%machine learning%';
```

---

## ✅ Deployment Checklist

- [ ] SQL table created
- [ ] Edge function deployed
- [ ] Cron job updated
- [ ] Test sync runs successfully
- [ ] Data appears in database
- [ ] Logs show "success"
- [ ] State file updates correctly
- [ ] MCP tools find likes

---

## 📞 References

**Sync Script**: `/Users/bigmac/projects/personal/bird-mcp/sync-bookmarks-and-likes.sh`  
**Schema**: `/Users/bigmac/projects/personal/tweet-vault/sql/create-likes-table.sql`  
**Edge Function**: `/Users/bigmac/projects/personal/tweet-vault/functions/sync-likes/`  
**Documentation**: `/Users/bigmac/agents/TWITTER-INTEGRATION.md`

---

**Status**: 🟢 Ready for deployment

Your likes will be synced daily and stored with embeddings for semantic search! 🐦
