/**
 * Transform DOM-extracted bookmarks to the expected schema format
 *
 * Input format:  { id, content, created_at, author: "Name@username·Date" }
 * Output format: { id, text, created_at, author: { username, name } }
 */

import { readFileSync, writeFileSync } from "fs";

interface DOMExtractedTweet {
  id: string;
  content: string;
  created_at: string;
  author: string;
}

interface ExportedTweet {
  id: string;
  text: string;
  created_at?: string;
  author: {
    username: string;
    name?: string;
  };
}

function parseAuthor(authorString: string): {
  username: string;
  name?: string;
} {
  // Format: "Display Name@username·Sep 2, 2025" or "Name@username·Date"
  // Some may have multiple @s or special characters

  // Find the @ that precedes the username (last @ before ·)
  const dotIndex = authorString.indexOf("·");
  const relevantPart =
    dotIndex > 0 ? authorString.substring(0, dotIndex) : authorString;

  // Find the last @ which separates name from username
  const atIndex = relevantPart.lastIndexOf("@");

  if (atIndex === -1) {
    // No @ found, use whole string as username
    return { username: relevantPart.trim(), name: undefined };
  }

  const name = relevantPart.substring(0, atIndex).trim();
  const username = relevantPart.substring(atIndex + 1).trim();

  return {
    username: username || "unknown",
    name: name || undefined,
  };
}

function transformTweet(tweet: DOMExtractedTweet): ExportedTweet {
  const { username, name } = parseAuthor(tweet.author);

  return {
    id: tweet.id,
    text: tweet.content,
    created_at: tweet.created_at || undefined,
    author: {
      username,
      name,
    },
  };
}

function main() {
  const inputPath = process.argv[2] || "bookmarks.json";
  const outputPath = process.argv[3] || "bookmarks-transformed.json";

  console.log(`📖 Reading: ${inputPath}`);
  const content = readFileSync(inputPath, "utf-8");
  const tweets: DOMExtractedTweet[] = JSON.parse(content);

  console.log(`🔄 Transforming ${tweets.length} tweets...`);

  const transformed: ExportedTweet[] = [];
  let errors = 0;

  for (const tweet of tweets) {
    try {
      transformed.push(transformTweet(tweet));
    } catch (error) {
      console.error(`Failed to transform tweet ${tweet.id}:`, error);
      errors++;
    }
  }

  console.log(`✅ Transformed: ${transformed.length}`);
  if (errors > 0) {
    console.log(`❌ Errors: ${errors}`);
  }

  writeFileSync(outputPath, JSON.stringify(transformed, null, 2));
  console.log(`💾 Saved to: ${outputPath}`);

  // Show sample
  console.log("\n📋 Sample transformed tweet:");
  console.log(JSON.stringify(transformed[0], null, 2));
}

main();
