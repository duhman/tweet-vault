import test from "node:test";
import assert from "node:assert/strict";
import {
  insertMissingLinks,
  insertMissingTweetInteractions,
  upsertTweetInteractions,
  upsertTweets,
  type Link,
  type Tweet,
  type TweetInteraction,
} from "../src/utils/supabase.js";
import {
  STATEMENT_TIMEOUT,
  blockRealSupabaseClient,
  stubClient,
} from "./support/stub-supabase.js";

blockRealSupabaseClient();

function tweets(count: number): Tweet[] {
  return Array.from({ length: count }, (_, index) => ({
    tweet_id: String(index + 1),
    author_username: "alice",
    content: `tweet ${index + 1}`,
  }));
}

function links(count: number): Link[] {
  return Array.from({ length: count }, (_, index) => ({
    tweet_id: String(index + 1),
    url: `https://example.com/${index + 1}`,
  }));
}

function likes(count: number): TweetInteraction[] {
  return Array.from({ length: count }, (_, index) => ({
    tweet_id: String(index + 1),
    interaction_type: "like" as const,
  }));
}

test("runs without Supabase credentials", () => {
  assert.equal(process.env.SUPABASE_URL, undefined);
  assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test("retries a timed-out tweet batch as two halves", async () => {
  const stub = stubClient({ tweets: [STATEMENT_TIMEOUT] });

  const result = await upsertTweets(tweets(8), stub.client);

  assert.deepEqual(stub.calls, [
    "tweets.select",
    "tweets.upsert:8",
    "tweets.upsert:4",
    "tweets.upsert:4",
  ]);
  assert.equal(stub.tables.tweets.size, 8);
  assert.equal(result.added.length, 8);
  assert.deepEqual(result.updated, []);
});

test("halves a timed-out half again before giving up on the rest", async () => {
  const stub = stubClient({ tweets: [STATEMENT_TIMEOUT, STATEMENT_TIMEOUT] });

  await upsertTweets(tweets(8), stub.client);

  assert.deepEqual(stub.calls, [
    "tweets.select",
    "tweets.upsert:8",
    "tweets.upsert:4",
    "tweets.upsert:2",
    "tweets.upsert:2",
    "tweets.upsert:4",
  ]);
  assert.equal(stub.tables.tweets.size, 8);
});

test("splits an odd-sized tweet batch into 13 + 12", async () => {
  const stub = stubClient({ tweets: [STATEMENT_TIMEOUT] });

  await upsertTweets(tweets(25), stub.client);

  assert.deepEqual(stub.calls, [
    "tweets.select",
    "tweets.upsert:25",
    "tweets.upsert:13",
    "tweets.upsert:12",
  ]);
  assert.equal(stub.tables.tweets.size, 25);
});

test("throws the timeout when a single tweet still times out", async () => {
  const stub = stubClient({
    tweets: [STATEMENT_TIMEOUT, STATEMENT_TIMEOUT, STATEMENT_TIMEOUT],
  });

  await assert.rejects(upsertTweets(tweets(4), stub.client), { code: "57014" });
  assert.deepEqual(stub.calls, [
    "tweets.select",
    "tweets.upsert:4",
    "tweets.upsert:2",
    "tweets.upsert:1",
  ]);
});

test("does not retry errors other than a statement timeout", async () => {
  const stub = stubClient({
    tweets: [
      { code: "23502", message: "null value violates not-null constraint" },
    ],
  });

  await assert.rejects(upsertTweets(tweets(4), stub.client), { code: "23502" });
  assert.deepEqual(stub.calls, ["tweets.select", "tweets.upsert:4"]);
});

test("sends at most 25 tweets per statement", async () => {
  const stub = stubClient();

  await upsertTweets(tweets(60), stub.client);

  assert.deepEqual(stub.calls, [
    "tweets.select",
    "tweets.upsert:25",
    "tweets.upsert:25",
    "tweets.upsert:10",
  ]);
});

test("retries a timed-out link batch as two halves", async () => {
  const stub = stubClient({ links: [STATEMENT_TIMEOUT] });

  const result = await insertMissingLinks(links(25), stub.client);

  assert.deepEqual(stub.calls, [
    "links.select",
    "links.upsert:25",
    "links.upsert:13",
    "links.upsert:12",
  ]);
  assert.equal(stub.tables.links.size, 25);
  assert.deepEqual(result, { inserted: 25 });
});

test("retries a timed-out interaction batch as two halves", async () => {
  const stub = stubClient({ tweet_interactions: [STATEMENT_TIMEOUT] });
  await upsertTweets(tweets(25), stub.client);
  stub.calls.length = 0;

  const result = await upsertTweetInteractions(likes(25), stub.client);

  assert.deepEqual(stub.calls, [
    "tweets.select",
    "tweet_interactions.select",
    "tweet_interactions.upsert:25",
    "tweet_interactions.upsert:13",
    "tweet_interactions.upsert:12",
  ]);
  assert.equal(stub.tables.tweet_interactions.size, 25);
  assert.deepEqual(result, { inserted: 25, updated: 0 });
});

test("every write names the unique columns as its conflict target", async () => {
  const stub = stubClient();

  await upsertTweets(tweets(1), stub.client);
  await insertMissingLinks(links(1), stub.client);
  await insertMissingTweetInteractions(likes(1), stub.client);
  await upsertTweetInteractions(likes(1), stub.client);

  assert.deepEqual(stub.upserts, [
    { table: "tweets", options: { onConflict: "tweet_id" } },
    {
      table: "links",
      options: { onConflict: "tweet_id,url", ignoreDuplicates: true },
    },
    {
      table: "tweet_interactions",
      options: {
        onConflict: "tweet_id,interaction_type",
        ignoreDuplicates: true,
      },
    },
    {
      table: "tweet_interactions",
      options: {
        onConflict: "tweet_id,interaction_type",
        ignoreDuplicates: false,
      },
    },
  ]);
});

// The lookup of stored rows and the write are two requests. A row stored by
// another run between them is not in the lookup result.
test("a link stored after the lookup is left as it is", async () => {
  const stub = stubClient({}, { links: [[]] });
  const stored = {
    tweet_id: "1",
    url: "https://example.com/1",
    title: "Fetched title",
  };
  stub.tables.links.set("1::https://example.com/1", stored);

  await insertMissingLinks(links(1), stub.client);

  assert.deepEqual(stub.calls, ["links.select", "links.upsert:1"]);
  assert.equal(stub.tables.links.get("1::https://example.com/1"), stored);
});

test("an interaction stored after the lookup is left as it is", async () => {
  const stub = stubClient({}, { tweet_interactions: [[]] });
  await upsertTweets(tweets(1), stub.client);
  const stored = {
    tweet_id: "1",
    interaction_type: "like",
    source: "bird/likes",
    metadata: { cursor: "next-page" },
  };
  stub.tables.tweet_interactions.set("1::like", stored);
  stub.calls.length = 0;

  await insertMissingTweetInteractions(
    [{ tweet_id: "1", interaction_type: "like", source: "manual-import" }],
    stub.client,
  );

  assert.deepEqual(stub.calls, [
    "tweets.select",
    "tweet_interactions.select",
    "tweet_interactions.upsert:1",
  ]);
  assert.equal(stub.tables.tweet_interactions.get("1::like"), stored);
});

// Checked by `bun run typecheck`: the refresh flag of the interaction writer
// is internal, and a boolean in the client position must not compile.
test("the client argument takes a client only", async () => {
  // @ts-expect-error a boolean is not a client
  await upsertTweetInteractions([], true);
});

test("empty input needs no client", async () => {
  assert.deepEqual(await upsertTweets([]), { added: [], updated: [] });
  assert.deepEqual(await insertMissingLinks([]), { inserted: 0 });
  assert.deepEqual(await insertMissingTweetInteractions([]), { inserted: 0 });
  assert.deepEqual(await upsertTweetInteractions([]), {
    inserted: 0,
    updated: 0,
  });
});
