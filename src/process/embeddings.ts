import OpenAI from "openai";
import {
  getTweetsWithoutEmbeddings,
  getLinksWithoutEmbeddings,
  updateTweetEmbedding,
  updateLinkEmbedding,
  Tweet,
  Link,
} from "../utils/supabase.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate embedding for text using OpenAI
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Create embedding text for a tweet
 */
function createTweetEmbeddingText(tweet: Tweet): string {
  const parts = [tweet.content];

  if (tweet.author_name) {
    parts.push(`Author: ${tweet.author_name} (@${tweet.author_username})`);
  } else {
    parts.push(`Author: @${tweet.author_username}`);
  }

  return parts.join("\n");
}

/**
 * Create embedding text for a link
 */
function createLinkEmbeddingText(link: Link): string {
  const parts = [];

  if (link.title) {
    parts.push(link.title);
  }

  if (link.description) {
    parts.push(link.description);
  }

  if (link.domain) {
    parts.push(`Domain: ${link.domain}`);
  }

  return parts.join("\n") || link.url;
}

/**
 * Process embeddings for tweets
 */
async function processTweetEmbeddings(
  batchSize: number,
): Promise<{ processed: number; failed: number }> {
  const tweets = await getTweetsWithoutEmbeddings(batchSize);

  if (tweets.length === 0) {
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const tweet of tweets) {
    try {
      const text = createTweetEmbeddingText(tweet);
      const embedding = await generateEmbedding(text);
      await updateTweetEmbedding(tweet.tweet_id, embedding);
      processed++;
    } catch (error) {
      console.error(`Failed to embed tweet ${tweet.tweet_id}:`, error);
      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Process embeddings for links
 */
async function processLinkEmbeddings(
  batchSize: number,
): Promise<{ processed: number; failed: number }> {
  const links = await getLinksWithoutEmbeddings(batchSize);

  if (links.length === 0) {
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const link of links) {
    try {
      const text = createLinkEmbeddingText(link);
      const embedding = await generateEmbedding(text);
      await updateLinkEmbedding(link.id!, embedding);
      processed++;
    } catch (error) {
      console.error(`Failed to embed link ${link.id}:`, error);
      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Process all pending embeddings (tweets and links)
 */
export async function processAllEmbeddings(concurrency = 3): Promise<{
  tweets: { processed: number; failed: number };
  links: { processed: number; failed: number };
}> {
  const batchSize = Math.max(5, concurrency * 10);

  let tweetStats = { processed: 0, failed: 0 };
  let linkStats = { processed: 0, failed: 0 };

  // Process tweets
  for (let round = 0; round < 50; round++) {
    const result = await processTweetEmbeddings(batchSize);
    tweetStats.processed += result.processed;
    tweetStats.failed += result.failed;

    if (result.processed === 0) break;
  }

  // Process links
  for (let round = 0; round < 50; round++) {
    const result = await processLinkEmbeddings(batchSize);
    linkStats.processed += result.processed;
    linkStats.failed += result.failed;

    if (result.processed === 0) break;
  }

  return {
    tweets: tweetStats,
    links: linkStats,
  };
}
