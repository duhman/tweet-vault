import * as cheerio from "cheerio";
import pLimit from "p-limit";
import {
  Tweet,
  insertLinks,
  getLinksWithoutMetadata,
  updateLinkMetadata,
  getSupabaseClient,
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

// User agent for fetching
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
 * Expand t.co shortened URLs
 */
async function expandUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    return response.url;
  } catch {
    return url;
  }
}

/**
 * Fetch metadata (title, description, og:image) from a URL
 */
export async function fetchLinkMetadata(url: string): Promise<{
  title?: string;
  description?: string;
  og_image?: string;
  domain?: string;
  content_type?: string;
}> {
  try {
    // Expand shortened URLs first
    let expandedUrl = url;
    if (url.includes("t.co/")) {
      expandedUrl = await expandUrl(url);
    }

    const domain = extractDomain(expandedUrl);

    // Skip certain domains
    if (domain && SKIP_DOMAINS.has(domain)) {
      return { domain };
    }

    const response = await fetch(expandedUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });

    const contentType = response.headers.get("content-type") || "";

    // Only parse HTML content
    if (!contentType.includes("text/html")) {
      return {
        domain: domain ?? undefined,
        content_type: contentType.split(";")[0],
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract metadata
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      $("title").text() ||
      undefined;

    const description =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="twitter:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      undefined;

    const og_image =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      undefined;

    return {
      title: title?.trim().slice(0, 500),
      description: description?.trim().slice(0, 2000),
      og_image,
      domain: domain ?? undefined,
      content_type: "text/html",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.warn(`Failed to fetch metadata for ${url}: ${errorMessage}`);
    return { domain: extractDomain(url) ?? undefined };
  }
}

/**
 * Extract and insert links from tweets
 */
export async function extractLinksFromTweets(
  tweets: Tweet[],
): Promise<{ inserted: number; skipped: number }> {
  const client = getSupabaseClient();
  let inserted = 0;
  let skipped = 0;

  for (const tweet of tweets) {
    if (!tweet.id) continue;

    const urls = extractUrlsFromTweet(tweet);

    for (const urlData of urls) {
      // Skip if already exists
      const { data: existing } = await client
        .from("links")
        .select("id")
        .eq("tweet_id", tweet.id)
        .eq("url", urlData.url)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const domain = extractDomain(urlData.expanded_url || urlData.url);

      // Skip certain domains
      if (domain && SKIP_DOMAINS.has(domain)) {
        skipped++;
        continue;
      }

      await insertLinks([
        {
          tweet_id: tweet.id,
          url: urlData.url,
          expanded_url: urlData.expanded_url,
          display_url: urlData.display_url,
          domain: domain ?? undefined,
        },
      ]);
      inserted++;
    }
  }

  return { inserted, skipped };
}

/**
 * Fetch metadata for all links that haven't been fetched yet
 */
export async function fetchAllLinkMetadata(
  concurrency = 5,
  batchSize = 100,
): Promise<{ processed: number; failed: number }> {
  const limit = pLimit(concurrency);
  let processed = 0;
  let failed = 0;

  // Process in batches
  let links = await getLinksWithoutMetadata(batchSize);

  while (links.length > 0) {
    const tasks = links.map((link) =>
      limit(async () => {
        const url = link.expanded_url || link.url;
        const metadata = await fetchLinkMetadata(url);

        try {
          await updateLinkMetadata(link.id!, {
            title: metadata.title,
            description: metadata.description,
            og_image: metadata.og_image,
            domain: metadata.domain,
            content_type: metadata.content_type,
          });
          processed++;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          await updateLinkMetadata(link.id!, {
            fetch_error: errorMessage,
          });
          failed++;
        }
      }),
    );

    await Promise.all(tasks);
    console.log(`Processed ${processed} links, ${failed} failed`);

    // Get next batch
    links = await getLinksWithoutMetadata(batchSize);
  }

  return { processed, failed };
}
