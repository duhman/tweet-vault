// Edge Function: Process tweets - generates embeddings and fetches link metadata
// Triggered daily via pg_cron or manually via HTTP POST

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ProcessResult {
  tweets_embedded: number;
  links_metadata_fetched: number;
  links_embedded: number;
  errors: string[];
}

// Generate embedding via OpenAI
async function generateEmbedding(
  text: string,
  openaiKey: string,
): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // Limit input length
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Fetch link metadata
async function fetchLinkMetadata(url: string): Promise<{
  title?: string;
  description?: string;
  domain?: string;
}> {
  try {
    // Expand t.co URLs
    let expandedUrl = url;
    if (url.includes("t.co/")) {
      const headResponse = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
      });
      expandedUrl = headResponse.url;
    }

    const domain = new URL(expandedUrl).hostname.replace(/^www\./, "");

    // Skip certain domains
    const skipDomains = [
      "t.co",
      "pic.twitter.com",
      "twitter.com",
      "x.com",
      "pbs.twimg.com",
    ];
    if (skipDomains.includes(domain)) {
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
      return { domain };
    }

    const html = await response.text();

    // Extract metadata with regex (no cheerio in Deno)
    const titleMatch =
      html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/) ||
      html.match(/<meta[^>]*name="twitter:title"[^>]*content="([^"]*)"/) ||
      html.match(/<title[^>]*>([^<]*)<\/title>/);

    const descMatch =
      html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/) ||
      html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/) ||
      html.match(/<meta[^>]*name="twitter:description"[^>]*content="([^"]*)"/);

    return {
      title: titleMatch?.[1]?.slice(0, 500),
      description: descMatch?.[1]?.slice(0, 2000),
      domain,
    };
  } catch (error) {
    console.error(`Failed to fetch metadata for ${url}:`, error);
    return {};
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const result: ProcessResult = {
      tweets_embedded: 0,
      links_metadata_fetched: 0,
      links_embedded: 0,
      errors: [],
    };

    // 1. Process tweets without embeddings (batch of 20)
    const { data: tweetsToEmbed, error: tweetsError } = await supabase
      .from("tweets")
      .select("id, content, author_username, author_name")
      .is("embedding", null)
      .limit(20);

    if (tweetsError) {
      result.errors.push(`Failed to fetch tweets: ${tweetsError.message}`);
    } else if (tweetsToEmbed && tweetsToEmbed.length > 0) {
      for (const tweet of tweetsToEmbed) {
        try {
          const text = `${tweet.author_name || tweet.author_username} (@${tweet.author_username}): ${tweet.content}`;
          const embedding = await generateEmbedding(text, openaiKey);

          const { error: updateError } = await supabase
            .from("tweets")
            .update({ embedding })
            .eq("id", tweet.id);

          if (updateError) {
            result.errors.push(
              `Failed to update tweet ${tweet.id}: ${updateError.message}`,
            );
          } else {
            result.tweets_embedded++;
          }
        } catch (error) {
          result.errors.push(
            `Failed to embed tweet ${tweet.id}: ${error.message}`,
          );
        }
      }
    }

    // 2. Fetch metadata for links without it (batch of 10)
    const { data: linksToFetch, error: linksError } = await supabase
      .from("links")
      .select("id, url, expanded_url")
      .is("title", null)
      .is("fetch_error", null)
      .limit(10);

    if (linksError) {
      result.errors.push(`Failed to fetch links: ${linksError.message}`);
    } else if (linksToFetch && linksToFetch.length > 0) {
      for (const link of linksToFetch) {
        try {
          const url = link.expanded_url || link.url;
          const metadata = await fetchLinkMetadata(url);

          const { error: updateError } = await supabase
            .from("links")
            .update({
              title: metadata.title,
              description: metadata.description,
              domain: metadata.domain,
              fetched_at: new Date().toISOString(),
            })
            .eq("id", link.id);

          if (updateError) {
            result.errors.push(
              `Failed to update link ${link.id}: ${updateError.message}`,
            );
          } else {
            result.links_metadata_fetched++;
          }
        } catch (error) {
          await supabase
            .from("links")
            .update({ fetch_error: error.message })
            .eq("id", link.id);
          result.errors.push(
            `Failed to fetch link ${link.id}: ${error.message}`,
          );
        }
      }
    }

    // 3. Generate embeddings for links with metadata but no embedding (batch of 10)
    const { data: linksToEmbed, error: embedLinksError } = await supabase
      .from("links")
      .select("id, url, title, description, domain")
      .is("embedding", null)
      .not("title", "is", null)
      .limit(10);

    if (embedLinksError) {
      result.errors.push(
        `Failed to fetch links for embedding: ${embedLinksError.message}`,
      );
    } else if (linksToEmbed && linksToEmbed.length > 0) {
      for (const link of linksToEmbed) {
        try {
          const text = [link.title, link.description, link.domain, link.url]
            .filter(Boolean)
            .join(" | ");

          const embedding = await generateEmbedding(text, openaiKey);

          const { error: updateError } = await supabase
            .from("links")
            .update({ embedding })
            .eq("id", link.id);

          if (updateError) {
            result.errors.push(
              `Failed to update link embedding ${link.id}: ${updateError.message}`,
            );
          } else {
            result.links_embedded++;
          }
        } catch (error) {
          result.errors.push(
            `Failed to embed link ${link.id}: ${error.message}`,
          );
        }
      }
    }

    // 4. Record sync state
    await supabase.from("sync_state").insert({
      last_sync_at: new Date().toISOString(),
      tweets_added: 0, // This is for new tweet imports
      links_processed: result.links_metadata_fetched,
      embeddings_generated: result.tweets_embedded + result.links_embedded,
      sync_type: "cron",
      metadata: {
        tweets_embedded: result.tweets_embedded,
        links_metadata_fetched: result.links_metadata_fetched,
        links_embedded: result.links_embedded,
        errors_count: result.errors.length,
      },
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Process tweets error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
