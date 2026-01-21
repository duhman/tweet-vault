/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";

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
  tweet_id: string;
  url: string;
  expanded_url?: string;
  display_url?: string;
  domain?: string;
  title?: string;
  description?: string;
  og_image?: string;
  embedding?: number[];
  fetch_error?: string;
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

let supabaseClient: any = null;

export function getSupabaseClient(): any {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const schema = process.env.SUPABASE_SCHEMA || "tweet_vault";

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable",
    );
  }

  supabaseClient = createClient(url, key, {
    db: { schema },
  });

  return supabaseClient;
}

export async function upsertTweets(
  tweets: Tweet[],
): Promise<{ added: string[]; updated: string[] }> {
  const supabase = getSupabaseClient();
  const added: string[] = [];
  const updated: string[] = [];

  for (const tweet of tweets) {
    // Check if tweet exists
    const { data: existing } = await supabase
      .from("tweets")
      .select("tweet_id")
      .eq("tweet_id", tweet.tweet_id)
      .single();

    if (existing) {
      // Update existing tweet
      const { error } = await supabase
        .from("tweets")
        .update({
          author_username: tweet.author_username,
          author_name: tweet.author_name ?? null,
          author_profile_image: tweet.author_profile_image ?? null,
          content: tweet.content,
          created_at: tweet.created_at ?? null,
          media_urls: tweet.media_urls ?? null,
          metrics: tweet.metrics ?? null,
          raw_data: tweet.raw_data ?? null,
        })
        .eq("tweet_id", tweet.tweet_id);

      if (!error) updated.push(tweet.tweet_id);
    } else {
      // Insert new tweet
      const { error } = await supabase.from("tweets").insert({
        tweet_id: tweet.tweet_id,
        author_username: tweet.author_username,
        author_name: tweet.author_name ?? null,
        author_profile_image: tweet.author_profile_image ?? null,
        content: tweet.content,
        created_at: tweet.created_at ?? null,
        media_urls: tweet.media_urls ?? null,
        metrics: tweet.metrics ?? null,
        raw_data: tweet.raw_data ?? null,
        fetched_at: new Date().toISOString(),
      });

      if (!error) added.push(tweet.tweet_id);
    }
  }

  return { added, updated };
}

export async function upsertLinks(
  links: Link[],
): Promise<{ inserted: number; updated: number }> {
  const supabase = getSupabaseClient();
  let inserted = 0;
  let updated = 0;

  for (const link of links) {
    // Check if link exists
    const { data: existing } = await supabase
      .from("links")
      .select("id")
      .eq("tweet_id", link.tweet_id)
      .eq("url", link.url)
      .single();

    if (existing) {
      // Update existing link
      const { error } = await supabase
        .from("links")
        .update({
          expanded_url: link.expanded_url ?? null,
          display_url: link.display_url ?? null,
          domain: link.domain ?? null,
          title: link.title ?? null,
          description: link.description ?? null,
          og_image: link.og_image ?? null,
        })
        .eq("id", existing.id);

      if (!error) updated++;
    } else {
      // Insert new link
      const { error } = await supabase.from("links").insert({
        tweet_id: link.tweet_id,
        url: link.url,
        expanded_url: link.expanded_url ?? null,
        display_url: link.display_url ?? null,
        domain: link.domain ?? null,
        title: link.title ?? null,
        description: link.description ?? null,
        og_image: link.og_image ?? null,
      });

      if (!error) inserted++;
    }
  }

  return { inserted, updated };
}

export async function recordSync(state: SyncStateInput): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase.from("sync_state").insert({
    last_sync_at: state.last_sync_at,
    tweets_added: state.tweets_added,
    links_processed: state.links_processed,
    embeddings_generated: state.embeddings_generated,
    sync_type: state.sync_type,
    error_message: state.error_message ?? null,
    metadata: state.metadata ?? null,
  });

  if (error) {
    console.error("Failed to record sync:", error);
    throw error;
  }
}

