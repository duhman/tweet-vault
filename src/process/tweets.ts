import { z } from "zod";
import { Tweet, upsertTweets } from "../utils/supabase.js";

// Schema for Twitter GraphQL bookmark response (simplified)
const TweetDataSchema = z.object({
  rest_id: z.string(),
  core: z.object({
    user_results: z.object({
      result: z.object({
        legacy: z.object({
          screen_name: z.string(),
          name: z.string().optional(),
          profile_image_url_https: z.string().optional(),
        }),
      }),
    }),
  }),
  legacy: z.object({
    full_text: z.string(),
    created_at: z.string().optional(),
    entities: z
      .object({
        urls: z
          .array(
            z.object({
              url: z.string(),
              expanded_url: z.string().optional(),
              display_url: z.string().optional(),
            }),
          )
          .optional(),
        media: z
          .array(
            z.object({
              media_url_https: z.string(),
              type: z.string(),
            }),
          )
          .optional(),
      })
      .optional(),
    favorite_count: z.number().optional(),
    retweet_count: z.number().optional(),
    reply_count: z.number().optional(),
    quote_count: z.number().optional(),
    bookmark_count: z.number().optional(),
  }),
});

// Schema for exported bookmark JSON (from browser extension or manual export)
const ExportedTweetSchema = z.object({
  id: z.string(),
  author: z.object({
    username: z.string(),
    name: z.string().optional(),
    profile_image: z.string().optional(),
  }),
  text: z.string(),
  created_at: z.string().optional(),
  urls: z
    .array(
      z.object({
        url: z.string(),
        expanded_url: z.string().optional(),
        display_url: z.string().optional(),
      }),
    )
    .optional(),
  media: z.array(z.string()).optional(),
  metrics: z
    .object({
      likes: z.number().optional(),
      retweets: z.number().optional(),
      replies: z.number().optional(),
      quotes: z.number().optional(),
      bookmarks: z.number().optional(),
    })
    .optional(),
  raw: z.record(z.unknown()).optional(),
});

export type ExportedTweet = z.infer<typeof ExportedTweetSchema>;

/**
 * Parse Twitter GraphQL response format (from Playwright interception)
 */
export function parseGraphQLTweet(data: unknown): Tweet | null {
  try {
    const parsed = TweetDataSchema.parse(data);
    const user = parsed.core.user_results.result.legacy;
    const legacy = parsed.legacy;

    return {
      tweet_id: parsed.rest_id,
      author_username: user.screen_name,
      author_name: user.name,
      author_profile_image: user.profile_image_url_https,
      content: legacy.full_text,
      created_at: legacy.created_at
        ? new Date(legacy.created_at).toISOString()
        : undefined,
      media_urls: legacy.entities?.media?.map((m) => m.media_url_https) ?? [],
      metrics: {
        likes: legacy.favorite_count ?? 0,
        retweets: legacy.retweet_count ?? 0,
        replies: legacy.reply_count ?? 0,
        quotes: legacy.quote_count ?? 0,
        bookmarks: legacy.bookmark_count ?? 0,
      },
      raw_data: data as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/**
 * Parse exported tweet format (from browser extension or manual export)
 */
export function parseExportedTweet(data: unknown): Tweet | null {
  try {
    const parsed = ExportedTweetSchema.parse(data);

    return {
      tweet_id: parsed.id,
      author_username: parsed.author.username,
      author_name: parsed.author.name,
      author_profile_image: parsed.author.profile_image,
      content: parsed.text,
      created_at: parsed.created_at
        ? new Date(parsed.created_at).toISOString()
        : undefined,
      media_urls: parsed.media ?? [],
      metrics: parsed.metrics ?? {},
      raw_data: parsed.raw,
    };
  } catch {
    return null;
  }
}

/**
 * Extract URLs from tweet content and entities
 */
export function extractUrlsFromTweet(
  tweet: Tweet,
): Array<{ url: string; expanded_url?: string; display_url?: string }> {
  const urls: Array<{
    url: string;
    expanded_url?: string;
    display_url?: string;
  }> = [];

  // Extract from raw_data entities if available
  const entities = (tweet.raw_data as Record<string, unknown>)?.legacy as
    | Record<string, unknown>
    | undefined;
  const urlEntities = (entities?.entities as Record<string, unknown>)?.urls as
    | Array<Record<string, string>>
    | undefined;

  if (urlEntities) {
    for (const urlEntity of urlEntities) {
      urls.push({
        url: urlEntity.url,
        expanded_url: urlEntity.expanded_url,
        display_url: urlEntity.display_url,
      });
    }
  }

  // Also extract any URLs from content via regex
  const contentNormalized = normalizeUrlText(tweet.content);
  const urlRegex = /https?:\/\/[^\s]+/g;
  const contentUrls = contentNormalized.match(urlRegex) ?? [];
  for (const url of contentUrls) {
    const cleaned = trimUrl(url);
    if (!cleaned) continue;
    // Only add if not already in entities
    if (!urls.some((u) => u.url === cleaned || u.expanded_url === cleaned)) {
      urls.push({ url: cleaned });
    }
  }

  return urls;
}

function isUrlChar(char: string): boolean {
  return /[A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]/.test(char);
}

function normalizeUrlText(text: string): string {
  const chars = [...text];
  let output = "";
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (char === "\n" || char === "\r") {
      const prev = chars[i - 1] ?? "";
      const next = chars[i + 1] ?? "";
      if (isUrlChar(prev) && isUrlChar(next)) {
        continue;
      }
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

function trimUrl(url: string): string {
  return url.replace(/[)\].,;!?…]+$/g, "");
}

/**
 * Process a batch of exported tweets
 * Deduplicates against existing tweets in database
 */
export async function processTweets(
  tweets: unknown[],
): Promise<{ added: Tweet[]; skipped: number }> {
  const parsedTweets: Tweet[] = [];
  let skipped = 0;

  for (const tweetData of tweets) {
    // Try both parsing formats
    let tweet = parseExportedTweet(tweetData);
    if (!tweet) {
      tweet = parseGraphQLTweet(tweetData);
    }

    if (!tweet) {
      console.warn("Failed to parse tweet:", tweetData);
      skipped++;
      continue;
    }

    parsedTweets.push(tweet);
  }

  if (parsedTweets.length === 0) {
    return { added: [], skipped };
  }

  // Upsert to database
  const { added: addedIds } = await upsertTweets(parsedTweets);
  const addedSet = new Set(addedIds);
  const added = parsedTweets.filter((tweet) => addedSet.has(tweet.tweet_id));
  skipped += parsedTweets.length - added.length;
  return { added, skipped };
}
