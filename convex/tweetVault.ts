"use node";

import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { embedTexts } from "./lib/embeddings";
import { TwitterClient } from "@steipete/bird";

const DEFAULT_MODEL = "text-embedding-3-small";
const LINK_SKIP_DOMAINS = new Set([
  "t.co",
  "pic.twitter.com",
  "twitter.com",
  "x.com",
  "pbs.twimg.com",
]);

type UpsertTweet = {
  tweet_id: string;
  author_username: string;
  author_name?: string;
  content: string;
  created_at?: string;
  media_urls?: string[];
  metrics?: {
    replies?: number;
    retweets?: number;
    likes?: number;
  };
  raw_data?: unknown;
  fetched_at?: string;
};

type SyncTweetVaultResult = {
  fetched: number;
  added: number;
  updated: number;
  new_count: number;
  checkpoint_hit: boolean;
  processing: {
    tweets_embedded: number;
    likes_embedded: number;
    links_metadata_fetched: number;
    links_embedded: number;
    errors: string[];
  };
};

function getTwitterClient(): TwitterClient {
  const authToken = process.env.TWITTER_AUTH_TOKEN ?? process.env.AUTH_TOKEN;
  const ct0 = process.env.TWITTER_CT0 ?? process.env.CT0;

  if (!authToken || !ct0) {
    throw new Error(
      "Missing TWITTER_AUTH_TOKEN/AUTH_TOKEN or TWITTER_CT0/CT0 in Convex env",
    );
  }

  return new TwitterClient({
    cookies: { authToken, ct0 },
  });
}

function toIsoDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

