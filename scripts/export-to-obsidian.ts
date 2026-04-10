/**
 * Export Twitter/X bookmarks or likes directly into an Obsidian inbox.
 *
 * Purpose:
 * - Reuse Tweet Vault's strongest part (Bird + Safari auth)
 * - Avoid blocking on Supabase credentials when the immediate goal is brain ingestion
 * - Create deterministic, idempotent markdown notes in obsidian-memory/00-Inbox/feeds/twitter
 *
 * Usage:
 *   bun run scripts/export-to-obsidian.ts --bookmarks-only --count=20
 *   bun run scripts/export-to-obsidian.ts --likes-only --count=50
 *   bun run scripts/export-to-obsidian.ts --all --max-pages=10
 *   bun run scripts/export-to-obsidian.ts --output /path/to/00-Inbox/feeds/twitter
 */

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "dotenv";
import {
  TwitterClient,
  resolveCredentials,
  type SearchResult,
  type TweetData,
} from "@steipete/bird";

config();

type InteractionType = "bookmark" | "like";

interface CliOptions {
  fetchAll: boolean;
  count: number;
  maxPages?: number;
  cursor?: string;
  bookmarksOnly: boolean;
  likesOnly: boolean;
  output: string;
}

function parseOptions(args: string[]): CliOptions {
  const fetchAll = args.includes("--all");
  const bookmarksOnly = args.includes("--bookmarks-only");
  const likesOnly = args.includes("--likes-only");

  if (bookmarksOnly && likesOnly) {
    throw new Error("Use only one of --bookmarks-only or --likes-only.");
  }

  const countArg = args.find((arg) => arg.startsWith("--count="));
  const maxPagesArg = args.find((arg) => arg.startsWith("--max-pages="));
  const cursorArg = args.find((arg) => arg.startsWith("--cursor="));
  const outputArg = args.find((arg) => arg.startsWith("--output="));

  const count = countArg ? parseInt(countArg.split("=")[1], 10) : 50;
  const maxPages = maxPagesArg ? parseInt(maxPagesArg.split("=")[1], 10) : undefined;
  const cursor = cursorArg ? cursorArg.split("=")[1] : undefined;
  const output = outputArg
    ? outputArg.split("=")[1]
    : "/Users/minimac/projects/obsidian-memory/00-Inbox/feeds/twitter";

  return {
    fetchAll,
    count,
    maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
    cursor,
    bookmarksOnly,
    likesOnly,
    output,
  };
}

async function getClient(): Promise<TwitterClient> {
  const authToken = process.env.AUTH_TOKEN || process.env.TWITTER_AUTH_TOKEN;
  const ct0 = process.env.CT0 || process.env.TWITTER_CT0;

  if (authToken && ct0) {
    return new TwitterClient({
      cookies: { authToken, ct0 },
    });
  }

  console.log("  Extracting cookies from Safari...");
  const { cookies } = await resolveCredentials({ cookieSource: "safari" });
  return new TwitterClient({ cookies });
}

async function fetchTimeline(
  client: TwitterClient,
  kind: InteractionType,
  options: CliOptions,
): Promise<{ kind: InteractionType; tweets: TweetData[]; nextCursor?: string }> {
  const timelineClient = client as any;
  let result: SearchResult;

  if (kind === "bookmark") {
    result = options.fetchAll
      ? await timelineClient.getAllBookmarks({
          maxPages: options.maxPages,
          cursor: options.cursor,
        })
      : await timelineClient.getBookmarks(options.count);
  } else {
    result = options.fetchAll
      ? await timelineClient.getAllLikes({
          maxPages: options.maxPages,
          cursor: options.cursor,
        })
      : await timelineClient.getLikes(options.count);
  }

  if (!result.success) {
    throw new Error(result.error || `Failed to fetch ${kind} timeline`);
  }

  return {
    kind,
    tweets: result.tweets,
    nextCursor: result.nextCursor,
  };
}

function yamlEscape(value: string): string {
  return value.replace(/"/g, "'").replace(/\n/g, " ").trim();
}

function markdownEscape(value: string): string {
  return value.replace(/\r/g, "").trim();
}

function buildUrl(tweet: TweetData): string {
  return `https://x.com/${tweet.author.username}/status/${tweet.id}`;
}

function noteFilename(kind: InteractionType, tweet: TweetData): string {
  return `${kind}-${tweet.id}.md`;
}

function noteBody(kind: InteractionType, tweet: TweetData): string {
  const capturedAt = new Date().toISOString();
  const content = markdownEscape(tweet.text || "");
  const preview = content.length > 900 ? `${content.slice(0, 900)}…` : content;
  const url = buildUrl(tweet);
  const tags = kind === "bookmark" ? "[twitter, bookmark, resource]" : "[twitter, like, resource]";

  return `---
source: twitter-${kind}
captured_at: ${capturedAt}
interaction_type: ${kind}
author: ${tweet.author.username}
author_name: "${yamlEscape(tweet.author.name || tweet.author.username)}"
tweet_id: ${tweet.id}
url: ${url}
created_at: ${tweet.createdAt || ""}
relevance: medium
action: review
tags: ${tags}
status: inbox
---

# @${tweet.author.username} — ${kind}

${preview || "*No content captured*"}

## Link
${url}

## Metrics
- Likes: ${tweet.likeCount ?? 0}
- Retweets: ${tweet.retweetCount ?? 0}
- Replies: ${tweet.replyCount ?? 0}

## Next action
- [ ] Decide: apply now / park for later / archive
`;
}

function writeNotes(outputDir: string, kind: InteractionType, tweets: TweetData[]): number {
  mkdirSync(outputDir, { recursive: true });
  let written = 0;
  for (const tweet of tweets) {
    const filename = noteFilename(kind, tweet);
    const path = join(outputDir, filename);
    const body = noteBody(kind, tweet);
    const existed = existsSync(path);
    writeFileSync(path, body, "utf8");
    if (!existed) written += 1;
  }
  return written;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  console.log("🐦 Tweet Vault → Obsidian Export\n");
  console.log(`Output: ${options.output}\n`);

  console.log("Step 0: Connecting to Twitter...");
  const client = await getClient();
  const user = await client.getCurrentUser();
  if (!user.success || !user.user) {
    throw new Error("Could not authenticate with Twitter");
  }
  console.log(`  ✅ Authenticated as @${user.user.username}\n`);

  const includeBookmarks = !options.likesOnly;
  const includeLikes = !options.bookmarksOnly;

  let totalWritten = 0;
  if (includeBookmarks) {
    console.log("Step 1: Fetching bookmarks...");
    const bookmarks = await fetchTimeline(client, "bookmark", options);
    const written = writeNotes(options.output, "bookmark", bookmarks.tweets);
    totalWritten += written;
    console.log(`  ✅ Fetched ${bookmarks.tweets.length} bookmarks, wrote ${written} new notes`);
  }

  if (includeLikes) {
    console.log("Step 2: Fetching likes...");
    const likes = await fetchTimeline(client, "like", options);
    const written = writeNotes(options.output, "like", likes.tweets);
    totalWritten += written;
    console.log(`  ✅ Fetched ${likes.tweets.length} likes, wrote ${written} new notes`);
  }

  console.log(`\n🎉 Export complete. New notes written: ${totalWritten}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
