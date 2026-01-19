import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getTweetsWithoutEmbedding = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("tweets")
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .take(args.limit);
  },
});

export const getTweetsByIds = internalQuery({
  args: { ids: v.array(v.id("tweets")) },
  handler: async (ctx, args) => {
    return Promise.all(args.ids.map((id) => ctx.db.get(id)));
  },
});

export const getLinksByIds = internalQuery({
  args: { ids: v.array(v.id("links")) },
  handler: async (ctx, args) => {
    return Promise.all(args.ids.map((id) => ctx.db.get(id)));
  },
});

export const getLikesWithoutEmbedding = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("twitter_likes")
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .filter((q) => q.neq(q.field("content"), undefined))
      .take(args.limit);
  },
});

export const getLinksWithoutMetadata = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("links")
      .filter((q) => q.eq(q.field("title"), undefined))
      .filter((q) => q.eq(q.field("fetched_at"), undefined))
      .filter((q) => q.eq(q.field("fetch_error"), undefined))
      .take(args.limit);
  },
});

export const getLinksWithoutEmbedding = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("links")
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .filter((q) => q.neq(q.field("title"), undefined))
      .take(args.limit);
  },
});

export const setTweetEmbedding = internalMutation({
  args: { id: v.id("tweets"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      embedding: args.embedding,
      processed_at: new Date().toISOString(),
    });
  },
});

export const setLikeEmbedding = internalMutation({
  args: { id: v.id("twitter_likes"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { embedding: args.embedding });
  },
});

export const updateLinkMetadata = internalMutation({
  args: {
    id: v.id("links"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    domain: v.optional(v.string()),
    content_type: v.optional(v.string()),
    fetched_at: v.optional(v.string()),
    search_text: v.optional(v.string()),
    fetch_error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      title: args.title ?? undefined,
      description: args.description ?? undefined,
      domain: args.domain ?? undefined,
      content_type: args.content_type ?? undefined,
      fetched_at: args.fetched_at ?? undefined,
      search_text: args.search_text ?? undefined,
      fetch_error: args.fetch_error ?? undefined,
    });
  },
});

export const setLinkEmbedding = internalMutation({
  args: { id: v.id("links"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { embedding: args.embedding });
  },
});

export const insertSyncState = internalMutation({
  args: {
    id: v.number(),
    last_sync_at: v.string(),
    tweets_added: v.number(),
    links_processed: v.number(),
    embeddings_generated: v.number(),
    sync_type: v.string(),
    error_message: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sync_state", {
      id: args.id,
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

export const getLatestSyncState = internalQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("sync_state").order("desc").first();
  },
});
