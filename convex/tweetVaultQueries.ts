import { action, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { embedTexts } from "./lib/embeddings";
import type { Doc } from "./_generated/dataModel";

const DEFAULT_MODEL = "text-embedding-3-small";

export const searchTweets = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const model = process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_MODEL;
    const limit = args.limit ?? 10;
    const [vector] = await embedTexts([args.query], model);

    const matches = await ctx.vectorSearch("tweets", "by_embedding", {
      vector,
      limit: Math.min(256, limit * 5),
    });

    const ids = matches.map((match) => match._id);
    const docs = await ctx.runQuery(
      internal.tweetVaultInternal.getTweetsByIds,
      {
        ids,
      },
    );
    const validDocs = docs.filter(
      (d): d is NonNullable<typeof d> => d !== null,
    );
    const docMap = new Map(validDocs.map((doc) => [doc._id, doc]));

    const results: Array<{ tweet: Doc<"tweets">; score: number }> = [];
    for (const match of matches) {
      const tweet = docMap.get(match._id);
      if (!tweet) continue;
      results.push({ tweet, score: match._score });
    }

    return results.slice(0, limit);
  },
});

export const searchLinks = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const model = process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_MODEL;
    const limit = args.limit ?? 10;
    const [vector] = await embedTexts([args.query], model);

    const matches = await ctx.vectorSearch("links", "by_embedding", {
      vector,
      limit: Math.min(256, limit * 5),
    });

    const ids = matches.map((match) => match._id);
    const docs = await ctx.runQuery(internal.tweetVaultInternal.getLinksByIds, {
      ids,
    });
    const validDocs = docs.filter(
      (d): d is NonNullable<typeof d> => d !== null,
    );
    const docMap = new Map(validDocs.map((doc) => [doc._id, doc]));

    const results: Array<{ link: Doc<"links">; score: number }> = [];
    for (const match of matches) {
      const link = docMap.get(match._id);
      if (!link) continue;
      results.push({ link, score: match._score });
    }

    return results.slice(0, limit);
  },
});

export const getTweet = query({
  args: {
    tweet_id: v.string(),
  },
  handler: async (ctx, args) => {
    const tweet = await ctx.db
      .query("tweets")
      .filter((q) => q.eq(q.field("tweet_id"), args.tweet_id))
      .first();

    if (!tweet) return null;

    const links = await ctx.db
      .query("links")
      .withIndex("by_tweet_id", (q) => q.eq("tweet_id", tweet.tweet_id))
      .collect();

    return { ...tweet, links };
  },
});

export const listLinksByDomain = query({
  args: {
    domain: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const domain = args.domain.replace(/^www\./, "");

    const links = await ctx.db
      .query("links")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .take(limit);

    return links;
  },
});

export const findRelated = action({
  args: {
    topic: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const [vector] = await embedTexts(
      [args.topic],
      process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_MODEL,
    );

    const tweetMatches = await ctx.vectorSearch("tweets", "by_embedding", {
      vector,
      limit: Math.min(256, limit * 3),
    });
    const linkMatches = await ctx.vectorSearch("links", "by_embedding", {
      vector,
      limit: Math.min(256, limit * 3),
    });

    const tweetIds = tweetMatches.map((match) => match._id);
    const linkIds = linkMatches.map((match) => match._id);
    const [tweetDocs, linkDocs] = await Promise.all([
      ctx.runQuery(internal.tweetVaultInternal.getTweetsByIds, {
        ids: tweetIds,
      }),
      ctx.runQuery(internal.tweetVaultInternal.getLinksByIds, {
        ids: linkIds,
      }),
    ]);

    const validTweetDocs = tweetDocs.filter(
      (d): d is NonNullable<typeof d> => d !== null,
    );
    const validLinkDocs = linkDocs.filter(
      (d): d is NonNullable<typeof d> => d !== null,
    );
    const tweetMap = new Map(validTweetDocs.map((doc) => [doc._id, doc]));
    const linkMap = new Map(validLinkDocs.map((doc) => [doc._id, doc]));

    const tweets: Array<{ tweet: Doc<"tweets">; score: number }> = [];
    for (const match of tweetMatches) {
      const tweet = tweetMap.get(match._id);
      if (tweet) tweets.push({ tweet, score: match._score });
    }

    const links: Array<{ link: Doc<"links">; score: number }> = [];
    for (const match of linkMatches) {
      const link = linkMap.get(match._id);
      if (link) links.push({ link, score: match._score });
    }

    return {
      tweets: tweets.slice(0, limit),
      links: links.slice(0, limit),
    };
  },
});

