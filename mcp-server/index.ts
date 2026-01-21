#!/usr/bin/env node
/**
 * Tweet Vault MCP Server
 * Semantic search over Twitter bookmarks using Supabase
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

// Load environment variables
config();

// Environment validation
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

// Initialize clients
const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema },
});
const openai = new OpenAI({ apiKey: openaiKey });

// Generate embedding for a query
async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

// Type definitions
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
}

interface LinkSearchResult extends Link {
  similarity: number;
}

// Define available tools
const tools: Tool[] = [
  {
    name: "search_tweets",
    description:
      "Search bookmarked tweets using semantic similarity. Returns tweets that are semantically similar to your query. Use this to find relevant tweets about specific topics, technologies, ideas, or concepts.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query - describe what you're looking for in natural language",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10, max: 50)",
          default: 10,
        },
        threshold: {
          type: "number",
          description:
            "Minimum similarity threshold 0-1 (default: 0.5, higher = more relevant)",
          default: 0.5,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_links",
    description:
      "Search extracted links from tweets using semantic similarity. Returns links with titles and descriptions that match your query. Use this to find articles, resources, or tools mentioned in bookmarked tweets.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query - describe what kind of links you're looking for",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10, max: 50)",
          default: 10,
        },
        threshold: {
          type: "number",
          description:
            "Minimum similarity threshold 0-1 (default: 0.5, higher = more relevant)",
          default: 0.5,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_tweet",
    description:
      "Get a specific tweet by its Twitter ID. Returns full tweet content including author, metrics, and extracted links.",
    inputSchema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "The Twitter/X tweet ID",
        },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "list_links_by_domain",
    description:
      "List all extracted links from a specific domain. Use this to find all resources from a particular website (e.g., 'github.com', 'youtube.com').",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "The domain to filter by (e.g., 'github.com')",
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
    description:
      "Find tweets and links related to a topic or project idea. This combines tweet and link search to surface relevant inspiration and resources. Use this when brainstorming or researching a new project.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The topic or project idea to find related content for",
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
      "Get statistics about the tweet vault including total counts, top authors, top domains, and last sync information.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_authors",
    description:
      "List tweets from a specific Twitter author. Use this to see what content from a particular person you've bookmarked.",
    inputSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Twitter username (without @) to filter by",
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

// Tool implementations
async function handleSearchTweets(
  query: string,
  limit = 10,
  threshold = 0.5,
): Promise<string> {
  const embedding = await getEmbedding(query);

  const { data, error } = await supabase.rpc("search_tweets", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: threshold,
    match_count: Math.min(limit, 50),
  });

  if (error) throw error;

  const results: TweetSearchResult[] = data || [];

  if (results.length === 0) {
    return "No matching tweets found. Try a broader search query or lower the similarity threshold.";
  }

  return results
    .map(
      (tweet, i) =>
        `${i + 1}. **@${tweet.author_username}** (${(tweet.similarity * 100).toFixed(1)}% match)
   ${tweet.content.slice(0, 280)}${tweet.content.length > 280 ? "..." : ""}
   📅 ${tweet.created_at ? new Date(tweet.created_at).toLocaleDateString() : "Unknown date"}
   ❤️ ${tweet.metrics?.likes ?? 0} | 🔁 ${tweet.metrics?.retweets ?? 0}
   🔗 Tweet ID: ${tweet.tweet_id}`,
    )
    .join("\n\n");
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
    return "No matching links found. Try a broader search query or lower the similarity threshold.";
  }

  return results
    .map(
      (link, i) =>
        `${i + 1}. **${link.title || "Untitled"}** (${(link.similarity * 100).toFixed(1)}% match)
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

  // Get links for this tweet
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
        (link: Link, i: number) =>
          `${i + 1}. **${link.title || "Untitled"}**
   ${link.expanded_url || link.url}
   From tweet_id: ${link.tweet_id ?? "unknown"}`,
      )
      .join("\n\n")
  );
}

async function handleFindRelated(topic: string, limit = 5): Promise<string> {
  const embedding = await getEmbedding(topic);

  // Search tweets
  const { data: tweets } = await supabase.rpc("search_tweets", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.5,
    match_count: limit,
  });

  // Search links
  const { data: links } = await supabase.rpc("search_links", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.5,
    match_count: limit,
  });

  let result = `## Related content for: "${topic}"\n\n`;

  const tweetResults: TweetSearchResult[] = tweets || [];
  const linkResults: LinkSearchResult[] = links || [];

  if (tweetResults.length > 0) {
    result += "### 📱 Related Tweets\n\n";
    result += tweetResults
      .map(
        (tweet, i) =>
          `${i + 1}. **@${tweet.author_username}** (${(tweet.similarity * 100).toFixed(0)}%)
   ${tweet.content.slice(0, 200)}...`,
      )
      .join("\n\n");
  } else {
    result += "### 📱 Related Tweets\nNo matching tweets found.\n";
  }

  result += "\n\n";

  if (linkResults.length > 0) {
    result += "### 🔗 Related Links\n\n";
    result += linkResults
      .map(
        (link, i) =>
          `${i + 1}. **${link.title || "Untitled"}** (${(link.similarity * 100).toFixed(0)}%)
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
  authorData?.forEach((t) => {
    if (t.author_username) {
      authorCounts[t.author_username] =
        (authorCounts[t.author_username] || 0) + 1;
    }
  });
  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([author]) => author);

  // Get top domains
  const { data: domainData } = await supabase
    .from("links")
    .select("domain")
    .not("domain", "is", null);

  const domainCounts: Record<string, number> = {};
  domainData?.forEach((l) => {
    if (l.domain) {
      domainCounts[l.domain] = (domainCounts[l.domain] || 0) + 1;
    }
  });
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain]) => domain);

  // Get last sync
  const { data: syncData } = await supabase
    .from("sync_state")
    .select("last_sync_at")
    .order("last_sync_at", { ascending: false })
    .limit(1);

  let result = `## 📊 Tweet Vault Statistics

**Totals:**
- Tweets: ${totalTweets ?? 0}
- Links: ${totalLinks ?? 0}
- Tweets with embeddings: ${tweetsWithEmbeddings ?? 0}
- Links with embeddings: ${linksWithEmbeddings ?? 0}`;

  if (topAuthors.length > 0) {
    result += "\n\n**Top Authors:**\n";
    result += topAuthors.map((a) => `- @${a}`).join("\n");
  }

  if (topDomains.length > 0) {
    result += "\n\n**Top Domains:**\n";
    result += topDomains.map((d) => `- ${d}`).join("\n");
  }

  if (syncData?.[0]?.last_sync_at) {
    result += `\n\n**Last Sync:**
- Time: ${new Date(syncData[0].last_sync_at).toLocaleString()}`;
  }

  return result;
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
    return `No bookmarked tweets found from @${username}.`;
  }

  return (
    `Found ${tweets.length} bookmarked tweets from @${username}:\n\n` +
    tweets
      .map(
        (tweet: Tweet, i: number) =>
          `${i + 1}. ${tweet.content.slice(0, 200)}${tweet.content.length > 200 ? "..." : ""}
   📅 ${tweet.created_at ? new Date(tweet.created_at).toLocaleDateString() : "Unknown"}
   ❤️ ${tweet.metrics?.likes ?? 0} | 🔁 ${tweet.metrics?.retweets ?? 0}`,
      )
      .join("\n\n")
  );
}

// Create and run server
const server = new Server(
  {
    name: "tweet-vault",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

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

// Start server
const transport = new StdioServerTransport();
console.error("Tweet Vault MCP Server v2.0.0 (Supabase) running on stdio");
server.connect(transport).catch(console.error);
