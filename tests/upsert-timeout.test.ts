import test from "node:test";
import assert from "node:assert/strict";
import { upsertTweets, type Tweet } from "../src/utils/supabase.js";

const STATEMENT_TIMEOUT = {
  code: "57014",
  details: null,
  hint: null,
  message: "canceling statement due to statement timeout",
};

type StubError = { code: string; message: string };

// Stands in for the Supabase client: answers the existing-id lookup from the
// rows written so far and fails upserts with the queued errors, in order.
function stubClient(upsertErrors: Array<StubError | null> = []) {
  const rows = new Map<string, Record<string, unknown>>();
  const upsertSizes: number[] = [];
  const client = {
    from() {
      return {
        select() {
          return {
            in: async (_column: string, ids: string[]) => ({
              data: ids
                .filter((id) => rows.has(id))
                .map((tweet_id) => ({ tweet_id })),
              error: null,
            }),
          };
        },
        upsert: async (payload: Array<Record<string, unknown>>) => {
          upsertSizes.push(payload.length);
          const error = upsertErrors.shift() ?? null;
          if (error) return { error };
          for (const row of payload) rows.set(row.tweet_id as string, row);
          return { error: null };
        },
      };
    },
  };
  return { client, rows, upsertSizes };
}

function tweets(count: number): Tweet[] {
  return Array.from({ length: count }, (_, index) => ({
    tweet_id: String(index + 1),
    author_username: "alice",
    content: `tweet ${index + 1}`,
  }));
}

test("retries a timed-out tweet batch as two halves", async () => {
  const stub = stubClient([STATEMENT_TIMEOUT]);

  const result = await upsertTweets(tweets(8), stub.client);

  assert.deepEqual(stub.upsertSizes, [8, 4, 4]);
  assert.equal(stub.rows.size, 8);
  assert.equal(result.added.length, 8);
  assert.deepEqual(result.updated, []);
});

test("halves a timed-out half again before giving up on the rest", async () => {
  const stub = stubClient([STATEMENT_TIMEOUT, STATEMENT_TIMEOUT]);

  await upsertTweets(tweets(8), stub.client);

  assert.deepEqual(stub.upsertSizes, [8, 4, 2, 2, 4]);
  assert.equal(stub.rows.size, 8);
});

test("throws the timeout when a single tweet still times out", async () => {
  const stub = stubClient([
    STATEMENT_TIMEOUT,
    STATEMENT_TIMEOUT,
    STATEMENT_TIMEOUT,
  ]);

  await assert.rejects(upsertTweets(tweets(4), stub.client), { code: "57014" });
  assert.deepEqual(stub.upsertSizes, [4, 2, 1]);
});

test("does not retry errors other than a statement timeout", async () => {
  const stub = stubClient([
    { code: "23502", message: "null value violates not-null constraint" },
  ]);

  await assert.rejects(upsertTweets(tweets(4), stub.client), { code: "23502" });
  assert.deepEqual(stub.upsertSizes, [4]);
});

test("sends at most 25 tweets per statement", async () => {
  const stub = stubClient();

  await upsertTweets(tweets(60), stub.client);

  assert.deepEqual(stub.upsertSizes, [25, 25, 10]);
});
