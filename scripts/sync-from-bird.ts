/**
 * Sync bookmarks and likes from Bird CLI to Tweet Vault.
 *
 * Usage:
 *   bun run scripts/sync-from-bird.ts
 *   bun run scripts/sync-from-bird.ts --all --max-pages=10
 *   bun run scripts/sync-from-bird.ts --likes-only --count=100
 */

import { config } from "dotenv";
import {
  TwitterClient,
  resolveCredentials,
  type TweetData,
  type SearchResult,
} from "@steipete/bird";
import { processTweets } from "../src/process/tweets.js";
import {
  extractLinksFromTweets,
  fetchAllLinkMetadata,
} from "../src/process/links.js";
import { processAllEmbeddings } from "../src/process/embeddings.js";
import {
  recordSync,
  upsertTweetInteractions,
  type InteractionType,
} from "../src/utils/supabase.js";
import { getEmbeddingProviderMetadata } from "../shared/processing.js";
import { fileURLToPath } from "url";

// override: true ensures project .env wins over stale shell exports
config({ override: true });

interface CliOptions {
  fetchAll: boolean;
  count: number;
  maxPages?: number;
  cursor?: string;
  bookmarksOnly: boolean;
  likesOnly: boolean;
  skipMetadata: boolean;
  skipEmbeddings: boolean;
  embedRounds: number;
}

interface TimelineFetchResult {
  kind: InteractionType;
  tweets: TweetData[];
  nextCursor?: string;
}

export function parseOptions(args: string[]): CliOptions {
  const fetchAll = args.includes("--all");
  const bookmarksOnly = args.includes("--bookmarks-only");
  const likesOnly = args.includes("--likes-only");

  if (bookmarksOnly && likesOnly) {
    throw new Error("Use only one of --bookmarks-only or --likes-only.");
  }

  const countArg = args.find((arg) => arg.startsWith("--count="));
  const maxPagesArg = args.find((arg) => arg.startsWith("--max-pages="));
  const cursorArg = args.find((arg) => arg.startsWith("--cursor="));
  const embedRoundsArg = args.find((arg) => arg.startsWith("--embed-rounds="));

  const count = countArg ? parseInt(countArg.split("=")[1], 10) : 50;
  const maxPages = maxPagesArg ? parseInt(maxPagesArg.split("=")[1], 10) : undefined;
  const cursor = cursorArg ? cursorArg.split("=")[1] : undefined;
  const embedRounds = embedRoundsArg
    ? parseInt(embedRoundsArg.split("=")[1], 10)
    : 5;

  return {
    fetchAll,
    count,
    maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
    cursor,
    bookmarksOnly,
    likesOnly,
    skipMetadata: args.includes("--skip-metadata"),
    skipEmbeddings: args.includes("--skip-embeddings"),
    embedRounds: Number.isFinite(embedRounds) ? embedRounds : 5,
  };
}

async function tryKeychain(): Promise<{ authToken: string; ct0: string } | null> {
  // Pull X/Twitter session cookies from macOS Keychain. These are the same
  // cookies that the /Users/workboi/bin/bird wrapper uses; storing them only
  // in Keychain (not in .env) keeps the secrets out of the dotfiles repo,
  // the redaction layer, and the cron secret scanner.
  //
  // Keychain service names follow the bird wrapper convention:
  //   last30days-AUTH_TOKEN
  //   last30days-CT0
  const user = process.env.USER || process.env.LOGNAME || "";
  if (!user || process.platform !== "darwin") return null;

  const { execFile } = await import("node:child_process");
  const read = (service: string): Promise<string | null> =>
    new Promise((resolve) => {
      execFile(
        "security",
        ["find-generic-password", "-a", user, "-s", service, "-w"],
        { timeout: 5_000, encoding: "utf8" },
        (err, stdout) => {
          if (err || !stdout) return resolve(null);
          const v = stdout.trim();
          resolve(v.length > 0 ? v : null);
        },
      );
    });

  const [authToken, ct0] = await Promise.all([
    read("last30days-AUTH_TOKEN"),
    read("last30days-CT0"),
  ]);
  if (authToken && ct0) return { authToken, ct0 };
  return null;
}

