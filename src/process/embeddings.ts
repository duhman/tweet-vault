import pLimit from "p-limit";
import {
  Link,
  getTweetsWithoutEmbeddings,
  updateTweetEmbedding,
  updateLinkEmbedding,
  getSupabaseClient,
} from "../utils/supabase.js";
import {
  generateEmbedding,
  createTweetEmbeddingText,
  createLinkEmbeddingText,
} from "../utils/openai.js";

/**
 * Generate embeddings for tweets that don't have them yet
 */
export async function generateTweetEmbeddings(
  concurrency = 3,
  batchSize = 50,
): Promise<{ processed: number; failed: number }> {
  const limit = pLimit(concurrency);
  let processed = 0;
  let failed = 0;

  let tweets = await getTweetsWithoutEmbeddings(batchSize);

  while (tweets.length > 0) {
    console.log(`Processing ${tweets.length} tweets without embeddings...`);

    const tasks = tweets.map((tweet) =>
      limit(async () => {
        try {
          const text = createTweetEmbeddingText(tweet);
          const embedding = await generateEmbedding(text);
          await updateTweetEmbedding(tweet.id!, embedding);
          processed++;
        } catch (error) {
          console.error(`Failed to embed tweet ${tweet.id}:`, error);
          failed++;
        }
      }),
    );

    await Promise.all(tasks);
    console.log(`Embedded ${processed} tweets so far, ${failed} failed`);

    // Get next batch
    tweets = await getTweetsWithoutEmbeddings(batchSize);
  }

  return { processed, failed };
}

/**
 * Generate embeddings for links that have metadata but no embedding
 */
export async function generateLinkEmbeddings(
  concurrency = 3,
  batchSize = 50,
): Promise<{ processed: number; failed: number }> {
  const client = getSupabaseClient();
  const limit = pLimit(concurrency);
  let processed = 0;
  let failed = 0;

  // Get links with metadata but no embedding
  const { data: links, error } = await client
    .from("links")
    .select("*")
    .is("embedding", null)
    .not("title", "is", null)
    .limit(batchSize);

  if (error) {
    throw new Error(`Failed to get links: ${error.message}`);
  }

  if (!links || links.length === 0) {
    return { processed, failed };
  }

  console.log(`Processing ${links.length} links without embeddings...`);

  const tasks = (links as Link[]).map((link) =>
    limit(async () => {
      try {
        const text = createLinkEmbeddingText(link);
        const embedding = await generateEmbedding(text);
        await updateLinkEmbedding(link.id!, embedding);
        processed++;
      } catch (error) {
        console.error(`Failed to embed link ${link.id}:`, error);
        failed++;
      }
    }),
  );

  await Promise.all(tasks);
  console.log(`Embedded ${processed} links, ${failed} failed`);

  return { processed, failed };
}

/**
 * Process all pending embeddings (tweets and links)
 */
export async function processAllEmbeddings(concurrency = 3): Promise<{
  tweets: { processed: number; failed: number };
  links: { processed: number; failed: number };
}> {
  console.log("Generating tweet embeddings...");
  const tweets = await generateTweetEmbeddings(concurrency);

  console.log("Generating link embeddings...");
  const links = await generateLinkEmbeddings(concurrency);

  return { tweets, links };
}
