#!/usr/bin/env node
/**
 * Tweet Vault MCP Server
 * Semantic search over Twitter bookmarks + likes using Supabase
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const schema = process.env.SUPABASE_SCHEMA || "tweet_vault";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}
if (!openaiKey) {
  throw new Error("OPENAI_API_KEY is required for embeddings");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema },
});
const openai = new OpenAI({ apiKey: openaiKey });

type InteractionFilter = "all" | "bookmark" | "like";

interface Tweet {
  id: number;
  tweet_id: string;
  author_username: string;
  author_name?: string;
  author_profile_image?: string;
  content: string;
  created_at?: string;
  media_urls?: string[];
  metrics?: {
    likes?: number;
    retweets?: number;
    replies?: number;
  };
}

interface Link {
  id: number;
  tweet_id: string;
  url: string;
  expanded_url?: string;
  display_url?: string;
  title?: string;
  description?: string;
  og_image?: string;
  domain?: string;
}

interface TweetSearchResult extends Tweet {
  similarity: number;
  interaction_types?: string[];
  primary_interaction?: string;
}

interface LinkSearchResult extends Link {
  similarity: number;
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

function normalizeInteractionFilter(value?: string): InteractionFilter {
  if (value === "bookmark" || value === "like") return value;
  return "all";
}

async function searchTweetsRpc(
  embedding: number[],
  threshold: number,
  limit: number,
  interactionType: InteractionFilter,
): Promise<TweetSearchResult[]> {
  const params = {
    query_embedding: JSON.stringify(embedding),
    match_threshold: threshold,
    match_count: Math.min(limit, 50),
  };

  const { data, error } = await supabase.rpc("search_tweets", params);

  if (error) throw error;

  const rows: TweetSearchResult[] = data || [];
  if (rows.length === 0) return rows;

  const ids = rows.map((row) => row.tweet_id);
  const { data: interactions, error: interactionError } = await supabase
    .from("tweet_interactions")
    .select("tweet_id,interaction_type")
    .in("tweet_id", ids);

  if (interactionError) {
    if (interactionType === "all") return rows;
    return [];
  }

  const interactionMap = new Map<string, string[]>();
  for (const interaction of interactions ?? []) {
    const list = interactionMap.get(interaction.tweet_id) || [];
    if (!list.includes(interaction.interaction_type)) {
      list.push(interaction.interaction_type);
    }
    interactionMap.set(interaction.tweet_id, list);
  }

  const enriched = rows.map((row) => {
    const types = interactionMap.get(row.tweet_id) || ["bookmark"];
    return {
      ...row,
      interaction_types: types,
      primary_interaction: types[0],
    };
  });

  if (interactionType === "all") return enriched;
  return enriched.filter((row) =>
    (row.interaction_types || []).includes(interactionType),
  );
}

const tools: Tool[] = [
  {
    name: "search_tweets",
    description:
      "Semantic search over saved tweets. Returns bookmarks and likes by default, with optional filtering by interaction type.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language description of the tweet content to find",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10, max: 50)",
          default: 10,
        },
        threshold: {
          type: "number",
          description: "Minimum similarity threshold 0-1 (default: 0.5)",
          default: 0.5,
        },
        interaction_type: {
          type: "string",
          enum: ["all", "bookmark", "like"],
          description:
            "Filter result source: all interactions (default), bookmark only, or like only",
          default: "all",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_likes",
    description:
      "Semantic search over liked tweets only. Thin wrapper over search_tweets(interaction_type='like').",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query for liked tweet content",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10, max: 50)",
          default: 10,
        },
        threshold: {
          type: "number",
          description: "Minimum similarity threshold 0-1 (default: 0.5)",
          default: 0.5,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_links",
    description:
      "Search extracted links from tweets using semantic similarity.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query for links/resources",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10, max: 50)",
          default: 10,
        },
        threshold: {
          type: "number",
          description: "Minimum similarity threshold 0-1 (default: 0.5)",
          default: 0.5,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_tweet",
    description:
      "Get a specific tweet by Twitter ID, including links and interaction metadata.",
    inputSchema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "Twitter/X tweet ID",
        },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "list_links_by_domain",
    description: "List extracted links from a specific domain.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Domain to filter by (e.g., github.com)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          default: 20,
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "find_related",
    description: "Find related tweets and links for a topic.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Topic to search related content for",
        },
        limit: {
          type: "number",
          description: "Maximum results per category (default: 5)",
          default: 5,
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "vault_stats",
    description:
      "Get Tweet Vault statistics (tweets, links, embeddings, bookmarks, likes, top authors/domains).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_authors",
    description: "List saved tweets from a specific Twitter author.",
    inputSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Twitter username (without @)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          default: 20,
        },
      },
      required: ["username"],
    },
  },
];

async function handleSearchTweets(
  query: string,
  limit = 10,
  threshold = 0.5,
  interactionType: InteractionFilter = "all",
): Promise<string> {
  const embedding = await getEmbedding(query);
  const results = await searchTweetsRpc(
    embedding,
    threshold,
    limit,
    interactionType,
  );

  if (results.length === 0) {
    return "No matching tweets found. Try a broader query or lower threshold.";
  }

  return results
    .map((tweet, i) => {
      const interactions = tweet.interaction_types?.length
        ? tweet.interaction_types.join(", ")
        : tweet.primary_interaction || "bookmark";
      return `${i + 1}. **@${tweet.author_username}** (${(tweet.similarity * 100).toFixed(1)}% match)
   [${interactions}] ${tweet.content.slice(0, 280)}${tweet.content.length > 280 ? "..." : ""}
   📅 ${tweet.created_at ? new Date(tweet.created_at).toLocaleDateString() : "Unknown date"}
   ❤️ ${tweet.metrics?.likes ?? 0} | 🔁 ${tweet.metrics?.retweets ?? 0}
   🔗 Tweet ID: ${tweet.tweet_id}`;
    })
    .join("\n\n");
}

async function handleSearchLikes(
  query: string,
  limit = 10,
  threshold = 0.5,
): Promise<string> {
  return handleSearchTweets(query, limit, threshold, "like");
}

async function handleSearchLinks(
  query: string,
  limit = 10,
  threshold = 0.5,
): Promise<string> {
  const embedding = await getEmbedding(query);

  const { data, error } = await supabase.rpc("search_links", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: threshold,
    match_count: Math.min(limit, 50),
  });

  if (error) throw error;

  const results: LinkSearchResult[] = data || [];
  if (results.length === 0) {
    return "No matching links found. Try a broader query or lower threshold.";
  }

  return results
    .map(
      (link, i) => `${i + 1}. **${link.title || "Untitled"}** (${(link.similarity * 100).toFixed(1)}% match)
   ${link.description?.slice(0, 200) || "No description"}${(link.description?.length ?? 0) > 200 ? "..." : ""}
   🌐 ${link.domain || "Unknown domain"}
   🔗 ${link.expanded_url || link.url}`,
    )
    .join("\n\n");
}

async function handleGetTweet(tweetId: string): Promise<string> {
  const { data: tweet, error } = await supabase
    .from("tweets")
    .select("*")
    .eq("tweet_id", tweetId)
    .single();

  if (error || !tweet) {
    return `Tweet with ID ${tweetId} not found in the vault.`;
  }

  let result = `**@${tweet.author_username}** ${tweet.author_name ? `(${tweet.author_name})` : ""}
📅 ${tweet.created_at ? new Date(tweet.created_at).toLocaleDateString() : "Unknown date"}

${tweet.content}

📊 Metrics: ❤️ ${tweet.metrics?.likes ?? 0} | 🔁 ${tweet.metrics?.retweets ?? 0} | 💬 ${tweet.metrics?.replies ?? 0}`;

  const { data: interactions } = await supabase
    .from("tweet_interactions")
    .select("interaction_type,interaction_at,source")
    .eq("tweet_id", tweetId)
    .order("interaction_at", { ascending: false });

  if (interactions && interactions.length > 0) {
    result += "\n\n🧩 **Interactions:**\n";
    result += interactions
      .map(
        (item: {
          interaction_type: string;
          interaction_at?: string;
          source?: string;
        }) =>
          `- ${item.interaction_type}${item.interaction_at ? ` @ ${new Date(item.interaction_at).toLocaleString()}` : ""}${item.source ? ` (${item.source})` : ""}`,
      )
      .join("\n");
  }

  const { data: links } = await supabase
    .from("links")
    .select("*")
    .eq("tweet_id", tweetId);

  if (links && links.length > 0) {
    result += "\n\n🔗 **Extracted Links:**\n";
    result += links
      .map(
        (link: Link) =>
          `- ${link.title || link.url}\n  ${link.expanded_url || link.url}`,
      )
      .join("\n");
  }

  if (tweet.media_urls && tweet.media_urls.length > 0) {
    result += "\n\n🖼️ **Media:**\n";
    result += tweet.media_urls.map((url: string) => `- ${url}`).join("\n");
  }

  return result;
}

async function handleListLinksByDomain(
  domain: string,
  limit = 20,
): Promise<string> {
  const { data: links, error } = await supabase
    .from("links")
    .select("*")
    .ilike("domain", `%${domain}%`)
    .limit(limit);

  if (error) throw error;
  if (!links || links.length === 0) {
    return `No links found from domain "${domain}".`;
  }

  return (
    `Found ${links.length} links from "${domain}":\n\n` +
    links
      .map(
        (link: Link, i: number) => `${i + 1}. **${link.title || "Untitled"}**
   ${link.expanded_url || link.url}
   From tweet_id: ${link.tweet_id ?? "unknown"}`,
      )
      .join("\n\n")
  );
}

async function handleFindRelated(topic: string, limit = 5): Promise<string> {
  const embedding = await getEmbedding(topic);

  const tweetResults = await searchTweetsRpc(embedding, 0.5, limit, "all");

  const { data: links } = await supabase.rpc("search_links", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.5,
    match_count: limit,
  });

  const linkResults: LinkSearchResult[] = links || [];

  let result = `## Related content for: "${topic}"\n\n`;

  if (tweetResults.length > 0) {
    result += "### 📱 Related Tweets\n\n";
    result += tweetResults
      .map((tweet, i) => {
        const source = tweet.primary_interaction || "bookmark";
        return `${i + 1}. **@${tweet.author_username}** (${(tweet.similarity * 100).toFixed(0)}%) [${source}]
   ${tweet.content.slice(0, 200)}...`;
      })
      .join("\n\n");
  } else {
    result += "### 📱 Related Tweets\nNo matching tweets found.\n";
  }

  result += "\n\n";

  if (linkResults.length > 0) {
    result += "### 🔗 Related Links\n\n";
    result += linkResults
      .map(
        (link, i) => `${i + 1}. **${link.title || "Untitled"}** (${(link.similarity * 100).toFixed(0)}%)
   ${link.expanded_url || link.url}
   ${link.description?.slice(0, 100) || ""}...`,
      )
      .join("\n\n");
  } else {
    result += "### 🔗 Related Links\nNo matching links found.\n";
  }

  return result;
}

async function handleVaultStats(): Promise<string> {
  const { data: stats, error } = await supabase.rpc("vault_stats");

  if (!error && stats) {
    const topAuthors = Array.isArray(stats.top_authors)
      ? stats.top_authors
          .map((item: { author_username?: string }) => item.author_username)
          .filter(Boolean)
      : [];

    const topDomains = Array.isArray(stats.top_domains)
      ? stats.top_domains
          .map((item: { domain?: string }) => item.domain)
          .filter(Boolean)
      : [];

    let response = `## 📊 Tweet Vault Statistics

**Totals:**
- Tweets: ${stats.total_tweets ?? 0}
- Links: ${stats.total_links ?? 0}
- Tweets with embeddings: ${stats.tweets_with_embeddings ?? 0}
- Links with embeddings: ${stats.links_with_embeddings ?? 0}
- Bookmarks: ${stats.bookmarks_count ?? 0}
- Likes: ${stats.likes_count ?? 0}`;

    if (topAuthors.length > 0) {
      response += "\n\n**Top Authors:**\n";
      response += topAuthors.map((a: string) => `- @${a}`).join("\n");
    }

    if (topDomains.length > 0) {
      response += "\n\n**Top Domains:**\n";
      response += topDomains.map((d: string) => `- ${d}`).join("\n");
    }

    if (stats.last_sync?.last_sync_at) {
      response += `\n\n**Last Sync:**\n- Time: ${new Date(stats.last_sync.last_sync_at).toLocaleString()}`;
    }

    return response;
  }

  // Fallback for pre-migration environments.
  const { count: totalTweets } = await supabase
    .from("tweets")
    .select("*", { count: "exact", head: true });

  const { count: totalLinks } = await supabase
    .from("links")
    .select("*", { count: "exact", head: true });

  return `## 📊 Tweet Vault Statistics

**Totals:**
- Tweets: ${totalTweets ?? 0}
- Links: ${totalLinks ?? 0}`;
}

async function handleListAuthors(
  username: string,
  limit = 20,
): Promise<string> {
  const { data: tweets, error } = await supabase
    .from("tweets")
    .select("*")
    .ilike("author_username", username)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  if (!tweets || tweets.length === 0) {
    return `No saved tweets found from @${username}.`;
  }

  return (
    `Found ${tweets.length} saved tweets from @${username}:\n\n` +
    tweets
      .map(
        (tweet: Tweet, i: number) => `${i + 1}. ${tweet.content.slice(0, 200)}${tweet.content.length > 200 ? "..." : ""}
   📅 ${tweet.created_at ? new Date(tweet.created_at).toLocaleDateString() : "Unknown"}
   ❤️ ${tweet.metrics?.likes ?? 0} | 🔁 ${tweet.metrics?.retweets ?? 0}`,
      )
      .join("\n\n")
  );
}

const server = new Server(
  {
    name: "tweet-vault",
    version: "2.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "search_tweets":
        result = await handleSearchTweets(
          args?.query as string,
          args?.limit as number,
          args?.threshold as number,
          normalizeInteractionFilter(args?.interaction_type as string),
        );
        break;
      case "search_likes":
        result = await handleSearchLikes(
          args?.query as string,
          args?.limit as number,
          args?.threshold as number,
        );
        break;
      case "search_links":
        result = await handleSearchLinks(
          args?.query as string,
          args?.limit as number,
          args?.threshold as number,
        );
        break;
      case "get_tweet":
        result = await handleGetTweet(args?.tweet_id as string);
        break;
      case "list_links_by_domain":
        result = await handleListLinksByDomain(
          args?.domain as string,
          args?.limit as number,
        );
        break;
      case "find_related":
        result = await handleFindRelated(
          args?.topic as string,
          args?.limit as number,
        );
        break;
      case "vault_stats":
        result = await handleVaultStats();
        break;
      case "list_authors":
        result = await handleListAuthors(
          args?.username as string,
          args?.limit as number,
        );
        break;
      default:
        result = `Unknown tool: ${name}`;
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
console.error("Tweet Vault MCP Server v2.1.0 (Supabase) running on stdio");
server.connect(transport).catch(console.error);