async function getClient(): Promise<TwitterClient> {
  let authToken = process.env.AUTH_TOKEN || process.env.TWITTER_AUTH_TOKEN;
  let ct0 = process.env.CT0 || process.env.TWITTER_CT0;

  if (!authToken || !ct0) {
    const fromKeychain = await tryKeychain();
    if (fromKeychain) {
      authToken = fromKeychain.authToken;
      ct0 = fromKeychain.ct0;
      // Mirror into env so any downstream tooling (Bird CLI calls, error
      // messages, child processes) sees the same values.
      process.env.AUTH_TOKEN = authToken;
      process.env.CT0 = ct0;
    }
  }

  if (authToken && ct0) {
    return new TwitterClient({
      cookies: { authToken, ct0 },
    });
  }

  console.log("  Extracting cookies from Safari...");
  const { cookies } = await resolveCredentials({ cookieSource: "safari" });
  return new TwitterClient({ cookies });
}

function toExportedTweet(tweet: TweetData): object {
  return {
    id: tweet.id,
    text: tweet.text,
    author: {
      username: tweet.author.username,
      name: tweet.author.name,
    },
    created_at: tweet.createdAt,
    media: tweet.media?.map((item) => item.url).filter(Boolean),
    metrics: {
      likes: tweet.likeCount,
      retweets: tweet.retweetCount,
      replies: tweet.replyCount,
    },
    raw: tweet._raw,
  };
}

async function fetchTimeline(
  client: TwitterClient,
  kind: InteractionType,
  options: CliOptions,
): Promise<TimelineFetchResult> {
  const timelineClient = client as any;
  let result: SearchResult;

  if (kind === "bookmark") {
    result = options.fetchAll
      ? await timelineClient.getAllBookmarks({
          maxPages: options.maxPages,
          cursor: options.cursor,
        })
      : await timelineClient.getBookmarks(options.count);
  } else {
    result = options.fetchAll
      ? await timelineClient.getAllLikes({
          maxPages: options.maxPages,
          cursor: options.cursor,
        })
      : await timelineClient.getLikes(options.count);
  }

  if (!result.success) {
    throw new Error(result.error || `Failed to fetch ${kind} timeline`);
  }

  return {
    kind,
    tweets: result.tweets,
    nextCursor: result.nextCursor,
  };
}

