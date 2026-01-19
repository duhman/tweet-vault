import { mutation } from "./_generated/server";
import { v } from "convex/values";

const LINK_SKIP_DOMAINS = new Set([
  "t.co",
  "pic.twitter.com",
  "twitter.com",
  "x.com",
  "pbs.twimg.com",
]);

function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function extractUrlsFromTweetDoc(tweet: any): Array<{
  url: string;
  expanded_url?: string;
  display_url?: string;
}> {
  const urls: Array<{ url: string; expanded_url?: string; display_url?: string }> = [];

  const legacy = tweet?.raw_data?.legacy;
  const urlEntities = legacy?.entities?.urls;
  if (Array.isArray(urlEntities)) {
    for (const entity of urlEntities) {
      if (!entity?.url) continue;
      urls.push({
        url: String(entity.url),
        expanded_url: entity.expanded_url ? String(entity.expanded_url) : undefined,
        display_url: entity.display_url ? String(entity.display_url) : undefined,
      });
    }
  }

  const content = typeof tweet?.content === "string" ? tweet.content : "";
  const contentNormalized = normalizeUrlText(content);
  const contentUrls = contentNormalized.match(/https?:\/\/[^\s]+/g) ?? [];
  for (const url of contentUrls) {
    const cleaned = trimUrl(url);
    if (!cleaned) continue;
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
  return url.replace(/[)\].,;!?]+$/g, "");
}

export const backfillLinks = mutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const now = new Date().toISOString();
    const tweets = await ctx.db
      .query("tweets")
      .filter((q) => q.eq(q.field("links_extracted_at"), undefined))
      .take(limit);

    let inserted = 0;
    let skipped = 0;

    for (const tweet of tweets) {
      const urls = extractUrlsFromTweetDoc(tweet);
      const seen = new Set<string>();

      for (const urlData of urls) {
        const key = `${tweet.tweet_id}::${urlData.url}`;
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }
        seen.add(key);

        const domain = extractDomain(urlData.expanded_url || urlData.url);
        if (domain && LINK_SKIP_DOMAINS.has(domain)) {
          skipped += 1;
          continue;
        }

        const existing = await ctx.db
          .query("links")
          .withIndex("by_tweet_url", (q) =>
            q.eq("tweet_id", tweet.tweet_id).eq("url", urlData.url),
          )
          .unique();

        if (existing) {
          skipped += 1;
          continue;
        }

        await ctx.db.insert("links", {
          id: `${tweet.tweet_id}:${urlData.url}`,
          tweet_id: tweet.tweet_id,
          url: urlData.url,
          expanded_url: urlData.expanded_url,
          display_url: urlData.display_url,
          domain,
        });
        inserted += 1;
      }

      await ctx.db.patch(tweet._id, { links_extracted_at: now });
    }

    return {
      processed: tweets.length,
      links_inserted: inserted,
      links_skipped: skipped,
    };
  },
});

export const resetLinksExtractedAt = mutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    const tweets = await ctx.db
      .query("tweets")
      .filter((q) => q.neq(q.field("links_extracted_at"), undefined))
      .take(limit);

    for (const tweet of tweets) {
      await ctx.db.patch(tweet._id, { links_extracted_at: undefined });
    }

    return { processed: tweets.length };
  },
});
