/**
 * Sync bookmarks from Bird CLI to Tweet Vault
 *
 * Replaces manual JSON export workflow by fetching bookmarks directly
 * from Twitter via Bird's GraphQL API.
 *
 * Usage: npx tsx scripts/sync-from-bird.ts [--all] [--count=N]
 */

import { config } from "dotenv";
import { TwitterClient, resolveCredentials } from "@steipete/bird";
import { processTweets } from "../src/process/tweets.js";
import {
  extractLinksFromTweets,
  fetchAllLinkMetadata,
} from "../src/process/links.js";
import { processAllEmbeddings } from "../src/process/embeddings.js";
import { recordSync } from "../src/utils/supabase.js";

config();

interface TweetData {
  id: string;
  text: string;
  author: { username: string; name: string };
  authorId?: string;
  createdAt: string;
  replyCount: number;
  retweetCount: number;
  likeCount: number;
  conversationId?: string;
  inReplyToStatusId?: string;
  quotedTweet?: TweetData;
}

async function getClient(): Promise<TwitterClient> {
  const authToken = process.env.AUTH_TOKEN || process.env.TWITTER_AUTH_TOKEN;
  const ct0 = process.env.CT0 || process.env.TWITTER_CT0;

  if (authToken && ct0) {
    return new TwitterClient({
      cookies: { auth_token: authToken, ct0 },
    });
  }

  // Fall back to Safari cookie extraction
  console.log("  Extracting cookies from Safari...");
  const { cookies } = await resolveCredentials({ cookieSource: "safari" });
  return new TwitterClient({ cookies });
}

function transformBirdTweet(tweet: TweetData): object {
  return {
    id: tweet.id,
    text: tweet.text,
    author: {
      username: tweet.author.username,
      name: tweet.author.name,
    },
    author_id: tweet.authorId,
    created_at: tweet.createdAt,
    public_metrics: {
      reply_count: tweet.replyCount,
      retweet_count: tweet.retweetCount,
      like_count: tweet.likeCount,
    },
    conversation_id: tweet.conversationId,
    in_reply_to_status_id: tweet.inReplyToStatusId,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const fetchAll = args.includes("--all");
  const countArg = args.find((a) => a.startsWith("--count="));
  const count = countArg ? parseInt(countArg.split("=")[1], 10) : 50;

  console.log("🐦 Tweet Vault - Sync from Bird\n");

  // Step 0: Initialize Bird client
  console.log("Step 0: Connecting to Twitter...");
  let client: TwitterClient;
  try {
    client = await getClient();
    const user = await client.getCurrentUser();
    if (!user.success || !user.user) {
      throw new Error("Could not authenticate with Twitter");
    }
    console.log(`  ✅ Authenticated as @${user.user.username}\n`);
  } catch (error) {
    console.error("  ❌ Failed to connect to Twitter");
    console.error("     Make sure you're logged into Twitter in Safari,");
    console.error("     or set AUTH_TOKEN and CT0 environment variables.");
    if (error instanceof Error) {
      console.error(`\n     Error: ${error.message}`);
    }
    process.exit(1);
  }

  // Step 1: Fetch bookmarks from Bird
  console.log(
    `Step 1/5: Fetching bookmarks from Twitter${fetchAll ? " (all)" : ` (${count})`}...`,
  );
  let bookmarks: TweetData[];
  try {
    const result = fetchAll
      ? await client.getAllBookmarks()
      : await client.getBookmarks(count);

    if (!result.success) {
      throw new Error(result.error || "Failed to fetch bookmarks");
    }

    bookmarks = result.tweets as TweetData[];
    console.log(`  ✅ Fetched ${bookmarks.length} bookmarks\n`);
  } catch (error) {
    console.error("  ❌ Failed to fetch bookmarks:", error);
    process.exit(1);
  }

  if (bookmarks.length === 0) {
    console.log("No bookmarks found. Exiting.");
    return;
  }

  // Transform to expected format
  const transformed = bookmarks.map(transformBirdTweet);

  // Step 2: Process tweets (dedupe + insert)
  console.log("Step 2/5: Processing tweets...");
  const { added, skipped } = await processTweets(transformed);
  console.log(`  ✅ Added ${added.length} new tweets`);
  console.log(`  ⏭️  Skipped ${skipped} duplicates\n`);

  if (added.length === 0) {
    console.log("No new tweets to process. Already up to date!");
    return;
  }

  // Step 3: Extract links
  console.log("Step 3/5: Extracting links from tweets...");
  const linkResult = await extractLinksFromTweets(added);
  console.log(`  ✅ Inserted ${linkResult.inserted} links`);
  console.log(`  ⏭️  Skipped ${linkResult.skipped} (duplicates/filtered)\n`);

  // Step 4: Fetch link metadata
  console.log("Step 4/5: Fetching link metadata...");
  const metadataResult = await fetchAllLinkMetadata(5, 50);
  console.log(`  ✅ Fetched metadata for ${metadataResult.processed} links`);
  console.log(`  ❌ Failed: ${metadataResult.failed}\n`);

  // Step 5: Generate embeddings
  console.log("Step 5/5: Generating embeddings...");
  const embeddingResult = await processAllEmbeddings(3);
  console.log(`  ✅ Embedded ${embeddingResult.tweets.processed} tweets`);
  console.log(`  ✅ Embedded ${embeddingResult.links.processed} links`);
  if (embeddingResult.tweets.failed || embeddingResult.links.failed) {
    console.log(
      `  ❌ Failed: ${embeddingResult.tweets.failed} tweets, ${embeddingResult.links.failed} links`,
    );
  }

  // Record sync
  await recordSync({
    last_sync_at: new Date().toISOString(),
    tweets_added: added.length,
    links_processed: linkResult.inserted,
    embeddings_generated:
      embeddingResult.tweets.processed + embeddingResult.links.processed,
    sync_type: "bird",
    metadata: {
      fetched: bookmarks.length,
      fetch_mode: fetchAll ? "all" : `count:${count}`,
    },
  });

  console.log("\n🎉 Sync complete!");
  console.log(`   ${added.length} new bookmarks processed`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
