import { createClient } from "@supabase/supabase-js";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  getEmbeddingProviderMetadata,
} from "../../shared/processing.js";
import { getStats, getSupabaseClient } from "./supabase.js";

export interface VaultHealthSync {
  last_sync_at: string;
  sync_type: string;
  tweets_added: number;
  links_processed: number;
  embeddings_generated: number;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface VaultHealthCronRun {
  jobname: string;
  last_run: string | null;
  status: string | null;
  return_message: string | null;
}

export interface VaultHealth {
  generated_at: string;
  schema: string;
  embedding: ReturnType<typeof getEmbeddingProviderMetadata>;
  totals: {
    tweets: number;
    links: number;
    bookmarks: number;
    likes: number;
    tweets_with_embeddings: number;
    links_with_embeddings: number;
  };
  pending: {
    tweets_missing_embeddings: number;
    links_missing_metadata: number;
    links_missing_embeddings: number;
    links_ready_missing_embeddings: number;
    links_with_fetch_error: number;
  };
  recent_syncs: VaultHealthSync[];
  cron_jobs: VaultHealthCronRun[];
  warnings: string[];
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is missing or empty`);
  }
  return value;
}

function getPublicSupabaseClient(): any {
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { db: { schema: "public" } },
  );
}

async function countRows(table: string, applyFilter: (builder: any) => any): Promise<number> {
  const base = getSupabaseClient().from(table).select("*", {
    count: "exact",
    head: true,
  });
  const { count, error } = await applyFilter(base);
  if (error) throw error;
  return count ?? 0;
}

export async function getVaultHealth(options: {
  includeCron?: boolean;
  recentSyncLimit?: number;
  cronSinceHours?: number;
} = {}): Promise<VaultHealth> {
  const includeCron = options.includeCron ?? true;
  const recentSyncLimit = Math.max(1, options.recentSyncLimit ?? 5);
  const cronSinceHours = Math.max(1, options.cronSinceHours ?? 168);
  const schema = process.env.SUPABASE_SCHEMA || "tweet_vault";
  const supabase = getSupabaseClient();
  const warnings: string[] = [];

  const [
    stats,
    tweetsMissingEmbeddings,
    linksMissingMetadata,
    linksMissingEmbeddings,
    linksReadyMissingEmbeddings,
    linksWithFetchError,
    recentSyncResult,
  ] = await Promise.all([
    getStats(),
    countRows("tweets", (query) => query.is("embedding", null)),
    countRows("links", (query) => query.is("title", null)),
    countRows("links", (query) => query.is("embedding", null)),
    countRows("links", (query) =>
      query.not("title", "is", null).is("embedding", null),
    ),
    countRows("links", (query) => query.not("fetch_error", "is", null)),
    supabase
      .from("sync_state")
      .select(
        "last_sync_at,sync_type,tweets_added,links_processed,embeddings_generated,error_message,metadata",
      )
      .order("last_sync_at", { ascending: false })
      .limit(recentSyncLimit),
  ]);

  if (recentSyncResult.error) {
    throw recentSyncResult.error;
  }

  let cronJobs: VaultHealthCronRun[] = [];
  if (includeCron) {
    const since = new Date(
      Date.now() - cronSinceHours * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await getPublicSupabaseClient().rpc(
      "get_recent_cron_runs",
      { since_time: since },
    );
    if (error) {
      warnings.push(`cron_status_unavailable:${error.message}`);
    } else {
      cronJobs = data ?? [];
    }
  }

  return {
    generated_at: new Date().toISOString(),
    schema,
    embedding: {
      ...getEmbeddingProviderMetadata(),
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    },
    totals: {
      tweets: stats.total_tweets,
      links: stats.total_links,
      bookmarks: stats.bookmarks_count ?? 0,
      likes: stats.likes_count ?? 0,
      tweets_with_embeddings: stats.tweets_with_embeddings,
      links_with_embeddings: stats.links_with_embeddings,
    },
    pending: {
      tweets_missing_embeddings: tweetsMissingEmbeddings,
      links_missing_metadata: linksMissingMetadata,
      links_missing_embeddings: linksMissingEmbeddings,
      links_ready_missing_embeddings: linksReadyMissingEmbeddings,
      links_with_fetch_error: linksWithFetchError,
    },
    recent_syncs: recentSyncResult.data ?? [],
    cron_jobs: cronJobs,
    warnings,
  };
}

export function formatVaultHealth(health: VaultHealth): string {
  const latestSync = health.recent_syncs[0];
  const cronLines =
    health.cron_jobs.length > 0
      ? health.cron_jobs
          .map(
            (job) =>
              `- ${job.jobname}: ${job.status ?? "unknown"}${job.last_run ? ` at ${job.last_run}` : ""}`,
          )
          .join("\n")
      : "- No recent cron runs available";

  const warnings =
    health.warnings.length > 0
      ? `\n\n**Warnings:**\n${health.warnings.map((item) => `- ${item}`).join("\n")}`
      : "";

  return `## Tweet Vault Health

**Schema:** ${health.schema}
**Embedding model:** ${health.embedding.model} (${health.embedding.dimensions}d)

**Totals:**
- Tweets: ${health.totals.tweets}
- Links: ${health.totals.links}
- Bookmarks: ${health.totals.bookmarks}
- Likes: ${health.totals.likes}
- Tweets with embeddings: ${health.totals.tweets_with_embeddings}
- Links with embeddings: ${health.totals.links_with_embeddings}

**Pending work:**
- Tweets missing embeddings: ${health.pending.tweets_missing_embeddings}
- Links missing metadata: ${health.pending.links_missing_metadata}
- Links missing embeddings: ${health.pending.links_missing_embeddings}
- Metadata-ready links missing embeddings: ${health.pending.links_ready_missing_embeddings}
- Links with fetch errors: ${health.pending.links_with_fetch_error}

**Latest sync:**
- Time: ${latestSync?.last_sync_at ?? "none"}
- Type: ${latestSync?.sync_type ?? "none"}
- Embeddings generated: ${latestSync?.embeddings_generated ?? 0}

**Cron:**
${cronLines}${warnings}`;
}
