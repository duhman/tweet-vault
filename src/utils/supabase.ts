import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Database types
export interface Tweet {
  id?: number;
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
  embedding?: number[];
}

export interface Link {
  id?: number;
  tweet_id: number;
  url: string;
  expanded_url?: string;
  display_url?: string;
  title?: string;
  description?: string;
  og_image?: string;
  domain?: string;
  content_type?: string;
  fetched_at?: string;
  fetch_error?: string;
  embedding?: number[];
}

export interface SyncState {
  id?: number;
  last_sync_at: string;
  tweets_added: number;
  links_processed: number;
  embeddings_generated: number;
  sync_type: "manual" | "scheduled" | "incremental";
  error_message?: string;
  metadata?: Record<string, unknown>;
}

export interface TweetVaultStats {
  total_tweets: number;
  total_links: number;
  tweets_with_embeddings: number;
  links_with_embeddings: number;
  top_authors: Array<{ author_username: string; tweet_count: number }>;
  top_domains: Array<{ domain: string; link_count: number }>;
  last_sync: SyncState | null;
}

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY environment variables",
    );
  }

  supabaseClient = createClient(url, key);
  return supabaseClient;
}

// Tweet operations
export async function upsertTweet(tweet: Tweet): Promise<Tweet> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("tweets")
    .upsert(tweet, { onConflict: "tweet_id" })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert tweet: ${error.message}`);
  return data;
}

export async function upsertTweets(tweets: Tweet[]): Promise<Tweet[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("tweets")
    .upsert(tweets, { onConflict: "tweet_id" })
    .select();

  if (error) throw new Error(`Failed to upsert tweets: ${error.message}`);
  return data;
}

export async function getTweetByTweetId(
  tweetId: string,
): Promise<Tweet | null> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("tweets")
    .select("*")
    .eq("tweet_id", tweetId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to get tweet: ${error.message}`);
  }
  return data;
}

export async function getTweetsWithoutEmbeddings(
  limit = 100,
): Promise<Tweet[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("tweets")
    .select("*")
    .is("embedding", null)
    .order("fetched_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to get tweets: ${error.message}`);
  return data;
}

export async function updateTweetEmbedding(
  id: number,
  embedding: number[],
): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from("tweets")
    .update({ embedding, processed_at: new Date().toISOString() })
    .eq("id", id);

  if (error)
    throw new Error(`Failed to update tweet embedding: ${error.message}`);
}

// Link operations
export async function insertLinks(links: Omit<Link, "id">[]): Promise<Link[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.from("links").insert(links).select();

  if (error) throw new Error(`Failed to insert links: ${error.message}`);
  return data;
}

export async function getLinksWithoutMetadata(limit = 100): Promise<Link[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("links")
    .select("*")
    .is("fetched_at", null)
    .is("fetch_error", null)
    .limit(limit);

  if (error) throw new Error(`Failed to get links: ${error.message}`);
  return data;
}

export async function updateLinkMetadata(
  id: number,
  metadata: Partial<Link>,
): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from("links")
    .update({ ...metadata, fetched_at: new Date().toISOString() })
    .eq("id", id);

  if (error)
    throw new Error(`Failed to update link metadata: ${error.message}`);
}

export async function updateLinkEmbedding(
  id: number,
  embedding: number[],
): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from("links")
    .update({ embedding })
    .eq("id", id);

  if (error)
    throw new Error(`Failed to update link embedding: ${error.message}`);
}

// Search operations
export async function searchTweets(
  embedding: number[],
  matchThreshold = 0.7,
  matchCount = 10,
): Promise<Array<Tweet & { similarity: number }>> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("search_tweets", {
    query_embedding: embedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error) throw new Error(`Failed to search tweets: ${error.message}`);
  return data;
}

export async function searchLinks(
  embedding: number[],
  matchThreshold = 0.7,
  matchCount = 10,
): Promise<Array<Link & { similarity: number }>> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("search_links", {
    query_embedding: embedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error) throw new Error(`Failed to search links: ${error.message}`);
  return data;
}

// Stats operations
export async function getStats(): Promise<TweetVaultStats> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("get_tweet_vault_stats");

  if (error) throw new Error(`Failed to get stats: ${error.message}`);
  return data;
}

// Sync state operations
export async function recordSync(state: Omit<SyncState, "id">): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from("sync_state").insert(state);

  if (error) throw new Error(`Failed to record sync: ${error.message}`);
}

export async function getExistingTweetIds(): Promise<Set<string>> {
  const client = getSupabaseClient();
  const { data, error } = await client.from("tweets").select("tweet_id");

  if (error)
    throw new Error(`Failed to get existing tweet IDs: ${error.message}`);
  return new Set(data.map((t) => t.tweet_id));
}
