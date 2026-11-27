import { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getSupabaseClient } from "../../src/utils/supabase.js";

export type StubError = { code: string; message: string };
type Table = "tweets" | "links" | "tweet_interactions";
type Row = Record<string, unknown>;

export const STATEMENT_TIMEOUT: StubError = {
  code: "57014",
  message: "canceling statement due to statement timeout",
};

const rowKey: Record<Table, (row: Row) => string> = {
  tweets: (row) => String(row.tweet_id),
  links: (row) => `${row.tweet_id}::${row.url}`,
  tweet_interactions: (row) => `${row.tweet_id}::${row.interaction_type}`,
};

// Bun loads .env from the working directory and scripts/sync-from-bird.ts
// loads it again on import, so a checkout with a real .env hands these tests
// the production credentials. Every test using the stub starts by removing
// them and proving that the code under test cannot build a real client.
export function blockRealSupabaseClient(): void {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(() => getSupabaseClient(), /Missing SUPABASE_URL/);
  });
}

// Stands in for the Supabase client. It keeps the written rows per table,
// answers `.select().in()` from them, fails upserts with the errors queued for
// that table, in order, and records every call it receives.
export function stubClient(
  upsertErrors: Partial<Record<Table, Array<StubError | null>>> = {},
) {
  const tables: Record<Table, Map<string, Row>> = {
    tweets: new Map(),
    links: new Map(),
    tweet_interactions: new Map(),
  };
  const calls: string[] = [];

  const client = {
    from(table: Table) {
      return {
        select() {
          return {
            in: async (column: string, values: string[]) => {
              calls.push(`${table}.select`);
              return {
                data: [...tables[table].values()].filter((row) =>
                  values.includes(row[column] as string),
                ),
                error: null,
              };
            },
          };
        },
        upsert: async (
          payload: Row[],
          options: { ignoreDuplicates?: boolean } = {},
        ) => {
          calls.push(`${table}.upsert:${payload.length}`);
          const error = upsertErrors[table]?.shift() ?? null;
          if (error) return { error };
          for (const row of payload) {
            const key = rowKey[table](row);
            if (options.ignoreDuplicates && tables[table].has(key)) continue;
            tables[table].set(key, row);
          }
          return { error: null };
        },
      };
    },
  };

  return { client, tables, calls };
}
