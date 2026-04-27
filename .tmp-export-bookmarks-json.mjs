import { TwitterClient, resolveCredentials } from '@steipete/bird';
import fs from 'fs';
const { cookies } = await resolveCredentials({ cookieSource: 'safari' });
const client = new TwitterClient({ cookies });
const result = await client.getAllBookmarks({ maxPages: 20 });
if (!result.success) {
  console.error(result.error || 'failed');
  process.exit(1);
}
fs.writeFileSync('/Users/minimac/projects/tweet-vault/.tmp-bookmarks.json', JSON.stringify(result.tweets, null, 2));
console.log(`fetched=${result.tweets.length}`);
