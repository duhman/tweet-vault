import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_SCHEMA = Deno.env.get("SUPABASE_SCHEMA") || "tweet_vault";

interface Like {
  id: string;
  full_text: string;
  author_id: string;
  author_name?: string;
  author_username?: string;
  author_profile_image?: string;
  created_at: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
  };
  [key: string]: unknown;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { likes } = await req.json();

    if (!Array.isArray(likes)) {
      return new Response(JSON.stringify({ error: "likes must be an array" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (likes.length === 0) {
      return new Response(
        JSON.stringify({ message: "No likes to sync", synced: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      db: { schema: SUPABASE_SCHEMA },
    });

    const now = new Date().toISOString();

    const tweets = likes.map((like: Like) => ({
      tweet_id: like.id,
      content: like.full_text,
      author_username: like.author_username || like.author_name || "unknown",
      author_name: like.author_name || null,
      author_profile_image: like.author_profile_image || null,
      created_at: like.created_at || null,
      metrics: {
        likes: like.public_metrics?.like_count ?? 0,
        replies: like.public_metrics?.reply_count ?? 0,
        retweets: like.public_metrics?.retweet_count ?? 0,
      },
      raw_data: like,
      fetched_at: now,
    }));

    const { error: tweetError } = await supabase
      .from("tweets")
      .upsert(tweets, { onConflict: "tweet_id" });

    if (tweetError) {
      return new Response(
        JSON.stringify({ error: `Failed to upsert canonical tweets: ${tweetError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const interactions = likes.map((like: Like) => ({
      tweet_id: like.id,
      interaction_type: "like",
      interaction_at: like.created_at || null,
      source: "sync-likes-function",
      metadata: {
        public_metrics: like.public_metrics || {},
        raw: like,
      },
      synced_at: now,
    }));

    const { error: interactionError } = await supabase
      .from("tweet_interactions")
      .upsert(interactions, { onConflict: "tweet_id,interaction_type" });

    if (interactionError) {
      return new Response(
        JSON.stringify({ error: `Failed to upsert interactions: ${interactionError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    await supabase.from("sync_state").insert({
      last_sync_at: now,
      tweets_added: 0,
      links_processed: 0,
      embeddings_generated: 0,
      sync_type: "likes-function",
      metadata: {
        source: "sync-likes",
        records_synced: likes.length,
      },
    });

    return new Response(
      JSON.stringify({
        message: "Likes synced into canonical model",
        synced: likes.length,
        timestamp: now,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
