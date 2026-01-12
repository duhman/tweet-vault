import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface Like {
  id: string;
  full_text: string;
  author_id: string;
  author_name?: string;
  created_at: string;
  public_metrics?: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
  };
  [key: string]: unknown;
}

serve(async (req) => {
  // Handle CORS
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
    // Only allow POST
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse request
    const { likes } = await req.json();

    if (!Array.isArray(likes)) {
      return new Response(
        JSON.stringify({ error: "likes must be an array" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (likes.length === 0) {
      return new Response(
        JSON.stringify({ message: "No likes to sync", synced: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Prepare likes for insertion
    const likesToInsert = likes.map((like: Like) => ({
      tweet_id: like.id,
      content: like.full_text,
      author_id: like.author_id,
      author_name: like.author_name || "",
      liked_at: like.created_at,
      metadata: {
        public_metrics: like.public_metrics || {},
        raw: like,
      },
      source: "bird-cli",
      synced_at: new Date().toISOString(),
    }));

    // Upsert likes (update if exists, insert if not)
    const { data, error } = await supabase
      .from("twitter_likes")
      .upsert(likesToInsert, { onConflict: "tweet_id" });

    if (error) {
      console.error("Supabase error:", error);
      return new Response(
        JSON.stringify({ error: `Failed to sync likes: ${error.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Log sync
    await supabase.from("sync_state").insert({
      source: "twitter-likes",
      records_synced: likes.length,
      status: "completed",
      sync_timestamp: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        message: "Likes synced successfully",
        synced: likes.length,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
