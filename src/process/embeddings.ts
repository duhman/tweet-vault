import OpenAI from "openai";
import {
  getTweetsWithoutEmbeddings,
  getLinksWithoutEmbeddings,
  updateTweetEmbedding,
  updateLinkEmbedding,
  Tweet,
  Link,
} from "../utils/supabase.js";

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is missing or empty");
  }

  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_INPUT_CHARS = 8000;
const DEFAULT_RETRIES = 4;

interface EmbeddingOptions {
  concurrency?: number;
  batchSize?: number;
  embedBatchSize?: number;
  maxRounds?: number;
  maxInputChars?: number;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = DEFAULT_RETRIES,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= retries) break;
      const delayMs = Math.min(5000, 200 * 2 ** attempt);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function clampText(text: string, maxInputChars: number): string {
  if (text.length <= maxInputChars) return text;
  return text.slice(0, maxInputChars);
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await getOpenAIClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

function createTweetEmbeddingText(tweet: Tweet): string {
  const parts = [tweet.content];

  if (tweet.author_name) {
    parts.push(`Author: ${tweet.author_name} (@${tweet.author_username})`);
  } else {
    parts.push(`Author: @${tweet.author_username}`);
  }

  return parts.join("\n");
}

function createLinkEmbeddingText(link: Link): string {
  const parts: string[] = [];

  if (link.title) parts.push(link.title);
  if (link.description) parts.push(link.description);
  if (link.domain) parts.push(`Domain: ${link.domain}`);

  return parts.join("\n") || link.url;
}

async function processTweetEmbeddings(
  batchSize: number,
  embedBatchSize: number,
  maxInputChars: number,
): Promise<{ processed: number; failed: number }> {
  const tweets = await getTweetsWithoutEmbeddings(batchSize);
  if (tweets.length === 0) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < tweets.length; i += embedBatchSize) {
    const batch = tweets.slice(i, i + embedBatchSize);
    const texts = batch.map((tweet) =>
      clampText(createTweetEmbeddingText(tweet), maxInputChars),
    );

    try {
      const embeddings = await withRetry(() => generateEmbeddings(texts));
      for (let j = 0; j < batch.length; j += 1) {
        try {
          await updateTweetEmbedding(batch[j].tweet_id, embeddings[j]);
          processed += 1;
        } catch (error) {
          console.error(`Failed to persist tweet embedding ${batch[j].tweet_id}:`, error);
          failed += 1;
        }
      }
    } catch (error) {
      failed += batch.length;
      console.error("Failed to embed tweet batch:", error);
    }
  }

  return { processed, failed };
}

async function processLinkEmbeddings(
  batchSize: number,
  embedBatchSize: number,
  maxInputChars: number,
): Promise<{ processed: number; failed: number }> {
  const links = await getLinksWithoutEmbeddings(batchSize);
  if (links.length === 0) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < links.length; i += embedBatchSize) {
    const batch = links.slice(i, i + embedBatchSize);
    const texts = batch.map((link) =>
      clampText(createLinkEmbeddingText(link), maxInputChars),
    );

    try {
      const embeddings = await withRetry(() => generateEmbeddings(texts));
      for (let j = 0; j < batch.length; j += 1) {
        try {
          await updateLinkEmbedding(batch[j].id!, embeddings[j]);
          processed += 1;
        } catch (error) {
          console.error(`Failed to persist link embedding ${batch[j].id}:`, error);
          failed += 1;
        }
      }
    } catch (error) {
      failed += batch.length;
      console.error("Failed to embed link batch:", error);
    }
  }

  return { processed, failed };
}

export async function processAllEmbeddings(
  optionsOrConcurrency: number | EmbeddingOptions = 3,
): Promise<{
  tweets: { processed: number; failed: number };
  links: { processed: number; failed: number };
}> {
  const options: EmbeddingOptions =
    typeof optionsOrConcurrency === "number"
      ? { concurrency: optionsOrConcurrency }
      : optionsOrConcurrency;

  const concurrency = Math.max(1, options.concurrency ?? 3);
  const batchSize = Math.max(10, options.batchSize ?? concurrency * 20);
  const embedBatchSize = Math.max(1, options.embedBatchSize ?? Math.min(20, concurrency * 5));
  const maxRounds = Math.max(1, options.maxRounds ?? 10);
  const maxInputChars = Math.max(500, options.maxInputChars ?? MAX_INPUT_CHARS);

  const tweetStats = { processed: 0, failed: 0 };
  const linkStats = { processed: 0, failed: 0 };

  for (let round = 0; round < maxRounds; round += 1) {
    const result = await processTweetEmbeddings(
      batchSize,
      embedBatchSize,
      maxInputChars,
    );
    tweetStats.processed += result.processed;
    tweetStats.failed += result.failed;

    if (result.processed === 0) break;
  }

  for (let round = 0; round < maxRounds; round += 1) {
    const result = await processLinkEmbeddings(
      batchSize,
      embedBatchSize,
      maxInputChars,
    );
    linkStats.processed += result.processed;
    linkStats.failed += result.failed;

    if (result.processed === 0) break;
  }

  return {
    tweets: tweetStats,
    links: linkStats,
  };
}
