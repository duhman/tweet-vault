import {
  Tweet,
  upsertLinks,
  getLinksWithoutMetadata,
  updateLinkMetadata,
} from "../utils/supabase.js";
import { extractUrlsFromTweet } from "./tweets.js";

const SKIP_DOMAINS = new Set([
  "t.co",
  "pic.twitter.com",
  "twitter.com",
  "x.com",
  "pbs.twimg.com",
]);

type MetadataErrorType =
  | "timeout"
  | "network"
  | "http"
  | "non_html"
  | "invalid_url"
  | "unknown";

interface MetadataResult {
  ok: boolean;
  title?: string;
  description?: string;
  og_image?: string;
  domain?: string;
  errorType?: MetadataErrorType;
  errorMessage?: string;
}

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

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
      if (domain && SKIP_DOMAINS.has(domain)) {
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

function normalizeMetaTagValue(value?: string): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/\s+/g, " ").slice(0, 2000) || undefined;
}

async function fetchLinkMetadata(url: string): Promise<MetadataResult> {
  const domain = extractDomain(url) ?? undefined;
  if (!domain) {
    return {
      ok: false,
      errorType: "invalid_url",
      errorMessage: "invalid-url",
    };
  }

  if (SKIP_DOMAINS.has(domain)) {
    return { ok: true, domain };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        domain,
        errorType: "http",
        errorMessage: `http-${response.status}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return {
        ok: false,
        domain,
        errorType: "non_html",
        errorMessage: "content-not-html",
      };
    }

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const ogTitleMatch = html.match(
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
    );
    const ogDescMatch = html.match(
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
    );
    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
    );
    const ogImageMatch = html.match(
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    );

    return {
      ok: true,
      domain,
      title: normalizeMetaTagValue(ogTitleMatch?.[1] || titleMatch?.[1]),
      description: normalizeMetaTagValue(ogDescMatch?.[1] || descMatch?.[1]),
      og_image: normalizeMetaTagValue(ogImageMatch?.[1]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    if (message.toLowerCase().includes("abort")) {
      return {
        ok: false,
        domain,
        errorType: "timeout",
        errorMessage: "timeout",
      };
    }

    return {
      ok: false,
      domain,
      errorType: "network",
      errorMessage: message.slice(0, 180),
    };
  } finally {
    clearTimeout(timeout);
  }
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
        const metadata = await fetchLinkMetadata(url);

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
