import test from "node:test";
import assert from "node:assert/strict";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  GEMINI_EMBEDDING_MODEL,
  getEmbeddingProviderMetadata,
} from "../shared/processing.js";
import { formatVaultHealth, type VaultHealth } from "../src/utils/health.js";

test("embedding provider metadata keeps vector dimensions stable", () => {
  assert.equal(EMBEDDING_MODEL, "text-embedding-3-small");
  assert.equal(EMBEDDING_DIMENSIONS, 1536);

  assert.deepEqual(getEmbeddingProviderMetadata("openai"), {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
    max_input_chars: 8000,
    retries: 4,
  });

  assert.equal(getEmbeddingProviderMetadata("gemini").model, GEMINI_EMBEDDING_MODEL);
  assert.equal(getEmbeddingProviderMetadata("gemini").dimensions, 1536);
});

test("formats vault health with pending backlog and cron status", () => {
  const health: VaultHealth = {
    generated_at: "2026-06-26T08:00:00.000Z",
    schema: "tweet_vault",
    embedding: getEmbeddingProviderMetadata("openai"),
    totals: {
      tweets: 10,
      links: 4,
      bookmarks: 7,
      likes: 3,
      tweets_with_embeddings: 8,
      links_with_embeddings: 2,
    },
    pending: {
      tweets_missing_embeddings: 2,
      links_missing_metadata: 1,
      links_missing_embeddings: 2,
      links_ready_missing_embeddings: 1,
      links_with_fetch_error: 1,
    },
    recent_syncs: [
      {
        last_sync_at: "2026-06-26T06:00:00.000Z",
        sync_type: "cron",
        tweets_added: 1,
        links_processed: 2,
        embeddings_generated: 3,
      },
    ],
    cron_jobs: [
      {
        jobname: "tweet-vault-daily-sync",
        last_run: "2026-06-26T06:00:00.000Z",
        status: "succeeded",
        return_message: "1 row",
      },
    ],
    warnings: [],
  };

  const formatted = formatVaultHealth(health);
  assert.match(formatted, /Tweets missing embeddings: 2/);
  assert.match(formatted, /tweet-vault-daily-sync: succeeded/);
  assert.match(formatted, /text-embedding-3-small \(1536d\)/);
});
