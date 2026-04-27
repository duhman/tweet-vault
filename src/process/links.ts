import {
  Tweet,
  upsertLinks,
  getLinksWithoutMetadata,
  updateLinkMetadata,
} from "../utils/supabase.js";
import { extractUrlsFromTweet } from "./tweets.js";
import {
  extractDomain,
  fetchLinkMetadataWithStrategy,
  shouldSkipLinkDomain,
} from "../../shared/processing.js";

export async function extractLinksFromTweets(
  tweets: Tweet[],
): Promise<{ inserted: number; skipped: number }> {
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
      if (shouldSkipLinkDomain(domain)) {
        skipped += 1;
        continue;
      }

      const key = `${tweet.tweet_id}::${urlData.url}`;
      if (seen.has(key)) {
        skipped += 1;
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

  const result = await upsertLinks(linkBatch);
  return { inserted: result.inserted, skipped };
}

export async function fetchAllLinkMetadata(
  concurrency = 5,
  batchSize = 50,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  const links = await getLinksWithoutMetadata(batchSize, 24);
  if (links.length === 0) {
    return { processed: 0, failed: 0 };
  }

  const safeConcurrency = Math.max(1, concurrency);

  for (let i = 0; i < links.length; i += safeConcurrency) {
    const batch = links.slice(i, i + safeConcurrency);

    const results = await Promise.allSettled(
      batch.map(async (link) => {
        const url = link.expanded_url || link.url;
        const metadata = (await fetchLinkMetadataWithStrategy(fetch, url)) as {
          ok: boolean;
          title?: string;
          description?: string;
          og_image?: string;
          domain?: string;
          errorType?: string;
          errorMessage?: string;
        };

        if (metadata.ok) {
          await updateLinkMetadata(link.id!, {
            title: metadata.title,
            description: metadata.description,
            og_image: metadata.og_image,
            domain: metadata.domain,
            fetch_error: null,
          });
          return true;
        }

        await updateLinkMetadata(link.id!, {
          domain: metadata.domain,
          fetch_error: `${metadata.errorType ?? "unknown"}:${metadata.errorMessage ?? "metadata-fetch-failed"}`,
        });
        return false;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        processed += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { processed, failed };
}
