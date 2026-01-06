import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

/**
 * Generate embedding for a single text using OpenAI text-embedding-3-small
 * Returns a 1536-dimensional vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAIClient();

  // Truncate to ~8000 tokens (roughly 32000 chars) to stay within limits
  const truncatedText = text.slice(0, 32000);

  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: truncatedText,
    dimensions: 1536,
  });

  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in batch
 * More efficient than individual calls for large datasets
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const client = getOpenAIClient();

  // OpenAI allows up to 2048 inputs per request
  const batchSize = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 32000));

    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
      dimensions: 1536,
    });

    allEmbeddings.push(...response.data.map((d) => d.embedding));
  }

  return allEmbeddings;
}

/**
 * Create a text representation of a tweet for embedding
 * Combines author, content, and any additional context
 */
export function createTweetEmbeddingText(tweet: {
  author_username: string;
  author_name?: string;
  content: string;
}): string {
  const authorInfo = tweet.author_name
    ? `${tweet.author_name} (@${tweet.author_username})`
    : `@${tweet.author_username}`;

  return `${authorInfo}: ${tweet.content}`;
}

/**
 * Create a text representation of a link for embedding
 * Combines title, description, and domain
 */
export function createLinkEmbeddingText(link: {
  title?: string;
  description?: string;
  domain?: string;
  url: string;
}): string {
  const parts: string[] = [];

  if (link.title) parts.push(link.title);
  if (link.description) parts.push(link.description);
  if (link.domain) parts.push(`Source: ${link.domain}`);

  // Fallback to URL if no other content
  if (parts.length === 0) {
    parts.push(link.url);
  }

  return parts.join("\n");
}
