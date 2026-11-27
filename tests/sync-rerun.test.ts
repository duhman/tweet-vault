import test from "node:test";
import assert from "node:assert/strict";
import { processTweets } from "../src/process/tweets.js";
import { extractLinksFromTweets } from "../src/process/links.js";
import {
  insertMissingTweetInteractions,
  upsertTweetInteractions,
} from "../src/utils/supabase.js";
import {
  STATEMENT_TIMEOUT,
  blockRealSupabaseClient,
  stubClient,
} from "./support/stub-supabase.js";

blockRealSupabaseClient();

type Stub = ReturnType<typeof stubClient>;

const CONNECTION_LOST = { code: "08006", message: "connection failure" };

// 30 tweets are written as two statements (25 + 5). Each has one link.
function exportedTweets(count = 30): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    author: { username: "alice" },
    text: `tweet ${index + 1} https://example.com/post-${index + 1}`,
    created_at: "2026-11-27T10:00:00.000Z",
  }));
}

// These two functions repeat the steps the callers run between reading the
// tweets and fetching link metadata. The callers themselves need X and the
// embedding API, so the tests cannot run them.

// scripts/sync-from-bird.ts
async function syncRun(data: unknown[], stub: Stub): Promise<void> {
  const { tweets } = await processTweets(data, stub.client);
  await upsertTweetInteractions(
    (data as Array<{ id: string }>).map((tweet) => ({
      tweet_id: tweet.id,
      interaction_type: "bookmark" as const,
      source: "bird/bookmarks",
    })),
    stub.client,
  );
  await extractLinksFromTweets(tweets, stub.client);
}

// `tweet-vault import` (src/index.ts) and scripts/initial-import.ts
async function importRun(data: unknown[], stub: Stub): Promise<void> {
  const { tweets } = await processTweets(data, stub.client);
  await insertMissingTweetInteractions(
    tweets.map((tweet) => ({
      tweet_id: tweet.tweet_id,
      interaction_type: "bookmark" as const,
      interaction_at: tweet.created_at,
      source: "manual-import",
    })),
    stub.client,
  );
  await extractLinksFromTweets(tweets, stub.client);
}

function storedKeys(stub: Stub) {
  return {
    tweets: [...stub.tables.tweets.keys()].sort(),
    links: [...stub.tables.links.keys()].sort(),
    interactions: [...stub.tables.tweet_interactions.keys()].sort(),
  };
}

for (const [name, run] of [
  ["sync", syncRun],
  ["import", importRun],
] as const) {
  test(`${name}: a rerun after a failed tweet batch ends like one clean run`, async () => {
    const clean = stubClient();
    await run(exportedTweets(), clean);

    const stub = stubClient({ tweets: [null, CONNECTION_LOST] });
    await assert.rejects(run(exportedTweets(), stub), { code: "08006" });
    assert.equal(stub.tables.tweets.size, 25);
    assert.equal(stub.tables.links.size, 0);

    await run(exportedTweets(), stub);

    assert.ok(stub.tables.links.has("1::https://example.com/post-1"));
    assert.ok(stub.tables.tweet_interactions.has("1::bookmark"));
    assert.deepEqual(storedKeys(stub), storedKeys(clean));
    assert.equal(stub.tables.links.size, 30);
    assert.equal(stub.tables.tweet_interactions.size, 30);
  });

  test(`${name}: a rerun after a single-row timeout ends like one clean run`, async () => {
    const clean = stubClient();
    await run(exportedTweets(2), clean);

    // Both rows time out together, the first is stored alone, the second
    // times out alone.
    const stub = stubClient({
      tweets: [STATEMENT_TIMEOUT, null, STATEMENT_TIMEOUT],
    });
    await assert.rejects(run(exportedTweets(2), stub), { code: "57014" });
    assert.deepEqual([...stub.tables.tweets.keys()], ["1"]);

    await run(exportedTweets(2), stub);

    assert.ok(stub.tables.links.has("1::https://example.com/post-1"));
    assert.ok(stub.tables.tweet_interactions.has("1::bookmark"));
    assert.deepEqual(storedKeys(stub), storedKeys(clean));
  });

  test(`${name}: a rerun after a failed link write ends like one clean run`, async () => {
    const clean = stubClient();
    await run(exportedTweets(), clean);

    const stub = stubClient({ links: [CONNECTION_LOST] });
    await assert.rejects(run(exportedTweets(), stub), { code: "08006" });
    assert.equal(stub.tables.tweets.size, 30);
    assert.equal(stub.tables.links.size, 0);

    await run(exportedTweets(), stub);

    assert.deepEqual(storedKeys(stub), storedKeys(clean));
    assert.equal(stub.tables.links.size, 30);
  });

  test(`${name}: a second run of the same tweets writes no link`, async () => {
    const stub = stubClient();
    await run(exportedTweets(), stub);
    const stored = stub.tables.links.get("1::https://example.com/post-1");
    stub.calls.length = 0;

    await run(exportedTweets(), stub);

    assert.deepEqual(
      stub.calls.filter((call) => call.startsWith("links.")),
      ["links.select"],
    );
    assert.equal(
      stub.tables.links.get("1::https://example.com/post-1"),
      stored,
    );
  });
}

test("processTweets returns every stored tweet and counts the new ones", async () => {
  const stub = stubClient();
  await processTweets(exportedTweets(10), stub.client);

  const result = await processTweets(exportedTweets(30), stub.client);

  assert.equal(result.tweets.length, 30);
  assert.equal(result.added, 20);
  assert.equal(result.skipped, 10);
});

test("import leaves an interaction the sync wrote as it is", async () => {
  const stub = stubClient();
  await syncRun(exportedTweets(), stub);
  stub.calls.length = 0;

  await importRun(exportedTweets(), stub);

  assert.equal(
    stub.tables.tweet_interactions.get("1::bookmark")?.source,
    "bird/bookmarks",
  );
  assert.deepEqual(
    stub.calls.filter((call) => call.startsWith("tweet_interactions.")),
    ["tweet_interactions.select"],
  );
});

test("import adds the bookmark for a stored tweet that has none", async () => {
  const stub = stubClient();
  await processTweets(exportedTweets(), stub.client);

  await importRun(exportedTweets(), stub);

  assert.equal(stub.tables.tweet_interactions.size, 30);
  assert.equal(
    stub.tables.tweet_interactions.get("1::bookmark")?.source,
    "manual-import",
  );
});
