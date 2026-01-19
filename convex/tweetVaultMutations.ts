import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const upsertTweets = mutation({
  args: {
    tweets: v.array(
      v.object({
        id: v.optional(v.string()),
        tweet_id: v.string(),
        author_username: v.string(),
        author_name: v.optional(v.string()),
        author_profile_image: v.optional(v.string()),
        content: v.string(),
        created_at: v.optional(v.string()),
        media_urls: v.optional(v.array(v.string())),
        metrics: v.optional(v.any()),
        raw_data: v.optional(v.any()),
        fetched_at: v.optional(v.string()),
        processed_at: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const added: string[] = [];
    const updated: string[] = [];
    const seen = new Set<string>();

    for (const tweet of args.tweets) {
      if (seen.has(tweet.tweet_id)) continue;
      seen.add(tweet.tweet_id);

      const existing = await ctx.db
        .query("tweets")
        .withIndex("by_tweet_id", (q) => q.eq("tweet_id", tweet.tweet_id))
        .unique();

      const payload = {
        id: tweet.id ?? tweet.tweet_id,
        tweet_id: tweet.tweet_id,
        author_username: tweet.author_username,
        author_name: tweet.author_name,
        author_profile_image: tweet.author_profile_image,
        content: tweet.content,
        created_at: tweet.created_at,
        media_urls: tweet.media_urls,
        metrics: tweet.metrics,
        raw_data: tweet.raw_data,
        fetched_at: tweet.fetched_at ?? now,
        processed_at: tweet.processed_at,
      };

      if (existing) {
        await ctx.db.patch(existing._id, payload);
        updated.push(tweet.tweet_id);
      } else {
        await ctx.db.insert("tweets", payload);
        added.push(tweet.tweet_id);
      }
    }

    return { added, updated };
  },
});

export const upsertLinks = mutation({
  args: {
    links: v.array(
      v.object({
        id: v.optional(v.string()),
        tweet_id: v.string(),
        url: v.string(),
        expanded_url: v.optional(v.string()),
        display_url: v.optional(v.string()),
        domain: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;
    const seen = new Set<string>();

    for (const link of args.links) {
      const key = `${link.tweet_id}::${link.url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = await ctx.db
        .query("links")
        .withIndex("by_tweet_url", (q) =>
          q.eq("tweet_id", link.tweet_id).eq("url", link.url),
        )
        .unique();

      const payload = {
        id: link.id ?? `${link.tweet_id}:${link.url}`,
        tweet_id: link.tweet_id,
        url: link.url,
        expanded_url: link.expanded_url,
        display_url: link.display_url,
        domain: link.domain,
      };

      if (existing) {
        await ctx.db.patch(existing._id, payload);
        updated += 1;
      } else {
        await ctx.db.insert("links", payload);
        inserted += 1;
      }
    }

    return { inserted, updated };
  },
});

export const recordSync = mutation({
  args: {
    last_sync_at: v.string(),
    tweets_added: v.number(),
    links_processed: v.number(),
    embeddings_generated: v.number(),
    sync_type: v.string(),
    error_message: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    await ctx.db.insert("sync_state", {
      id,
      last_sync_at: args.last_sync_at,
      tweets_added: args.tweets_added,
      links_processed: args.links_processed,
      embeddings_generated: args.embeddings_generated,
      sync_type: args.sync_type,
      error_message: args.error_message,
      metadata: args.metadata,
    });
  },
});
