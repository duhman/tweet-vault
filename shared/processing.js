export const EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_MAX_INPUT_CHARS = 8000;
export const DEFAULT_METADATA_RETRY_COOLDOWN_HOURS = 24;
export const SKIP_LINK_DOMAINS = new Set([
  "t.co",
  "pic.twitter.com",
  "twitter.com",
  "x.com",
  "pbs.twimg.com",
]);

export function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function shouldSkipLinkDomain(domain) {
  return Boolean(domain && SKIP_LINK_DOMAINS.has(domain));
}

export function normalizeMetaTagValue(value, maxLength = 2000) {
  if (!value) return undefined;
  const normalized = value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim()
    .replace(/\s+/g, " ");

  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function findMetaContent(html, matchers) {
  for (const matcher of matchers) {
    const match = html.match(matcher);
    const value = match?.[1];
    if (value) return value;
  }
  return undefined;
}

export function extractMetadataFromHtml(html) {
  const title = findMetaContent(html, [
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i,
    /<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:title["'][^>]*>/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);

  const description = findMetaContent(html, [
    /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["'][^>]*>/i,
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i,
    /<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:description["'][^>]*>/i,
  ]);

  const ogImage = findMetaContent(html, [
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i,
  ]);

  return {
    title: normalizeMetaTagValue(title, 500),
    description: normalizeMetaTagValue(description, 2000),
    og_image: normalizeMetaTagValue(ogImage, 2000),
  };
}

export function classifyMetadataFailure(error) {
  const message = error instanceof Error ? error.message : "unknown-error";
  if (message.toLowerCase().includes("abort")) {
    return { errorType: "timeout", errorMessage: "timeout" };
  }

  return {
    errorType: "network",
    errorMessage: message.slice(0, 180),
  };
}

export async function fetchLinkMetadataWithStrategy(fetchFn, url, options = {}) {
  const domain = extractDomain(url) ?? undefined;
  if (!domain) {
    return {
      ok: false,
      errorType: "invalid_url",
      errorMessage: "invalid-url",
    };
  }

  if (shouldSkipLinkDomain(domain)) {
    return { ok: true, domain };
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  const userAgent =
    options.userAgent ??
    "Mozilla/5.0 (compatible; TweetVault/1.0; +https://github.com/duhman/tweet-vault)";
  const acceptHeader =
    options.acceptHeader ??
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      method: "GET",
      headers: {
        "User-Agent": userAgent,
        Accept: acceptHeader,
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
    return {
      ok: true,
      domain,
      ...extractMetadataFromHtml(html),
    };
  } catch (error) {
    const classified = classifyMetadataFailure(error);
    return {
      ok: false,
      domain,
      ...classified,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function clampEmbeddingInput(text, maxInputChars = DEFAULT_MAX_INPUT_CHARS) {
  if (text.length <= maxInputChars) return text;
  return text.slice(0, maxInputChars);
}

export function createTweetEmbeddingText(tweet) {
  const parts = [tweet.content];
  if (tweet.author_name) {
    parts.push(`Author: ${tweet.author_name} (@${tweet.author_username})`);
  } else {
    parts.push(`Author: @${tweet.author_username}`);
  }
  return parts.join("\n");
}

export function createLinkEmbeddingText(link) {
  const parts = [];
  if (link.title) parts.push(link.title);
  if (link.description) parts.push(link.description);
  if (link.domain) parts.push(`Domain: ${link.domain}`);
  return parts.join("\n") || link.url;
}

export function isLinkReadyForEmbedding(link) {
  return Boolean(link && !link.embedding && link.title);
}

export function shouldRetryMetadataFetch(link, retryCooldownHours = DEFAULT_METADATA_RETRY_COOLDOWN_HOURS, now = new Date()) {
  if (!link || link.title) return false;
  if (!link.fetch_error) return true;
  if (!link.fetched_at) return true;

  const fetchedAt = new Date(link.fetched_at);
  if (Number.isNaN(fetchedAt.getTime())) return true;

  const cutoffMs = now.getTime() - retryCooldownHours * 60 * 60 * 1000;
  return fetchedAt.getTime() < cutoffMs;
}

export function selectLinksForMetadataProcessing(links, limit, retryCooldownHours = DEFAULT_METADATA_RETRY_COOLDOWN_HOURS, now = new Date()) {
  const selected = [];
  const seen = new Set();

  for (const link of links) {
    if (selected.length >= limit) break;
    if (!link?.id || seen.has(link.id)) continue;
    if (!shouldRetryMetadataFetch(link, retryCooldownHours, now)) continue;
    seen.add(link.id);
    selected.push(link);
  }

  return selected;
}
