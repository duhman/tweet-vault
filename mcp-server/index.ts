#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import {
  searchTweets,
  searchLinks,
  getStats,
  getTweetByTweetId,
  getSupabaseClient,
  Tweet,
  Link,
} from "../src/utils/supabase.js";
import { generateEmbedding } from "../src/utils/openai.js";

// Load environment variables
config();

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
  const embedding = await generateEmbedding(query);
  const results = await searchTweets(embedding, threshold, Math.min(limit, 50));

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
  const embedding = await generateEmbedding(query);
  const results = await searchLinks(embedding, threshold, Math.min(limit, 50));

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
  const tweet = await getTweetByTweetId(tweetId);

  if (!tweet) {
    return `Tweet with ID ${tweetId} not found in the vault.`;
  }

  // Get associated links
  const client = getSupabaseClient();
  const { data: links } = await client
    .from("links")
    .select("*")
    .eq("tweet_id", tweet.id);

  let result = `**@${tweet.author_username}** ${tweet.author_name ? `(${tweet.author_name})` : ""}
📅 ${tweet.created_at ? new Date(tweet.created_at).toLocaleDateString() : "Unknown date"}

${tweet.content}

📊 Metrics: ❤️ ${tweet.metrics?.likes ?? 0} | 🔁 ${tweet.metrics?.retweets ?? 0} | 💬 ${tweet.metrics?.replies ?? 0}`;

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
    result += tweet.media_urls.map((url) => `- ${url}`).join("\n");
  }

  return result;
}

async function handleListLinksByDomain(
  domain: string,
  limit = 20,
): Promise<string> {
  const client = getSupabaseClient();
  const { data: links, error } = await client
    .from("links")
    .select("*, tweets!inner(author_username, content)")
    .ilike("domain", `%${domain}%`)
    .limit(limit);

  if (error) {
    return `Error fetching links: ${error.message}`;
  }

  if (!links || links.length === 0) {
    return `No links found from domain "${domain}".`;
  }

  return (
    `Found ${links.length} links from "${domain}":\n\n` +
    links
      .map(
        (
          link: Link & { tweets: { author_username: string; content: string } },
          i: number,
        ) =>
          `${i + 1}. **${link.title || "Untitled"}**
   ${link.expanded_url || link.url}
   From tweet by @${link.tweets.author_username}`,
      )
      .join("\n\n")
  );
}

async function handleFindRelated(topic: string, limit = 5): Promise<string> {
  const embedding = await generateEmbedding(topic);

  const [tweets, links] = await Promise.all([
    searchTweets(embedding, 0.5, limit),
    searchLinks(embedding, 0.5, limit),
  ]);

  let result = `## Related content for: "${topic}"\n\n`;

  if (tweets.length > 0) {
    result += "### 📱 Related Tweets\n\n";
    result += tweets
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

  if (links.length > 0) {
    result += "### 🔗 Related Links\n\n";
    result += links
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
  const stats = await getStats();

  let result = `## 📊 Tweet Vault Statistics

**Totals:**
- Tweets: ${stats.total_tweets}
- Links: ${stats.total_links}
- Tweets with embeddings: ${stats.tweets_with_embeddings}
- Links with embeddings: ${stats.links_with_embeddings}`;

  if (stats.top_authors && stats.top_authors.length > 0) {
    result += "\n\n**Top Authors:**\n";
    result += stats.top_authors
      .slice(0, 5)
      .map((a) => `- @${a.author_username}: ${a.tweet_count} tweets`)
      .join("\n");
  }

  if (stats.top_domains && stats.top_domains.length > 0) {
    result += "\n\n**Top Domains:**\n";
    result += stats.top_domains
      .slice(0, 5)
      .map((d) => `- ${d.domain}: ${d.link_count} links`)
      .join("\n");
  }

  if (stats.last_sync) {
    result += `\n\n**Last Sync:**
- Time: ${new Date(stats.last_sync.last_sync_at).toLocaleString()}
- Tweets added: ${stats.last_sync.tweets_added}
- Links processed: ${stats.last_sync.links_processed}`;
  }

  return result;
}

async function handleListAuthors(
  username: string,
  limit = 20,
): Promise<string> {
  const client = getSupabaseClient();
  const { data: tweets, error } = await client
    .from("tweets")
    .select("*")
    .ilike("author_username", username)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return `Error fetching tweets: ${error.message}`;
  }

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
    version: "1.0.0",
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
server.connect(transport).catch(console.error);
