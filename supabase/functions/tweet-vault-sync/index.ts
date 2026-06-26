/**
 * Tweet Vault Sync Edge Function
 *
 * Syncs Twitter bookmarks to Supabase.
 * Triggered by pg_cron daily at 6 AM UTC.
 *
 * Required env vars:
 * - TWITTER_AUTH_TOKEN: Twitter auth_token cookie
 * - TWITTER_CT0: Twitter ct0 cookie (CSRF token)
 * - GOOGLE_API_KEY/GEMINI_API_KEY or OPENAI_API_KEY: embedding provider key
 * - SUPABASE_URL: Auto-provided
 * - SUPABASE_SERVICE_ROLE_KEY: Auto-provided
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL as OPENAI_EMBEDDING_MODEL,
  EMBEDDING_PROVIDER_GEMINI,
  EMBEDDING_PROVIDER_OPENAI,
  GEMINI_EMBEDDING_MODEL,
  clampEmbeddingInput,
  createTweetEmbeddingText,
  getEmbeddingProviderMetadata,
} from "../../../shared/processing.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TweetData {
  rest_id: string;
  core?: {
    user_results?: {
      result?: {
        legacy?: {
          screen_name?: string;
          name?: string;
          profile_image_url_https?: string;
        };
      };
    };
  };
  legacy?: {
    full_text?: string;
    created_at?: string;
    entities?: {
      urls?: Array<{
        url: string;
        expanded_url?: string;
        display_url?: string;
      }>;
    };
    favorite_count?: number;
    retweet_count?: number;
    reply_count?: number;
  };
}

interface SyncResult {
  tweets_fetched: number;
  tweets_added: number;
  links_extracted: number;
  embeddings_generated: number;
  embedding_provider: string;
  errors: string[];
}

// Twitter GraphQL API constants
const TWITTER_GRAPHQL_URL = "https://x.com/i/api/graphql";
const BOOKMARKS_QUERY_ID = "RV1g3b8n_SGOHwkqKYSCFw";

// Fetch bookmarks from Twitter GraphQL API
async function fetchBookmarks(
  authToken: string,
  ct0: string,
  count: number = 100,
): Promise<TweetData[]> {
  const variables = {
    count,
    includePromotedContent: false,
    withDownvotePerspective: false,
    withReactionsMetadata: false,
    withReactionsPerspective: false,
  };

  // Full bookmarks features from Bird library
  const features = {
    rweb_video_screen_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: false,
    responsive_web_grok_annotations_enabled: false,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    responsive_web_grok_show_grok_translated_post: false,
    responsive_web_grok_analysis_button_from_backend: true,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: false,
    articles_preview_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    blue_business_profile_image_shape_enabled: true,
    responsive_web_text_conversations_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    vibe_api_enabled: true,
    responsive_web_twitter_blue_verified_badge_is_enabled: true,
    interactive_text_enabled: true,
    longform_notetweets_richtext_consumption_enabled: true,
    responsive_web_media_download_video_enabled: false,
    graphql_timeline_v2_bookmark_timeline: true,
  };

  const url = new URL(`${TWITTER_GRAPHQL_URL}/${BOOKMARKS_QUERY_ID}/Bookmarks`);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("features", JSON.stringify(features));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization:
        "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
      Cookie: `auth_token=${authToken}; ct0=${ct0}`,
      "x-csrf-token": ct0,
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twitter API error: ${response.status} - ${text}`);
  }

  const data = await response.json();

  // Extract tweets from the response
  const tweets: TweetData[] = [];
  const entries =
    data?.data?.bookmark_timeline_v2?.timeline?.instructions?.[0]?.entries ??
    [];

  for (const entry of entries) {
    const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
    if (tweetResult?.rest_id) {
      tweets.push(tweetResult);
    }
  }

  return tweets;
}

// Parse tweet data into database format
function parseTweet(tweet: TweetData): {
  tweet_id: string;
  author_username: string;
  author_name?: string;
  author_profile_image?: string;
  content: string;
  created_at?: string;
  metrics?: Record<string, number>;
  raw_data: unknown;
} | null {
  try {
    const user = tweet.core?.user_results?.result?.legacy;
    const legacy = tweet.legacy;

    if (!user?.screen_name || !legacy?.full_text) {
      return null;
    }

    return {
      tweet_id: tweet.rest_id,
      author_username: user.screen_name,
      author_name: user.name,
      author_profile_image: user.profile_image_url_https,
      content: legacy.full_text,
      created_at: legacy.created_at
        ? new Date(legacy.created_at).toISOString()
        : undefined,
      metrics: {
        likes: legacy.favorite_count ?? 0,
        retweets: legacy.retweet_count ?? 0,
        replies: legacy.reply_count ?? 0,
      },
      raw_data: tweet,
    };
  } catch {
    return null;
  }
}

// Extract URLs from tweet
function extractUrls(
  tweet: TweetData,
): Array<{ url: string; expanded_url?: string; display_url?: string }> {
  return tweet.legacy?.entities?.urls ?? [];
}

// Generate embedding using Gemini fallback or OpenAI
async function generateEmbedding(
  text: string,
  openaiKey: string | null,
  geminiKey: string | null,
): Promise<number[]> {
  const input = clampEmbeddingInput(text);
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
      throw new Error(`Gemini embedding API error: ${response.status} ${error.slice(0, 300)}`);
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
      model: OPENAI_EMBEDDING_MODEL,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Extract domain from URL
function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Domains to skip
const SKIP_DOMAINS = new Set([
  "t.co",
  "pic.twitter.com",
  "twitter.com",
  "x.com",
  "pbs.twimg.com",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authToken = Deno.env.get("TWITTER_AUTH_TOKEN");
    const ct0 = Deno.env.get("TWITTER_CT0");
    const openaiKey = Deno.env.get("OPENAI_API_KEY") || null;
    const geminiKey = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_API_KEY") || null;
    const embeddingProvider = geminiKey
      ? EMBEDDING_PROVIDER_GEMINI
      : EMBEDDING_PROVIDER_OPENAI;
    const embeddingMetadata = getEmbeddingProviderMetadata(embeddingProvider);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!authToken || !ct0 || (!openaiKey && !geminiKey) || !supabaseUrl || !supabaseKey) {
      throw new Error("Missing required environment variables");
    }

    // Parse options
    let options = {
      count: 100,
      embeddingLimit: 20,
      syncType: "cron",
    };

    if (req.method === "POST") {
      try {
        const body = await req.json();
        options = { ...options, ...body };
      } catch {
        // Use defaults
      }
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      db: { schema: "tweet_vault" },
    });

    const result: SyncResult = {
      tweets_fetched: 0,
      tweets_added: 0,
      links_extracted: 0,
      embeddings_generated: 0,
      embedding_provider: embeddingProvider,
      errors: [],
    };

    // Step 1: Fetch bookmarks
    console.log(`Fetching ${options.count} bookmarks from Twitter...`);
    const rawTweets = await fetchBookmarks(authToken, ct0, options.count);
    result.tweets_fetched = rawTweets.length;

    // Step 2: Parse and upsert tweets
    const addedTweetIds: string[] = [];

    for (const rawTweet of rawTweets) {
      const tweet = parseTweet(rawTweet);
      if (!tweet) continue;

      // Check if exists
      const { data: existing } = await supabase
        .from("tweets")
        .select("tweet_id")
        .eq("tweet_id", tweet.tweet_id)
        .single();

      if (!existing) {
        const { error } = await supabase.from("tweets").insert({
          ...tweet,
          fetched_at: new Date().toISOString(),
        });
        if (!error) {
          result.tweets_added++;
          addedTweetIds.push(tweet.tweet_id);
        }
      }

      // Extract and upsert links for new tweets
      if (!existing) {
        const urls = extractUrls(rawTweet);
        for (const urlData of urls) {
          const domain = extractDomain(urlData.expanded_url ?? urlData.url);
          if (domain && SKIP_DOMAINS.has(domain)) continue;

          const { error } = await supabase.from("links").insert({
            tweet_id: tweet.tweet_id,
            url: urlData.url,
            expanded_url: urlData.expanded_url,
            display_url: urlData.display_url,
            domain,
          });
          if (!error) result.links_extracted++;
        }
      }
    }

    // Step 3: Generate embeddings for tweets without them
    if (options.embeddingLimit > 0) {
      console.log(
        `Generating embeddings for up to ${options.embeddingLimit} tweets...`,
      );
      const { data: tweetsNeedingEmbeddings } = await supabase
        .from("tweets")
        .select("tweet_id, content, author_username, author_name")
        .is("embedding", null)
        .limit(options.embeddingLimit);

      for (const tweet of tweetsNeedingEmbeddings ?? []) {
        try {
          const text = createTweetEmbeddingText(tweet);
          const embedding = await generateEmbedding(text, openaiKey, geminiKey);

          await supabase
            .from("tweets")
            .update({
              embedding,
              processed_at: new Date().toISOString(),
            })
            .eq("tweet_id", tweet.tweet_id);
          result.embeddings_generated++;
        } catch (error) {
          result.errors.push(`Embedding ${tweet.tweet_id}: ${error}`);
        }
      }
    }

    // Record sync state
    await supabase.from("sync_state").insert({
      last_sync_at: new Date().toISOString(),
      tweets_added: result.tweets_added,
      links_processed: result.links_extracted,
      embeddings_generated: result.embeddings_generated,
      sync_type: options.syncType,
      metadata: {
        function_name: "tweet-vault-sync",
        schema: "tweet_vault",
        embedding: embeddingMetadata,
        provider: embeddingProvider,
        fetched_count: result.tweets_fetched,
        tweets_added: result.tweets_added,
        tweets_embedded: result.embeddings_generated,
        links_metadata_fetched: 0,
        links_embedded: 0,
        links_processed: result.links_extracted,
        embeddings_generated: result.embeddings_generated,
        errors_count: result.errors.length,
        errors: result.errors.slice(0, 20),
      },
    });

    console.log("Sync complete:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