export async function getStats(): Promise<TweetVaultStats> {
  const supabase = getSupabaseClient();

  // Get total counts
  const { count: totalTweets } = await supabase
    .from("tweets")
    .select("*", { count: "exact", head: true });

  const { count: totalLinks } = await supabase
    .from("links")
    .select("*", { count: "exact", head: true });

  const { count: tweetsWithEmbeddings } = await supabase
    .from("tweets")
    .select("*", { count: "exact", head: true })
    .not("embedding", "is", null);

  const { count: linksWithEmbeddings } = await supabase
    .from("links")
    .select("*", { count: "exact", head: true })
    .not("embedding", "is", null);

  // Get top authors
  const { data: authorData } = await supabase
    .from("tweets")
    .select("author_username");

  const authorCounts: Record<string, number> = {};
  (authorData ?? []).forEach((t: any) => {
    if (t.author_username) {
      authorCounts[t.author_username] =
        (authorCounts[t.author_username] || 0) + 1;
    }
  });
  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([author]) => author);

  // Get top domains
  const { data: domainData } = await supabase
    .from("links")
    .select("domain")
    .not("domain", "is", null);

  const domainCounts: Record<string, number> = {};
  (domainData ?? []).forEach((l: any) => {
    if (l.domain) {
      domainCounts[l.domain] = (domainCounts[l.domain] || 0) + 1;
    }
  });
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain]) => domain);

  // Get last sync
  const { data: syncData } = await supabase
    .from("sync_state")
    .select("last_sync_at")
    .order("last_sync_at", { ascending: false })
    .limit(1);

  return {
    total_tweets: totalTweets ?? 0,
    total_links: totalLinks ?? 0,
    tweets_with_embeddings: tweetsWithEmbeddings ?? 0,
    links_with_embeddings: linksWithEmbeddings ?? 0,
    top_authors: topAuthors,
    top_domains: topDomains,
    last_sync: syncData?.[0]?.last_sync_at ?? null,
  };
}

export async function getTweetsWithoutEmbeddings(
  limit: number,
): Promise<Tweet[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("tweets")
    .select("*")
    .is("embedding", null)
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    tweet_id: row.tweet_id,
    author_username: row.author_username,
    author_name: row.author_name ?? undefined,
    author_profile_image: row.author_profile_image ?? undefined,
    content: row.content,
    created_at: row.created_at ?? undefined,
    media_urls: row.media_urls ?? undefined,
    metrics: row.metrics ?? undefined,
    raw_data: row.raw_data ?? undefined,
    fetched_at: row.fetched_at ?? undefined,
    processed_at: row.processed_at ?? undefined,
  }));
}

export async function getLinksWithoutEmbeddings(
  limit: number,
): Promise<Link[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("links")
    .select("*")
    .is("embedding", null)
    .not("title", "is", null)
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    tweet_id: row.tweet_id,
    url: row.url,
    expanded_url: row.expanded_url ?? undefined,
    display_url: row.display_url ?? undefined,
    domain: row.domain ?? undefined,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    og_image: row.og_image ?? undefined,
  }));
}

export async function updateTweetEmbedding(
  tweetId: string,
  embedding: number[],
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("tweets")
    .update({
      embedding,
      processed_at: new Date().toISOString(),
    })
    .eq("tweet_id", tweetId);

  if (error) throw error;
}

export async function updateLinkEmbedding(
  linkId: number,
  embedding: number[],
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("links")
    .update({ embedding })
    .eq("id", linkId);

  if (error) throw error;
}

export async function getLinksWithoutMetadata(limit: number): Promise<Link[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("links")
    .select("*")
    .is("title", null)
    .is("fetch_error", null)
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    tweet_id: row.tweet_id,
    url: row.url,
    expanded_url: row.expanded_url ?? undefined,
    display_url: row.display_url ?? undefined,
    domain: row.domain ?? undefined,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    og_image: row.og_image ?? undefined,
  }));
}

export async function updateLinkMetadata(
  linkId: number,
  metadata: Partial<Link> & { fetch_error?: string },
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("links")
    .update({
      title: metadata.title ?? null,
      description: metadata.description ?? null,
      og_image: metadata.og_image ?? null,
      fetch_error: metadata.fetch_error ?? null,
      fetched_at: new Date().toISOString(),
    })
    .eq("id", linkId);

  if (error) throw error;
}
