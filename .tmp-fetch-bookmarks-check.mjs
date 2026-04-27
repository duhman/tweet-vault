import { TwitterClient, resolveCredentials } from '@steipete/bird';
const targetIds = new Set(process.argv.slice(2));
const { cookies } = await resolveCredentials({ cookieSource: 'safari' });
const client = new TwitterClient({ cookies });
const result = await client.getAllBookmarks({ maxPages: 8 });
if (!result.success) {
  console.error(result.error || 'failed');
  process.exit(1);
}
const found = result.tweets.filter(t => targetIds.has(String(t.id)));
console.log(JSON.stringify({ fetched: result.tweets.length, found }, null, 2));
