/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_METADATA_RETRY_COOLDOWN_HOURS,
  isLinkReadyForEmbedding,
  selectLinksForMetadataProcessing,
} from "../../shared/processing.js";

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

// A default sync sends up to 100 tweets (50 bookmarks and 50 likes); --count
// and --all send more. Sent as one statement, a default sync ran past the
// database statement timeout (SQLSTATE 57014) and failed. Measured on
// 2026-11-27: a statement updating 25 existing tweets took 3.6 s, one
// inserting 25 new tweets 0.2 s.
const TWEET_CHUNK_SIZE = 25;
const LINK_CHUNK_SIZE = 200;
const INTERACTION_CHUNK_SIZE = 500;
const STATEMENT_TIMEOUT = "57014";
let supabaseClient: any = null;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

// Writes rows in statements of at most `size` rows. A statement the database
// cancels for running too long wrote nothing, so its rows are retried as two
// halves, down to a single row. Any other error, and a timeout on a single
// row, is thrown.
async function writeInBatches<T>(
  label: string,
  rows: T[],
  size: number,
  write: (batch: T[]) => PromiseLike<{ error: any }>,
): Promise<void> {
  const pending = chunk(rows, size);

  while (pending.length > 0) {
    const batch = pending.shift() as T[];
    const { error } = await write(batch);
    if (!error) continue;
    if (error.code !== STATEMENT_TIMEOUT || batch.length === 1) throw error;

    const half = Math.ceil(batch.length / 2);
    console.warn(
      `  ⚠️  ${label}: statement timeout on ${batch.length} rows, retrying as ${half} + ${batch.length - half}`,
    );
    pending.unshift(batch.slice(0, half), batch.slice(half));
  }
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

async function getExistingTweetIds(
  tweetIds: string[],
  supabase: any,
): Promise<Set<string>> {
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

// The writers below take the client as an optional last argument so tests can
// pass a stub. It is resolved after the empty-input return, so an empty call
// needs no credentials.
export async function upsertTweets(
  tweets: Tweet[],
  client?: any,
): Promise<{ added: string[]; updated: string[] }> {
  if (tweets.length === 0) {
    return { added: [], updated: [] };
  }

  const supabase = client ?? getSupabaseClient();

  const deduped = new Map<string, Tweet>();
  for (const tweet of tweets) {
    deduped.set(tweet.tweet_id, tweet);
  }

  const normalizedTweets = [...deduped.values()];
  const tweetIds = normalizedTweets.map((tweet) => tweet.tweet_id);
  const existingBefore = await getExistingTweetIds(tweetIds, supabase);
  const now = new Date().toISOString();

  const payload = normalizedTweets.map((tweet) => ({
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

  await writeInBatches("tweets", payload, TWEET_CHUNK_SIZE, (batch) =>
    supabase.from("tweets").upsert(batch, { onConflict: "tweet_id" }),
  );

  const added = tweetIds.filter((id) => !existingBefore.has(id));
  const updated = tweetIds.filter((id) => existingBefore.has(id));
  return { added, updated };
}

// Stores the links that are not stored yet and leaves stored links as they
// are, so it can be given every tweet of a run: a link that an earlier, failed
// run did not reach is added, and nothing else is written.
export async function insertMissingLinks(
  links: Link[],
  client?: any,
): Promise<{ inserted: number }> {
  if (links.length === 0) {
    return { inserted: 0 };
  }

  const supabase = client ?? getSupabaseClient();
  let inserted = 0;

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

    const missing = linkChunk.filter(
      (link) => !existingKeys.has(`${link.tweet_id}::${link.url}`),
    );
    inserted += missing.length;

    const payload = missing.map((link) => ({
      tweet_id: link.tweet_id,
      url: link.url,
      expanded_url: link.expanded_url ?? null,
      display_url: link.display_url ?? null,
      domain: link.domain ?? null,
    }));

    await writeInBatches("links", payload, LINK_CHUNK_SIZE, (batch) =>
      supabase.from("links").upsert(batch, {
        onConflict: "tweet_id,url",
        ignoreDuplicates: true,
      }),
    );
  }

  return { inserted };
}

async function writeTweetInteractions(
  interactions: TweetInteraction[],
  refreshStored: boolean,
  client?: any,
): Promise<{ inserted: number; updated: number }> {
  if (interactions.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const supabase = client ?? getSupabaseClient();
  const deduped = new Map<string, TweetInteraction>();
  for (const interaction of interactions) {
    deduped.set(
      `${interaction.tweet_id}::${interaction.interaction_type}`,
      interaction,
    );
  }

  const normalized = [...deduped.values()];
  const tweetIds = [...new Set(normalized.map((item) => item.tweet_id))];
  const existingTweets = await getExistingTweetIds(tweetIds, supabase);
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

    const missing = interactionChunk.filter(
      (item) =>
        !existingKeys.has(`${item.tweet_id}::${item.interaction_type}`),
    );
    inserted += missing.length;
    if (refreshStored) updated += interactionChunk.length - missing.length;

    const rows = refreshStored ? interactionChunk : missing;
    const payload = rows.map((interaction) => ({
      tweet_id: interaction.tweet_id,
      interaction_type: interaction.interaction_type,
      interaction_at: interaction.interaction_at ?? null,
      source: interaction.source ?? "bird",
      metadata: interaction.metadata ?? {},
      synced_at: interaction.synced_at ?? new Date().toISOString(),
    }));

    await writeInBatches(
      "tweet_interactions",
      payload,
      INTERACTION_CHUNK_SIZE,
      (batch) =>
        supabase.from("tweet_interactions").upsert(batch, {
          onConflict: "tweet_id,interaction_type",
          ignoreDuplicates: !refreshStored,
        }),
    );
  }

  return { inserted, updated };
}

// Writes every interaction and refreshes the ones already stored.
export async function upsertTweetInteractions(
  interactions: TweetInteraction[],
  client?: any,
): Promise<{ inserted: number; updated: number }> {
  return writeTweetInteractions(interactions, true, client);
}

// Stores the interactions that are not stored yet and leaves stored ones as
// they are, source and metadata included.
export async function insertMissingTweetInteractions(
  interactions: TweetInteraction[],
  client?: any,
): Promise<{ inserted: number }> {
  const { inserted } = await writeTweetInteractions(interactions, false, client);
  return { inserted };
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
  options: { includeExisting?: boolean; offset?: number } = {},
): Promise<Tweet[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from("tweets")
    .select("*")
    .order("id", { ascending: true })
    .range(options.offset ?? 0, (options.offset ?? 0) + limit - 1);
  if (!options.includeExisting) query = query.is("embedding", null);

  const { data, error } = await query;

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
  options: { includeExisting?: boolean; offset?: number } = {},
): Promise<Link[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from("links")
    .select("*")
    .order("id", { ascending: true })
    .range(
      options.offset ?? 0,
      (options.offset ?? 0) + limit - 1,
    );
  if (options.includeExisting) {
    query = query.not("title", "is", null);
  } else {
    query = query.not("title", "is", null).is("embedding", null);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? [])
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
      embedding: row.embedding ?? undefined,
    }))
    .filter((row: any) =>
      options.includeExisting ? Boolean(row.title) : isLinkReadyForEmbedding(row),
    )
    .slice(0, limit);
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
  retryCooldownHours = DEFAULT_METADATA_RETRY_COOLDOWN_HOURS,
): Promise<Link[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("links")
    .select("*")
    .is("title", null)
    .order("id", { ascending: true })
    .limit(Math.max(limit * 4, 200));

  if (error) throw error;

  return selectLinksForMetadataProcessing(
    (data ?? []).map((row: any) => ({
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
    })),
    limit,
    retryCooldownHours,
  );
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
