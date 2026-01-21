import {
  Tweet,
  upsertLinks,
  getLinksWithoutMetadata,
  updateLinkMetadata,
} from "../utils/supabase.js";
import { extractUrlsFromTweet } from "./tweets.js";

// Domains to skip (tracking pixels, known non-content)
const SKIP_DOMAINS = new Set([
  "t.co", // We expand these
  "pic.twitter.com",
  "twitter.com",
  "x.com",
  "pbs.twimg.com",
]);

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Extract and insert links from tweets
 */
export async function extractLinksFromTweets(
  tweets: Tweet[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const linkBatch: Array<{
    tweet_id: string;
    url: string;
    expanded_url?: string;
    display_url?: string;
    domain?: string;
  }> = [];
  const seen = new Set<string>();

  for (const tweet of tweets) {
    const urls = extractUrlsFromTweet(tweet);

    for (const urlData of urls) {
      const domain = extractDomain(urlData.expanded_url || urlData.url);

      // Skip certain domains
      if (domain && SKIP_DOMAINS.has(domain)) {
        skipped++;
        continue;
      }

      const key = `${tweet.tweet_id}::${urlData.url}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);

      linkBatch.push({
        tweet_id: tweet.tweet_id,
        url: urlData.url,
        expanded_url: urlData.expanded_url,
        display_url: urlData.display_url,
        domain: domain ?? undefined,
      });
    }
  }

  const chunkSize = 100;
  for (let i = 0; i < linkBatch.length; i += chunkSize) {
    const chunk = linkBatch.slice(i, i + chunkSize);
    const result = await upsertLinks(chunk);
    inserted += result.inserted;
  }

  return { inserted, skipped };
}

/**
 * Fetch metadata for a single URL
 */
async function fetchLinkMetadata(
  url: string,
): Promise<{ title?: string; description?: string; og_image?: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const ogTitleMatch = html.match(
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
    );
    const title = ogTitleMatch?.[1] || titleMatch?.[1];

    // Extract description
    const ogDescMatch = html.match(
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
    );
    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
    );
    const description = ogDescMatch?.[1] || descMatch?.[1];

    // Extract og:image
    const ogImageMatch = html.match(
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    );
    const og_image = ogImageMatch?.[1];

    return { title, description, og_image };
  } catch {
    return null;
  }
}

/**
 * Fetch metadata for all links that haven't been fetched yet
 */
export async function fetchAllLinkMetadata(
  concurrency = 5,
  batchSize = 50,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  // Get links without metadata
  const links = await getLinksWithoutMetadata(batchSize);

  if (links.length === 0) {
    return { processed: 0, failed: 0 };
  }

  // Process in batches with concurrency
  for (let i = 0; i < links.length; i += concurrency) {
    const batch = links.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (link) => {
        const url = link.expanded_url || link.url;
        const metadata = await fetchLinkMetadata(url);

        if (metadata) {
          await updateLinkMetadata(link.id!, {
            title: metadata.title,
            description: metadata.description,
            og_image: metadata.og_image,
          });
          return true;
        } else {
          await updateLinkMetadata(link.id!, {
            fetch_error: "Failed to fetch metadata",
          });
          return false;
        }
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        processed++;
      } else {
        failed++;
      }
    }
  }

  return { processed, failed };
}
