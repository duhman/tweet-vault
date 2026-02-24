// Edge Function: Process pending metadata + embeddings in tweet_vault schema.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EMBEDDING_MODEL = "text-embedding-3-small";
const SCHEMA = Deno.env.get("SUPABASE_SCHEMA") || "tweet_vault";

interface ProcessResult {
  tweets_embedded: number;
  links_metadata_fetched: number;
  links_embedded: number;
  errors: string[];
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= retries) break;
      await sleep(Math.min(4000, 200 * 2 ** attempt));
    }
  }

  throw lastError;
}

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
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function fetchLinkMetadata(url: string): Promise<{
  title?: string;
  description?: string;
  domain?: string;
  fetch_error?: string;
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

    if (!response.ok) {
      return { domain, fetch_error: `http-${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return { domain, fetch_error: "content-not-html" };
    }

    const html = await response.text();

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
    return {
      fetch_error: error instanceof Error ? error.message.slice(0, 180) : "metadata-fetch-failed",
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    const supabase = createClient(supabaseUrl, supabaseKey, {
      db: { schema: SCHEMA },
    });

    const result: ProcessResult = {
      tweets_embedded: 0,
      links_metadata_fetched: 0,
      links_embedded: 0,
      errors: [],
    };

    const { data: tweetsToEmbed, error: tweetsError } = await supabase
      .from("tweets")
      .select("id, tweet_id, content, author_username, author_name")
      .is("embedding", null)
      .limit(20);

    if (tweetsError) {
      result.errors.push(`Failed to fetch tweets: ${tweetsError.message}`);
    } else {
      for (const tweet of tweetsToEmbed ?? []) {
        try {
          const text = `${tweet.author_name || tweet.author_username} (@${tweet.author_username}): ${tweet.content}`;
          const embedding = await withRetry(() => generateEmbedding(text, openaiKey));

          const { error: updateError } = await supabase
            .from("tweets")
            .update({ embedding, processed_at: new Date().toISOString() })
            .eq("tweet_id", tweet.tweet_id);

          if (updateError) {
            result.errors.push(
              `Failed to update tweet ${tweet.tweet_id}: ${updateError.message}`,
            );
          } else {
            result.tweets_embedded += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          result.errors.push(`Failed to embed tweet ${tweet.tweet_id}: ${message}`);
        }
      }
    }

    const cooldownCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: linksToFetch, error: linksError } = await supabase
      .from("links")
      .select("id, url, expanded_url")
      .is("title", null)
      .or(`fetch_error.is.null,and(fetch_error.not.is.null,fetched_at.lt.${cooldownCutoff})`)
      .limit(10);

    if (linksError) {
      result.errors.push(`Failed to fetch links: ${linksError.message}`);
    } else {
      for (const link of linksToFetch ?? []) {
        const metadata = await fetchLinkMetadata(link.expanded_url || link.url);
        const updates: Record<string, unknown> = {
          fetched_at: new Date().toISOString(),
          domain: metadata.domain ?? null,
        };

        if (metadata.fetch_error) {
          updates.fetch_error = metadata.fetch_error;
        } else {
          updates.title = metadata.title ?? null;
          updates.description = metadata.description ?? null;
          updates.fetch_error = null;
        }

        const { error: updateError } = await supabase
          .from("links")
          .update(updates)
          .eq("id", link.id);

        if (updateError) {
          result.errors.push(
            `Failed to update link ${link.id}: ${updateError.message}`,
          );
        } else if (!metadata.fetch_error) {
          result.links_metadata_fetched += 1;
        }
      }
    }

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
    } else {
      for (const link of linksToEmbed ?? []) {
        try {
          const text = [link.title, link.description, link.domain, link.url]
            .filter(Boolean)
            .join(" | ");

          const embedding = await withRetry(() => generateEmbedding(text, openaiKey));

          const { error: updateError } = await supabase
            .from("links")
            .update({ embedding })
            .eq("id", link.id);

          if (updateError) {
            result.errors.push(
              `Failed to update link embedding ${link.id}: ${updateError.message}`,
            );
          } else {
            result.links_embedded += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          result.errors.push(`Failed to embed link ${link.id}: ${message}`);
        }
      }
    }

    await supabase.from("sync_state").insert({
      last_sync_at: new Date().toISOString(),
      tweets_added: 0,
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
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
