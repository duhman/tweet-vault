// Edge Function: Process pending metadata + embeddings in tweet_vault schema.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROVIDER_GEMINI,
  EMBEDDING_PROVIDER_OPENAI,
  DEFAULT_MAX_INPUT_CHARS,
  DEFAULT_METADATA_RETRY_COOLDOWN_HOURS,
  GEMINI_EMBEDDING_MODEL,
  clampEmbeddingInput,
  createLinkEmbeddingText,
  createTweetEmbeddingText,
  fetchLinkMetadataWithStrategy,
  getEmbeddingProviderMetadata,
  isLinkReadyForEmbedding,
  selectLinksForMetadataProcessing,
} from "../../../shared/processing.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SCHEMA = Deno.env.get("SUPABASE_SCHEMA") || "tweet_vault";

interface ProcessResult {
  tweets_embedded: number;
  links_metadata_fetched: number;
  links_embedded: number;
  embedding_provider: string;
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
  openaiKey: string | null,
  geminiKey: string | null,
): Promise<number[]> {
  const input = clampEmbeddingInput(text, DEFAULT_MAX_INPUT_CHARS);
  if (geminiKey) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: input }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini embedding API error: ${error}`);
    }

    const data = await response.json();
    const embedding = data.embedding?.values ?? [];
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Unexpected embedding dim ${embedding.length}`);
    }
    return embedding;
  }

  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY or GOOGLE_API_KEY/GEMINI_API_KEY must be configured");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
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
    const openaiKey = Deno.env.get("OPENAI_API_KEY") || null;
    const geminiKey = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_API_KEY") || null;
    const embeddingProvider = geminiKey
      ? EMBEDDING_PROVIDER_GEMINI
      : EMBEDDING_PROVIDER_OPENAI;
    const embeddingMetadata = getEmbeddingProviderMetadata(embeddingProvider);

    if (!supabaseUrl || !supabaseKey || (!openaiKey && !geminiKey)) {
      return new Response(
        JSON.stringify({
          error:
            "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and either OPENAI_API_KEY or GOOGLE_API_KEY/GEMINI_API_KEY must all be configured",
        }),
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
      embedding_provider: embeddingProvider,
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
          const text = createTweetEmbeddingText(tweet);
          const embedding = await withRetry(() => generateEmbedding(text, openaiKey, geminiKey));

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

    const { data: linkCandidates, error: linksError } = await supabase
      .from("links")
      .select("id, url, expanded_url, title, fetch_error, fetched_at")
      .is("title", null)
      .order("id", { ascending: true })
      .limit(80);

    if (linksError) {
      result.errors.push(`Failed to fetch links: ${linksError.message}`);
    } else {
      const linksToFetch = selectLinksForMetadataProcessing(
        linkCandidates ?? [],
        10,
        DEFAULT_METADATA_RETRY_COOLDOWN_HOURS,
      );

      for (const link of linksToFetch) {
        const metadata = await fetchLinkMetadataWithStrategy(
          fetch,
          link.expanded_url || link.url,
        ) as {
          ok: boolean;
          title?: string;
          description?: string;
          og_image?: string;
          domain?: string;
          errorType?: string;
          errorMessage?: string;
        };
        const updates: Record<string, unknown> = {
          fetched_at: new Date().toISOString(),
          domain: metadata.domain ?? null,
        };

        if (!metadata.ok) {
          updates.fetch_error = `${metadata.errorType ?? "unknown"}:${metadata.errorMessage ?? "metadata-fetch-failed"}`;
        } else {
          updates.title = metadata.title ?? null;
          updates.description = metadata.description ?? null;
          updates.og_image = metadata.og_image ?? null;
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
        } else if (metadata.ok) {
          result.links_metadata_fetched += 1;
        }
      }
    }

    const { data: linkEmbeddingCandidates, error: embedLinksError } = await supabase
      .from("links")
      .select("id, url, title, description, domain, embedding")
      .limit(60);

    if (embedLinksError) {
      result.errors.push(
        `Failed to fetch links for embedding: ${embedLinksError.message}`,
      );
    } else {
      for (const link of (linkEmbeddingCandidates ?? []).filter(isLinkReadyForEmbedding).slice(0, 10)) {
        try {
          const text = createLinkEmbeddingText(link);
          const embedding = await withRetry(() => generateEmbedding(text, openaiKey, geminiKey));

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
        function_name: "process-tweets",
        schema: SCHEMA,
        embedding: embeddingMetadata,
        provider: embeddingProvider,
        fetched_count: 0,
        tweets_added: 0,
        tweets_embedded: result.tweets_embedded,
        links_metadata_fetched: result.links_metadata_fetched,
        links_embedded: result.links_embedded,
        links_processed: result.links_metadata_fetched,
        embeddings_generated: result.tweets_embedded + result.links_embedded,
        errors_count: result.errors.length,
        errors: result.errors.slice(0, 20),
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
