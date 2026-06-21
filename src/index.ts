import { readFileSync, existsSync } from "fs";
import { config } from "dotenv";
import { processTweets } from "./process/tweets.js";
import {
  extractLinksFromTweets,
  fetchAllLinkMetadata,
} from "./process/links.js";
import { processAllEmbeddings } from "./process/embeddings.js";
import { getStats, recordSync, upsertTweetInteractions } from "./utils/supabase.js";

// Load environment variables (override: true ensures project .env wins
// over stale shell exports like SUPABASE_SCHEMA=star_vault)
config({ override: true });

async function importFromFile(filePath: string): Promise<void> {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Reading tweets from ${filePath}...`);
  const content = readFileSync(filePath, "utf-8");
  let data: unknown[];

  try {
    data = JSON.parse(content);
    if (!Array.isArray(data)) {
      data = [data];
    }
  } catch (error) {
    console.error("Failed to parse JSON file:", error);
    process.exit(1);
  }

  console.log(`Found ${data.length} tweets to process`);

  // Process tweets
  const { added, skipped } = await processTweets(data);
  console.log(
    `Added ${added.length} new tweets, skipped ${skipped} duplicates`,
  );

  if (added.length > 0) {
    await upsertTweetInteractions(
      added.map((tweet) => ({
        tweet_id: tweet.tweet_id,
        interaction_type: "bookmark",
        interaction_at: tweet.created_at,
        source: "manual-import",
      })),
    );
  }

  // Extract links
  console.log("Extracting links from tweets...");
  const linkResult = await extractLinksFromTweets(added);
  console.log(
    `Inserted ${linkResult.inserted} links, skipped ${linkResult.skipped}`,
  );

  // Fetch link metadata
  console.log("Fetching link metadata...");
  const metadataResult = await fetchAllLinkMetadata(5, 50);
  console.log(
    `Fetched metadata for ${metadataResult.processed} links, ${metadataResult.failed} failed`,
  );

  // Generate embeddings
  console.log("Generating embeddings...");
  const embeddingResult = await processAllEmbeddings(3);
  console.log(
    `Embedded ${embeddingResult.tweets.processed} tweets, ${embeddingResult.links.processed} links`,
  );

  // Record sync
  await recordSync({
    last_sync_at: new Date().toISOString(),
    tweets_added: added.length,
    links_processed: linkResult.inserted,
    embeddings_generated:
      embeddingResult.tweets.processed + embeddingResult.links.processed,
    sync_type: "manual",
    metadata: {
      source_file: filePath,
      imported_items: data.length,
      metadata_processed: metadataResult.processed,
      metadata_failed: metadataResult.failed,
      tweet_embedding_failures: embeddingResult.tweets.failed,
      link_embedding_failures: embeddingResult.links.failed,
    },
  });

  console.log("\nSync complete!");
}

async function showStats(): Promise<void> {
  const stats = await getStats();
  console.log("\n📊 Tweet Vault Statistics\n");
  console.log(`Total tweets: ${stats.total_tweets}`);
  console.log(`Total links: ${stats.total_links}`);
  console.log(`Tweets with embeddings: ${stats.tweets_with_embeddings}`);
  console.log(`Links with embeddings: ${stats.links_with_embeddings}`);
  if (typeof stats.bookmarks_count === "number") {
    console.log(`Bookmarks: ${stats.bookmarks_count}`);
  }
  if (typeof stats.likes_count === "number") {
    console.log(`Likes: ${stats.likes_count}`);
  }

  if (stats.top_authors && stats.top_authors.length > 0) {
    console.log("\n👤 Top Authors:");
    for (const author of stats.top_authors.slice(0, 5)) {
      console.log(`  @${author}`);
    }
  }

  if (stats.top_domains && stats.top_domains.length > 0) {
    console.log("\n🔗 Top Domains:");
    for (const domain of stats.top_domains.slice(0, 5)) {
      console.log(`  ${domain}`);
    }
  }

  if (stats.last_sync) {
    console.log("\n🔄 Last Sync:");
    console.log(`  Time: ${stats.last_sync}`);
  }
}

async function processCommand(command: string, args: string[]): Promise<void> {
  switch (command) {
    case "import":
      if (!args[0]) {
        console.error("Usage: tweet-vault import <file.json>");
        process.exit(1);
      }
      await importFromFile(args[0]);
      break;

    case "process":
      console.log("Processing pending embeddings...");
      const result = await processAllEmbeddings(3);
      console.log(
        `Embedded ${result.tweets.processed} tweets, ${result.links.processed} links`,
      );
      break;

    case "fetch-links":
      console.log("Fetching link metadata...");
      const metadataResult = await fetchAllLinkMetadata(5, 50);
      console.log(
        `Fetched ${metadataResult.processed} links, ${metadataResult.failed} failed`,
      );
      break;

    case "stats":
      await showStats();
      break;

    case "help":
    default:
      console.log(`
Tweet Vault - Twitter Bookmarks Intelligence System

Commands:
  import <file.json>  Import tweets from JSON export
  process             Generate embeddings for pending tweets/links
  fetch-links         Fetch metadata for unfetched links
  stats               Show vault statistics
  help                Show this help message

Environment Variables:
  SUPABASE_URL              Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Supabase service role key
  OPENAI_API_KEY            OpenAI API key for embeddings
      `);
  }
}

// Main entry point
const [command = "help", ...args] = process.argv.slice(2);
processCommand(command, args).catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
