/**
 * Initial import script for bulk loading bookmarks
 * Supports both GraphQL intercept format and browser extension export format
 *
 * Usage: npx tsx scripts/initial-import.ts <file.json>
 */

import { readFileSync, existsSync } from "fs";
import { config } from "dotenv";
import { processTweets } from "../src/process/tweets.js";
import {
  extractLinksFromTweets,
  fetchAllLinkMetadata,
} from "../src/process/links.js";
import { processAllEmbeddings } from "../src/process/embeddings.js";
import { recordSync } from "../src/utils/supabase.js";

config();

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: npx tsx scripts/initial-import.ts <file.json>");
    console.error("\nSupported formats:");
    console.error("  - Twitter GraphQL intercept (Playwright/DevTools)");
    console.error("  - twitter-web-exporter JSON export");
    console.error("  - Custom export with id, author, text fields");
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log("🐦 Tweet Vault - Initial Import\n");
  console.log(`📁 Reading: ${filePath}`);

  const content = readFileSync(filePath, "utf-8");
  let data: unknown[];

  try {
    const parsed = JSON.parse(content);
    // Handle various export formats
    if (Array.isArray(parsed)) {
      data = parsed;
    } else if (parsed.bookmarks && Array.isArray(parsed.bookmarks)) {
      data = parsed.bookmarks;
    } else if (parsed.data && Array.isArray(parsed.data)) {
      data = parsed.data;
    } else {
      data = [parsed];
    }
  } catch (error) {
    console.error("Failed to parse JSON:", error);
    process.exit(1);
  }

  console.log(`📊 Found ${data.length} items to process\n`);

  // Step 1: Process tweets
  console.log("Step 1/4: Processing tweets...");
  const { added, skipped } = await processTweets(data);
  console.log(`  ✅ Added ${added.length} new tweets`);
  console.log(`  ⏭️  Skipped ${skipped} duplicates\n`);

  if (added.length === 0) {
    console.log("No new tweets to process. Exiting.");
    return;
  }

  // Step 2: Extract links
  console.log("Step 2/4: Extracting links from tweets...");
  const linkResult = await extractLinksFromTweets(added);
  console.log(`  ✅ Inserted ${linkResult.inserted} links`);
  console.log(`  ⏭️  Skipped ${linkResult.skipped} (duplicates or filtered)\n`);

  // Step 3: Fetch link metadata
  console.log("Step 3/4: Fetching link metadata...");
  console.log("  (This may take a while for many links)");
  const metadataResult = await fetchAllLinkMetadata(5, 50);
  console.log(`  ✅ Fetched metadata for ${metadataResult.processed} links`);
  console.log(`  ❌ Failed: ${metadataResult.failed}\n`);

  // Step 4: Generate embeddings
  console.log("Step 4/4: Generating embeddings...");
  console.log("  (Using OpenAI text-embedding-3-small)");
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
    sync_type: "manual",
    metadata: {
      source_file: filePath,
      total_items: data.length,
    },
  });

  console.log("\n🎉 Import complete!");
  console.log("\nNext steps:");
  console.log("  1. Add MCP server to ~/.claude/settings.json");
  console.log("  2. Restart Claude Code");
  console.log("  3. Use search_tweets and find_related tools");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
