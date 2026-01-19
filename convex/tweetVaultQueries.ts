import { action, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { embedTexts } from "./lib/embeddings";

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
    const docs = await ctx.runQuery(internal.tweetVaultInternal.getTweetsByIds, {
      ids,
    });
    const docMap = new Map(
      docs.filter(Boolean).map((doc) => [doc!._id, doc]),
    );

    const results = [] as Array<{ tweet: any; score: number }>;
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
    const docMap = new Map(
      docs.filter(Boolean).map((doc) => [doc!._id, doc]),
    );

    const results = [] as Array<{ link: any; score: number }>;
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

    const tweetMap = new Map(
      tweetDocs.filter(Boolean).map((doc) => [doc!._id, doc]),
    );
    const linkMap = new Map(
      linkDocs.filter(Boolean).map((doc) => [doc!._id, doc]),
    );

    const tweets = [] as Array<{ tweet: any; score: number }>;
    for (const match of tweetMatches) {
      const tweet = tweetMap.get(match._id);
      if (tweet) tweets.push({ tweet, score: match._score });
    }

    const links = [] as Array<{ link: any; score: number }>;
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

export const vaultStats = query({
  args: {},
  handler: async (ctx) => {
    const tweets = await ctx.db.query("tweets").collect();
    const links = await ctx.db.query("links").collect();

    const withTweetEmbeddings = tweets.filter((t) => t.embedding).length;
    const withLinkEmbeddings = links.filter((l) => l.embedding).length;

    const authorCounts = new Map<string, number>();
    for (const tweet of tweets) {
      const username = tweet.author_username;
      authorCounts.set(username, (authorCounts.get(username) ?? 0) + 1);
    }

    const topAuthors = [...authorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([author]) => author);

    const domainCounts = new Map<string, number>();
    for (const link of links) {
      if (!link.domain) continue;
      domainCounts.set(link.domain, (domainCounts.get(link.domain) ?? 0) + 1);
    }

    const topDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain]) => domain);

    const lastSync = await ctx.db
      .query("sync_state")
      .order("desc")
      .first();

    return {
      total_tweets: tweets.length,
      total_links: links.length,
      tweets_with_embeddings: withTweetEmbeddings,
      links_with_embeddings: withLinkEmbeddings,
      top_authors: topAuthors,
      top_domains: topDomains,
      last_sync: lastSync?.last_sync_at ?? null,
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

    const tweets = await ctx.db.query("tweets").collect();
    const filtered = tweets.filter(
      (t) => t.author_username.toLowerCase() === username,
    );

    return filtered.slice(0, limit);
  },
});