// Note: Full stats are expensive due to Convex 16MB read limit.
// This returns stats from sync_state + samples for top authors/domains.
export const vaultStats = query({
  args: {},
  handler: async (ctx) => {
    // Get last few syncs to calculate totals
    const syncs = await ctx.db.query("sync_state").order("desc").take(10);
    const lastSync = syncs[0];

    // Sample recent tweets for top authors (avoids loading all embeddings)
    const recentTweets = await ctx.db.query("tweets").order("desc").take(500);
    const authorCounts = new Map<string, number>();
    for (const tweet of recentTweets) {
      authorCounts.set(
        tweet.author_username,
        (authorCounts.get(tweet.author_username) ?? 0) + 1,
      );
    }
    const topAuthors = [...authorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([author, count]) => `${author} (${count})`);

    // Sample recent links for top domains
    const recentLinks = await ctx.db.query("links").order("desc").take(500);
    const domainCounts = new Map<string, number>();
    for (const link of recentLinks) {
      if (link.domain) {
        domainCounts.set(link.domain, (domainCounts.get(link.domain) ?? 0) + 1);
      }
    }
    const topDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, count]) => `${domain} (${count})`);

    // Calculate totals from sync metadata (best effort)
    const totalTweets =
      lastSync?.metadata &&
      typeof lastSync.metadata === "object" &&
      "added" in lastSync.metadata
        ? ((lastSync.metadata as Record<string, number>).added ?? 0) +
          ((lastSync.metadata as Record<string, number>).updated ?? 0)
        : recentTweets.length;

    return {
      total_tweets: `~${recentTweets.length}+ (sampled)`,
      total_links: `~${recentLinks.length}+ (sampled)`,
      tweets_with_embeddings: recentTweets.filter((t) => t.embedding).length,
      links_with_embeddings: recentLinks.filter((l) => l.embedding).length,
      top_authors: topAuthors,
      top_domains: topDomains,
      last_sync: lastSync?.last_sync_at ?? null,
      last_sync_added: lastSync?.tweets_added ?? 0,
      note: "Stats are sampled from recent 500 items due to Convex read limits",
    };
  },
});

export const listAuthors = query({
  args: {
    username: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const username = args.username.toLowerCase();

    // Use index if available, otherwise paginate to avoid memory limits
    const tweets = await ctx.db
      .query("tweets")
      .withIndex("by_author", (q) => q.eq("author_username", username))
      .take(limit);

    // If index didn't match (case sensitivity), fall back to paginated search
    if (tweets.length === 0) {
      const BATCH_SIZE = 500;
      const results: Doc<"tweets">[] = [];
      let cursor: string | null = null;

      while (results.length < limit) {
        let batch: Doc<"tweets">[];
        if (cursor) {
          batch = await ctx.db
            .query("tweets")
            .order("asc")
            .filter((q) => q.gt(q.field("_id"), cursor))
            .take(BATCH_SIZE);
        } else {
          batch = await ctx.db.query("tweets").order("asc").take(BATCH_SIZE);
        }

        if (batch.length === 0) break;

        for (const tweet of batch) {
          if (tweet.author_username.toLowerCase() === username) {
            results.push(tweet);
            if (results.length >= limit) break;
          }
        }

        cursor = batch[batch.length - 1]._id;
        if (batch.length < BATCH_SIZE) break;
      }

      return results;
    }

    return tweets;
  },
});
