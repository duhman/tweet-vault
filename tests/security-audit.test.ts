import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");

async function readMigrationCorpus(): Promise<string> {
  const names = await readdir(migrationsDir);
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith(".sql"))
      .map(async (name) => readFile(join(migrationsDir, name), "utf8")),
  );
  return files.join("\n");
}

test("tracked migrations do not contain rendered cron JWTs or service-role keys", async () => {
  const corpus = await readMigrationCorpus();

  assert.doesNotMatch(corpus, /Bearer\s+eyJ/);
  assert.doesNotMatch(corpus, /apikey["']?\s*[:,=]\s*["']eyJ/);
  assert.doesNotMatch(corpus, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*eyJ/);
});

test("tweet_vault migrations do not grant broad anon/authenticated DML", async () => {
  const corpus = (await readMigrationCorpus()).replace(/\s+/g, " ").toLowerCase();

  assert.doesNotMatch(
    corpus,
    /grant\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\s+(all\s+)?tables\s+in\s+schema\s+tweet_vault\s+to\s+anon/,
  );
  assert.doesNotMatch(
    corpus,
    /grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+tweet_vault\.[\w_]+\s+to\s+anon/,
  );
});

test("tweet_vault vector indexes and RPC contracts remain declared", async () => {
  const indexes = await readFile(
    join(migrationsDir, "0006_create_indexes.sql"),
    "utf8",
  );
  const functions = await readFile(
    join(migrationsDir, "0007_search_functions.sql"),
    "utf8",
  );
  const interactions = await readFile(
    join(migrationsDir, "0012_unified_interactions.sql"),
    "utf8",
  );

  assert.match(indexes, /CREATE INDEX tweets_embedding_hnsw_idx/i);
  assert.match(indexes, /CREATE INDEX links_embedding_hnsw_idx/i);
  assert.match(functions, /CREATE OR REPLACE FUNCTION tweet_vault\.search_tweets/i);
  assert.match(functions, /CREATE OR REPLACE FUNCTION tweet_vault\.search_links/i);
  assert.match(interactions, /create or replace function tweet_vault\.vault_stats/i);
});
