/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";

export type InteractionType = "bookmark" | "like";

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
  fetched_at?: string;
}

export interface TweetInteraction {
  tweet_id: string;
  interaction_type: InteractionType;
  interaction_at?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  synced_at?: string;
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
  likes_count?: number;
  bookmarks_count?: number;
  top_authors: string[];
  top_domains: string[];
  last_sync: string | null;
}

const TWEET_CHUNK_SIZE = 200;
const LINK_CHUNK_SIZE = 200;
const INTERACTION_CHUNK_SIZE = 500;
let supabaseClient: any = null;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

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

async function getExistingTweetIds(tweetIds: string[]): Promise<Set<string>> {
  const supabase = getSupabaseClient();
  const existing = new Set<string>();

  for (const idChunk of chunk(tweetIds, INTERACTION_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("tweets")
      .select("tweet_id")
      .in("tweet_id", idChunk);

    if (error) throw error;
    for (const row of data ?? []) {
      if (row.tweet_id) existing.add(row.tweet_id);
    }
  }

  return existing;
}

export async function upsertTweets(
  tweets: Tweet[],
): Promise<{ added: string[]; updated: string[] }> {
  if (tweets.length === 0) {
    return { added: [], updated: [] };
  }

  const supabase = getSupabaseClient();
  const deduped = new Map<string, Tweet>();
  for (const tweet of tweets) {
    deduped.set(tweet.tweet_id, tweet);
  }

  const normalizedTweets = [...deduped.values()];
  const tweetIds = normalizedTweets.map((tweet) => tweet.tweet_id);
  const existingBefore = await getExistingTweetIds(tweetIds);
  const now = new Date().toISOString();

  for (const tweetChunk of chunk(normalizedTweets, TWEET_CHUNK_SIZE)) {
    const payload = tweetChunk.map((tweet) => ({
      tweet_id: tweet.tweet_id,
      author_username: tweet.author_username,
      author_name: tweet.author_name ?? null,
      author_profile_image: tweet.author_profile_image ?? null,
      content: tweet.content,
      created_at: tweet.created_at ?? null,
      media_urls: tweet.media_urls ?? null,
      metrics: tweet.metrics ?? null,
      raw_data: tweet.raw_data ?? null,
      fetched_at: tweet.fetched_at ?? now,
    }));

    const { error } = await supabase
      .from("tweets")
      .upsert(payload, { onConflict: "tweet_id" });

    if (error) throw error;
  }

  const added = tweetIds.filter((id) => !existingBefore.has(id));
  const updated = tweetIds.filter((id) => existingBefore.has(id));
  return { added, updated };
}

export async function upsertLinks(
  links: Link[],
): Promise<{ inserted: number; updated: number }> {
  if (links.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const supabase = getSupabaseClient();
  let inserted = 0;
  let updated = 0;

  const deduped = new Map<string, Link>();
  for (const link of links) {
    deduped.set(`${link.tweet_id}::${link.url}`, link);
  }

  const normalizedLinks = [...deduped.values()];

  for (const linkChunk of chunk(normalizedLinks, LINK_CHUNK_SIZE)) {
    const tweetIds = [...new Set(linkChunk.map((link) => link.tweet_id))];
    const { data: existingRows, error: existingError } = await supabase
      .from("links")
      .select("tweet_id,url")
      .in("tweet_id", tweetIds);

    if (existingError) throw existingError;

    const existingKeys = new Set<string>(
      (existingRows ?? []).map((row: { tweet_id: string; url: string }) =>
        `${row.tweet_id}::${row.url}`,
      ),
    );

    inserted += linkChunk.filter(
      (link) => !existingKeys.has(`${link.tweet_id}::${link.url}`),
    ).length;
    updated += linkChunk.filter((link) =>
      existingKeys.has(`${link.tweet_id}::${link.url}`),
    ).length;

    const payload = linkChunk.map((link) => ({
      tweet_id: link.tweet_id,
      url: link.url,
      expanded_url: link.expanded_url ?? null,
      display_url: link.display_url ?? null,
      domain: link.domain ?? null,
    }));

    const { error } = await supabase
      .from("links")
      .upsert(payload, { onConflict: "tweet_id,url" });

    if (error) throw error;
  }

  return { inserted, updated };
}

export async function upsertTweetInteractions(
  interactions: TweetInteraction[],
): Promise<{ inserted: number; updated: number }> {
  if (interactions.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const supabase = getSupabaseClient();
  const deduped = new Map<string, TweetInteraction>();
  for (const interaction of interactions) {
    deduped.set(
      `${interaction.tweet_id}::${interaction.interaction_type}`,
      interaction,
    );
  }

  const normalized = [...deduped.values()];
  const tweetIds = [...new Set(normalized.map((item) => item.tweet_id))];
  const existingTweets = await getExistingTweetIds(tweetIds);
  const filtered = normalized.filter((item) => existingTweets.has(item.tweet_id));

  if (filtered.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  let inserted = 0;
  let updated = 0;

  for (const interactionChunk of chunk(filtered, INTERACTION_CHUNK_SIZE)) {
    const ids = [...new Set(interactionChunk.map((i) => i.tweet_id))];
    const { data: existingRows, error: existingError } = await supabase
      .from("tweet_interactions")
      .select("tweet_id,interaction_type")
      .in("tweet_id", ids);

    if (existingError) throw existingError;

    const existingKeys = new Set<string>(
      (existingRows ?? []).map(
        (row: { tweet_id: string; interaction_type: InteractionType }) =>
          `${row.tweet_id}::${row.interaction_type}`,
      ),
    );

    inserted += interactionChunk.filter(
      (item) =>
        !existingKeys.has(`${item.tweet_id}::${item.interaction_type}`),
    ).length;
    updated += interactionChunk.filter((item) =>
      existingKeys.has(`${item.tweet_id}::${item.interaction_type}`),
    ).length;

    const payload = interactionChunk.map((interaction) => ({
      tweet_id: interaction.tweet_id,
      interaction_type: interaction.interaction_type,
      interaction_at: interaction.interaction_at ?? null,
      source: interaction.source ?? "bird",
      metadata: interaction.metadata ?? {},
      synced_at: interaction.synced_at ?? new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("tweet_interactions")
      .upsert(payload, { onConflict: "tweet_id,interaction_type" });

    if (error) throw error;
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

function rowsToTopList(rows: Array<{ value: string | null }>): string[] {
  return rows.filter((row) => row.value).map((row) => row.value as string);
}

export async function getStats(): Promise<TweetVaultStats> {
  const supabase = getSupabaseClient();

  const { data: rpcStats, error: rpcError } = await supabase.rpc("vault_stats");
  if (!rpcError && rpcStats) {
    const topAuthors = Array.isArray(rpcStats.top_authors)
      ? rpcStats.top_authors
          .map((row: { author_username?: string }) => row.author_username)
          .filter(Boolean)
      : [];

    const topDomains = Array.isArray(rpcStats.top_domains)
      ? rpcStats.top_domains
          .map((row: { domain?: string }) => row.domain)
          .filter(Boolean)
      : [];

    return {
      total_tweets: rpcStats.total_tweets ?? 0,
      total_links: rpcStats.total_links ?? 0,
      tweets_with_embeddings: rpcStats.tweets_with_embeddings ?? 0,
      links_with_embeddings: rpcStats.links_with_embeddings ?? 0,
      likes_count: rpcStats.likes_count ?? 0,
      bookmarks_count: rpcStats.bookmarks_count ?? 0,
      top_authors: topAuthors,
      top_domains: topDomains,
      last_sync: rpcStats.last_sync?.last_sync_at ?? null,
    };
  }

  // Fallback for pre-migration environments.
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

  const { data: authorData } = await supabase
    .from("tweets")
    .select("author_username");

  const authorCounts: Record<string, number> = {};
  (authorData ?? []).forEach((t: any) => {
    if (t.author_username) {
      authorCounts[t.author_username] = (authorCounts[t.author_username] || 0) + 1;
    }
  });
  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([author]) => author);

  const { data: domainData } = await supabase
    .from("links")
    .select("domain")
    .not("domain", "is", null);

  const topDomains = rowsToTopList(
    (domainData ?? []).map((item: { domain: string | null }) => ({
      value: item.domain,
    })),
  ).slice(0, 10);

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

export async function getLinksWithoutMetadata(
  limit: number,
  retryCooldownHours = 24,
): Promise<Link[]> {
  const supabase = getSupabaseClient();

  const links: any[] = [];

  const { data: freshRows, error: freshError } = await supabase
    .from("links")
    .select("*")
    .is("title", null)
    .is("fetch_error", null)
    .limit(limit);

  if (freshError) throw freshError;
  links.push(...(freshRows ?? []));

  if (links.length < limit) {
    const cutoff = new Date(
      Date.now() - retryCooldownHours * 60 * 60 * 1000,
    ).toISOString();

    const { data: retryRows, error: retryError } = await supabase
      .from("links")
      .select("*")
      .is("title", null)
      .not("fetch_error", "is", null)
      .lt("fetched_at", cutoff)
      .limit(limit - links.length);

    if (retryError) throw retryError;
    links.push(...(retryRows ?? []));
  }

  const seen = new Set<number>();
  return links
    .filter((row) => {
      if (!row.id || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row: any) => ({
      id: row.id,
      tweet_id: row.tweet_id,
      url: row.url,
      expanded_url: row.expanded_url ?? undefined,
      display_url: row.display_url ?? undefined,
      domain: row.domain ?? undefined,
      title: row.title ?? undefined,
      description: row.description ?? undefined,
      og_image: row.og_image ?? undefined,
      fetch_error: row.fetch_error ?? undefined,
      fetched_at: row.fetched_at ?? undefined,
    }));
}

export async function updateLinkMetadata(
  linkId: number,
  metadata: Omit<Partial<Link>, "fetch_error"> & { fetch_error?: string | null },
): Promise<void> {
  const supabase = getSupabaseClient();
  const updates: Record<string, unknown> = {
    fetched_at: new Date().toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(metadata, "title")) {
    updates.title = metadata.title ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "description")) {
    updates.description = metadata.description ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "og_image")) {
    updates.og_image = metadata.og_image ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "domain")) {
    updates.domain = metadata.domain ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "fetch_error")) {
    updates.fetch_error = metadata.fetch_error ?? null;
  }

  const { error } = await supabase
    .from("links")
    .update(updates)
    .eq("id", linkId);

  if (error) throw error;
}
