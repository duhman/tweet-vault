import { ConvexHttpClient } from "convex/browser";
import { api } from "./convexApi.js";

export interface Tweet {
  id?: string;
  tweet_id: string;
  author_username: string;
  author_name?: string;
  author_profile_image?: string;
  content: string;
  created_at?: string;
  media_urls?: string[];
  metrics?: Record<string, number>;
  raw_data?: Record<string, unknown>;
  fetched_at?: string;
  processed_at?: string;
}

export interface Link {
  id?: string;
  tweet_id: string;
  url: string;
  expanded_url?: string;
  display_url?: string;
  domain?: string;
}

export interface SyncStateInput {
  last_sync_at: string;
  tweets_added: number;
  links_processed: number;
  embeddings_generated: number;
  sync_type: string;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

export interface TweetVaultStats {
  total_tweets: number;
  total_links: number;
  tweets_with_embeddings: number;
  links_with_embeddings: number;
  top_authors: string[];
  top_domains: string[];
  last_sync: string | null;
}

let convexClient: ConvexHttpClient | null = null;

export function getConvexClient(): ConvexHttpClient {
  if (convexClient) return convexClient;
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error("Missing CONVEX_URL environment variable");
  }
  convexClient = new ConvexHttpClient(url);
  return convexClient;
}

export async function upsertTweets(
  tweets: Tweet[],
): Promise<{ added: string[]; updated: string[] }> {
  const convex = getConvexClient();
  return convex.mutation(api.tweetVaultMutations.upsertTweets, { tweets });
}

export async function upsertLinks(
  links: Link[],
): Promise<{ inserted: number; updated: number }> {
  const convex = getConvexClient();
  return convex.mutation(api.tweetVaultMutations.upsertLinks, { links });
}

export async function recordSync(state: SyncStateInput): Promise<void> {
  const convex = getConvexClient();
  await convex.mutation(api.tweetVaultMutations.recordSync, state);
}

export async function getStats(): Promise<TweetVaultStats> {
  const convex = getConvexClient();
  return convex.query(api.tweetVaultQueries.vaultStats, {});
}

export async function runProcessing(args: {
  tweetLimit?: number;
  likeLimit?: number;
  linkMetaLimit?: number;
  linkEmbedLimit?: number;
}): Promise<{
  tweets_embedded: number;
  likes_embedded: number;
  links_metadata_fetched: number;
  links_embedded: number;
  errors: string[];
}> {
  const convex = getConvexClient();
  return convex.action(api.tweetVault.processTweetVault, args);
}
