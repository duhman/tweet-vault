import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tweets: defineTable({
    id: v.string(),
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
    links_extracted_at: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_legacy_id", ["id"])
    .index("by_tweet_id", ["tweet_id"])
    .index("by_author", ["author_username"])
    .searchIndex("search_content", { searchField: "content" })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),

  links: defineTable({
    id: v.string(),
    tweet_id: v.optional(v.string()),
    url: v.string(),
    expanded_url: v.optional(v.string()),
    display_url: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    og_image: v.optional(v.string()),
    domain: v.optional(v.string()),
    content_type: v.optional(v.string()),
    fetched_at: v.optional(v.string()),
    fetch_error: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    search_text: v.optional(v.string()),
  })
    .index("by_tweet_id", ["tweet_id"])
    .index("by_tweet_url", ["tweet_id", "url"])
    .index("by_domain", ["domain"])
    .searchIndex("search_text", { searchField: "search_text" })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),

  sync_state: defineTable({
    id: v.number(),
    last_sync_at: v.optional(v.string()),
    tweets_added: v.optional(v.number()),
    links_processed: v.optional(v.number()),
    embeddings_generated: v.optional(v.number()),
    sync_type: v.optional(v.string()),
    error_message: v.optional(v.string()),
    metadata: v.optional(v.any()),
  }).index("by_state_id", ["id"]),

  twitter_likes: defineTable({
    id: v.string(),
    tweet_id: v.string(),
    content: v.optional(v.string()),
    author_id: v.optional(v.string()),
    author_name: v.optional(v.string()),
    liked_at: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    metadata: v.optional(v.any()),
    source: v.optional(v.string()),
    synced_at: v.optional(v.string()),
    updated_at: v.optional(v.string()),
    created_at: v.optional(v.string()),
  })
    .index("by_legacy_id", ["id"])
    .index("by_tweet_id", ["tweet_id"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),
});