export async function main() {
  const options = parseOptions(process.argv.slice(2));

  console.log("🐦 Tweet Vault - Sync from Bird\n");

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

  const includeBookmarks = !options.likesOnly;
  const includeLikes = !options.bookmarksOnly;

  const timelineResults: TimelineFetchResult[] = [];

  console.log("Step 1/5: Fetching timelines from Twitter...");
  if (includeBookmarks) {
    const bookmarkResult = await fetchTimeline(client, "bookmark", options);
    timelineResults.push(bookmarkResult);
    console.log(
      `  ✅ Bookmarks fetched: ${bookmarkResult.tweets.length}${bookmarkResult.nextCursor ? " (next cursor available)" : ""}`,
    );
  }
  if (includeLikes) {
    const likesResult = await fetchTimeline(client, "like", options);
    timelineResults.push(likesResult);
    console.log(
      `  ✅ Likes fetched: ${likesResult.tweets.length}${likesResult.nextCursor ? " (next cursor available)" : ""}`,
    );
  }
  console.log();

  const allTweets = timelineResults.flatMap((result) => result.tweets);
  if (allTweets.length === 0) {
    console.log("No tweets found from selected timelines. Exiting.");
    return;
  }

  const byId = new Map<string, TweetData>();
  for (const tweet of allTweets) {
    byId.set(tweet.id, tweet);
  }

  const transformed = [...byId.values()].map(toExportedTweet);

  console.log("Step 2/5: Upserting canonical tweets + interactions...");
  const { added, skipped } = await processTweets(transformed);

  const bookmarks = timelineResults.find((result) => result.kind === "bookmark");
  const likes = timelineResults.find((result) => result.kind === "like");

  const bookmarkInteractions = (bookmarks?.tweets ?? []).map((tweet) => ({
    tweet_id: tweet.id,
    interaction_type: "bookmark" as const,
    interaction_at: tweet.createdAt,
    source: "bird/bookmarks",
    metadata: { cursor: bookmarks?.nextCursor ?? null },
  }));

  const likeInteractions = (likes?.tweets ?? []).map((tweet) => ({
    tweet_id: tweet.id,
    interaction_type: "like" as const,
    interaction_at: tweet.createdAt,
    source: "bird/likes",
    metadata: { cursor: likes?.nextCursor ?? null },
  }));

  const interactionResult = await upsertTweetInteractions([
    ...bookmarkInteractions,
    ...likeInteractions,
  ]);

  console.log(`  ✅ Canonical tweets added: ${added.length}`);
  console.log(`  ⏭️  Tweets updated/skipped: ${skipped}`);
  console.log(
    `  ✅ Interactions inserted: ${interactionResult.inserted}, updated: ${interactionResult.updated}\n`,
  );

  console.log("Step 3/5: Extracting links from newly added tweets...");
  const linkResult = await extractLinksFromTweets(added);
  console.log(`  ✅ Links inserted: ${linkResult.inserted}`);
  console.log(`  ⏭️  Links skipped: ${linkResult.skipped}\n`);

  let metadataResult = { processed: 0, failed: 0 };
  if (!options.skipMetadata) {
    console.log("Step 4/5: Fetching link metadata...");
    metadataResult = await fetchAllLinkMetadata(5, 50);
    console.log(`  ✅ Metadata fetched: ${metadataResult.processed}`);
    console.log(`  ❌ Metadata failed: ${metadataResult.failed}\n`);
  } else {
    console.log("Step 4/5: Skipped metadata fetching (--skip-metadata)\n");
  }

  let embeddingResult = {
    tweets: { processed: 0, failed: 0 },
    links: { processed: 0, failed: 0 },
  };
  if (!options.skipEmbeddings) {
    console.log("Step 5/5: Generating embeddings...");
    embeddingResult = await processAllEmbeddings({
      concurrency: 3,
      maxRounds: options.embedRounds,
      embedBatchSize: 15,
      batchSize: 60,
    });
    console.log(`  ✅ Tweets embedded: ${embeddingResult.tweets.processed}`);
    console.log(`  ✅ Links embedded: ${embeddingResult.links.processed}`);
    if (embeddingResult.tweets.failed || embeddingResult.links.failed) {
      console.log(
        `  ❌ Embedding failures: ${embeddingResult.tweets.failed} tweets, ${embeddingResult.links.failed} links`,
      );
    }
  } else {
    console.log("Step 5/5: Skipped embeddings (--skip-embeddings)");
  }

  await recordSync({
    last_sync_at: new Date().toISOString(),
    tweets_added: added.length,
    links_processed: linkResult.inserted,
    embeddings_generated:
      embeddingResult.tweets.processed + embeddingResult.links.processed,
    sync_type: "bird",
    metadata: {
      function_name: "sync-from-bird",
      schema: process.env.SUPABASE_SCHEMA || "tweet_vault",
      embedding: getEmbeddingProviderMetadata("openai"),
      provider: "openai",
      fetched_count: allTweets.length,
      fetched_total: allTweets.length,
      fetched_bookmarks: bookmarks?.tweets.length ?? 0,
      fetched_likes: likes?.tweets.length ?? 0,
      next_bookmark_cursor: bookmarks?.nextCursor ?? null,
      next_likes_cursor: likes?.nextCursor ?? null,
      fetch_mode: options.fetchAll ? "all" : `count:${options.count}`,
      max_pages: options.maxPages ?? null,
      interactions_inserted: interactionResult.inserted,
      interactions_updated: interactionResult.updated,
      metadata_processed: metadataResult.processed,
      metadata_failed: metadataResult.failed,
      tweets_embedded: embeddingResult.tweets.processed,
      links_embedded: embeddingResult.links.processed,
      errors_count:
        metadataResult.failed +
        embeddingResult.tweets.failed +
        embeddingResult.links.failed,
    },
  });

  console.log("\n🎉 Sync complete!");
  console.log(
    `   Added ${added.length} tweets, processed ${bookmarkInteractions.length + likeInteractions.length} interactions`,
  );
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
