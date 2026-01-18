import { Tweet, upsertLinks, runProcessing } from "../utils/convex.js";
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
 * Fetch metadata for all links that haven't been fetched yet
 */
export async function fetchAllLinkMetadata(
  _concurrency = 5,
  batchSize = 50,
  maxRounds = 50,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (let round = 0; round < maxRounds; round++) {
    const result = await runProcessing({
      tweetLimit: 0,
      likeLimit: 0,
      linkMetaLimit: batchSize,
      linkEmbedLimit: 0,
    });
    processed += result.links_metadata_fetched;
    failed += result.errors.length;
    if (result.links_metadata_fetched === 0) break;
  }

  return { processed, failed };
}