async function fetchLinkMetadata(url: string): Promise<{
  title?: string;
  description?: string;
  domain?: string;
  contentType?: string;
}> {
  try {
    let expandedUrl = url;
    if (url.includes("t.co/")) {
      const headResponse = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
      });
      expandedUrl = headResponse.url;
    }

    const domain = new URL(expandedUrl).hostname.replace(/^www\./, "");
    if (LINK_SKIP_DOMAINS.has(domain)) {
      return { domain };
    }

    const response = await fetch(expandedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TweetVault/1.0)",
        Accept: "text/html",
      },
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return { domain, contentType };
    }

    const html = await response.text();
    const titleMatch =
      html.match(/<meta[^>]*property=\"og:title\"[^>]*content=\"([^\"]*)\"/) ||
      html.match(/<meta[^>]*name=\"twitter:title\"[^>]*content=\"([^\"]*)\"/) ||
      html.match(/<title[^>]*>([^<]*)<\/title>/);

    const descMatch =
      html.match(
        /<meta[^>]*property=\"og:description\"[^>]*content=\"([^\"]*)\"/,
      ) ||
      html.match(/<meta[^>]*name=\"description\"[^>]*content=\"([^\"]*)\"/) ||
      html.match(
        /<meta[^>]*name=\"twitter:description\"[^>]*content=\"([^\"]*)\"/,
      );

    return {
      title: titleMatch?.[1]?.slice(0, 500),
      description: descMatch?.[1]?.slice(0, 2000),
      domain,
      contentType,
    };
  } catch (error) {
    console.error(`Failed to fetch metadata for ${url}:`, error);
    return {};
  }
}

async function runProcessingPipeline(
  ctx: any,
  args: {
    tweetLimit?: number;
    likeLimit?: number;
    linkMetaLimit?: number;
    linkEmbedLimit?: number;
    syncType?: string;
    syncMetadata?: Record<string, unknown>;
    tweetsAdded?: number;
  },
) {
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_MODEL;

  const result = {
    tweets_embedded: 0,
    likes_embedded: 0,
    links_metadata_fetched: 0,
    links_embedded: 0,
    errors: [] as string[],
  };

  const tweetLimit = args.tweetLimit ?? 20;
  const tweetsToEmbed = await ctx.runQuery(
    internal.tweetVaultInternal.getTweetsWithoutEmbedding,
    { limit: tweetLimit },
  );

  if (tweetsToEmbed.length > 0) {
    const texts = tweetsToEmbed.map((tweet: any) => {
      const authorName = tweet.author_name ?? tweet.author_username;
      return `${authorName} (@${tweet.author_username}): ${tweet.content}`;
    });

    const embeddings = await embedTexts(texts, model);
    for (let i = 0; i < tweetsToEmbed.length; i += 1) {
      const tweet = tweetsToEmbed[i];
      await ctx.runMutation(internal.tweetVaultInternal.setTweetEmbedding, {
        id: tweet._id,
        embedding: embeddings[i],
      });
      result.tweets_embedded += 1;
    }
  }

  const likeLimit = args.likeLimit ?? 20;
  const likesToEmbed = await ctx.runQuery(
    internal.tweetVaultInternal.getLikesWithoutEmbedding,
    { limit: likeLimit },
  );

  if (likesToEmbed.length > 0) {
    const texts = likesToEmbed.map((like: any) => like.content ?? "");
    const embeddings = await embedTexts(texts, model);
    for (let i = 0; i < likesToEmbed.length; i += 1) {
      const like = likesToEmbed[i];
      await ctx.runMutation(internal.tweetVaultInternal.setLikeEmbedding, {
        id: like._id,
        embedding: embeddings[i],
      });
      result.likes_embedded += 1;
    }
  }

  const linkMetaLimit = args.linkMetaLimit ?? 10;
  const linksToFetch = await ctx.runQuery(
    internal.tweetVaultInternal.getLinksWithoutMetadata,
    { limit: linkMetaLimit },
  );

  for (const link of linksToFetch) {
    try {
      const url = link.expanded_url ?? link.url;
      const metadata = await fetchLinkMetadata(url);
      const searchText = [
        metadata.title,
        metadata.description,
        metadata.domain,
        url,
      ]
        .filter(Boolean)
        .join(" | ");

      await ctx.runMutation(internal.tweetVaultInternal.updateLinkMetadata, {
        id: link._id,
        title: metadata.title ?? undefined,
        description: metadata.description ?? undefined,
        domain: metadata.domain ?? undefined,
        content_type: metadata.contentType ?? undefined,
        fetched_at: new Date().toISOString(),
        search_text: searchText || undefined,
      });

      result.links_metadata_fetched += 1;
    } catch (error) {
      await ctx.runMutation(internal.tweetVaultInternal.updateLinkMetadata, {
        id: link._id,
        fetch_error: error instanceof Error ? error.message : String(error),
      });
      result.errors.push(
        `Failed to fetch link ${link.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const linkEmbedLimit = args.linkEmbedLimit ?? 10;
  const linksToEmbed = await ctx.runQuery(
    internal.tweetVaultInternal.getLinksWithoutEmbedding,
    { limit: linkEmbedLimit },
  );

  if (linksToEmbed.length > 0) {
    const texts = linksToEmbed.map((link: any) =>
      [link.title, link.description, link.domain, link.url]
        .filter(Boolean)
        .join(" | "),
    );
    const embeddings = await embedTexts(texts, model);
    for (let i = 0; i < linksToEmbed.length; i += 1) {
      const link = linksToEmbed[i];
      await ctx.runMutation(internal.tweetVaultInternal.setLinkEmbedding, {
        id: link._id,
        embedding: embeddings[i],
      });
      result.links_embedded += 1;
    }
  }

  const syncId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  await ctx.runMutation(internal.tweetVaultInternal.insertSyncState, {
    id: syncId,
    last_sync_at: new Date().toISOString(),
    tweets_added: args.tweetsAdded ?? 0,
    links_processed: result.links_metadata_fetched,
    embeddings_generated:
      result.tweets_embedded + result.likes_embedded + result.links_embedded,
    sync_type: args.syncType ?? "cron",
    metadata: {
      tweets_embedded: result.tweets_embedded,
      likes_embedded: result.likes_embedded,
      links_metadata_fetched: result.links_metadata_fetched,
      links_embedded: result.links_embedded,
      errors_count: result.errors.length,
      ...args.syncMetadata,
    },
  });

  return result;
}

export const processTweetVault = action({
  args: {
    tweetLimit: v.optional(v.number()),
    likeLimit: v.optional(v.number()),
    linkMetaLimit: v.optional(v.number()),
    linkEmbedLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    runProcessingPipeline(ctx, {
      tweetLimit: args.tweetLimit,
      likeLimit: args.likeLimit,
      linkMetaLimit: args.linkMetaLimit,
      linkEmbedLimit: args.linkEmbedLimit,
      syncType: "manual",
    }),
});

export const syncTweetVault: ReturnType<typeof action> = action({
  args: {
    count: v.optional(v.number()),
    fetchAll: v.optional(v.boolean()),
    includeRaw: v.optional(v.boolean()),
    maxPages: v.optional(v.number()),
    strictCheckpoint: v.optional(v.boolean()),
    ignoreCheckpoint: v.optional(v.boolean()),
    upsertChunkSize: v.optional(v.number()),
    linkExtractLimit: v.optional(v.number()),
    tweetLimit: v.optional(v.number()),
    likeLimit: v.optional(v.number()),
    linkMetaLimit: v.optional(v.number()),
    linkEmbedLimit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SyncTweetVaultResult> => {
    const client = getTwitterClient();
    const includeRaw = args.includeRaw ?? false;

    const lastSync = await ctx.runQuery(
      internal.tweetVaultInternal.getLatestSyncState,
      {},
    );
    const previousLatestTweetId =
      args.ignoreCheckpoint
        ? undefined
        : lastSync?.metadata &&
          typeof lastSync.metadata === "object" &&
          "latest_tweet_id" in lastSync.metadata
          ? (lastSync.metadata as { latest_tweet_id?: string })
              .latest_tweet_id
          : undefined;

    const shouldFetchAll =
      args.fetchAll === true || typeof args.maxPages === "number";
    const result = shouldFetchAll
      ? await client.getAllBookmarks({ includeRaw, maxPages: args.maxPages })
      : await client.getBookmarks(args.count ?? 50, { includeRaw });

    if (!result.success || !result.tweets) {
      throw new Error(result.error || "Failed to fetch bookmarks");
    }

    const latestTweetId = result.tweets[0]?.id;
    let checkpointHit = false;
    const tweets: UpsertTweet[] = [];
    for (const tweet of result.tweets) {
      if (previousLatestTweetId && tweet.id === previousLatestTweetId) {
        checkpointHit = true;
        break;
      }

      const username = tweet.author?.username;
      const content = tweet.text;
      if (!tweet.id || !username || !content) continue;

      const mediaUrls =
        tweet.media?.map((media) => media.url).filter(Boolean) ?? [];

      tweets.push({
        tweet_id: tweet.id,
        author_username: username,
        author_name: tweet.author?.name,
        content,
        created_at: toIsoDate(tweet.createdAt) ?? undefined,
        media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
        metrics: {
          replies: tweet.replyCount ?? 0,
          retweets: tweet.retweetCount ?? 0,
          likes: tweet.likeCount ?? 0,
        },
        raw_data: includeRaw ? tweet._raw ?? tweet : undefined,
        fetched_at: new Date().toISOString(),
      });
    }

    if (
      previousLatestTweetId &&
      !checkpointHit &&
      args.strictCheckpoint &&
      !args.ignoreCheckpoint
    ) {
      throw new Error("Checkpoint not found in fetched bookmarks");
    }

    const chunkSize = Math.max(10, Math.min(args.upsertChunkSize ?? 100, 500));
    const upsertResult: { added: string[]; updated: string[] } = {
      added: [],
      updated: [],
    };
    for (let i = 0; i < tweets.length; i += chunkSize) {
      const chunk = tweets.slice(i, i + chunkSize);
      const result = await ctx.runMutation(
        api.tweetVaultMutations.upsertTweets,
        { tweets: chunk },
      );
      upsertResult.added.push(...result.added);
      upsertResult.updated.push(...result.updated);
    }

    const linkExtractLimit = args.linkExtractLimit ?? 200;
    await ctx.runMutation(api.tweetVaultLinks.backfillLinks, {
      limit: linkExtractLimit,
    });

    const processing = await runProcessingPipeline(ctx, {
      tweetLimit: args.tweetLimit,
      likeLimit: args.likeLimit,
      linkMetaLimit: args.linkMetaLimit,
      linkEmbedLimit: args.linkEmbedLimit,
      syncType: "cron",
      syncMetadata: {
        fetched: result.tweets.length,
        latest_tweet_id: latestTweetId,
        previous_latest_tweet_id: previousLatestTweetId,
        checkpoint_hit: checkpointHit,
        ignore_checkpoint: args.ignoreCheckpoint ?? false,
        added: upsertResult.added.length,
        updated: upsertResult.updated.length,
      },
      tweetsAdded: upsertResult.added.length,
    });

    return {
      fetched: result.tweets.length,
      added: upsertResult.added.length,
      updated: upsertResult.updated.length,
      new_count: tweets.length,
      checkpoint_hit: checkpointHit,
      processing,
    };
  },
});
