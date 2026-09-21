import OpenAI from "openai";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDER_GEMINI,
  EMBEDDING_PROVIDER_OPENAI,
  EMBEDDING_PROVIDER_OPENROUTER,
  GEMINI_EMBEDDING_MODEL,
  getConfiguredEmbeddingProviderName,
  getEmbeddingProviderConfig,
} from "./processing.js";

export type EmbeddingProviderName =
  | typeof EMBEDDING_PROVIDER_OPENAI
  | typeof EMBEDDING_PROVIDER_OPENROUTER
  | typeof EMBEDDING_PROVIDER_GEMINI;

export type EmbeddingProvider = {
  name: EmbeddingProviderName;
  model: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
};

const openaiClients = new Map<string, OpenAI>();

function hasEnvValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function getOpenAIClient(apiKey: string, baseURL: string): OpenAI {
  const cacheKey = `${baseURL}\u0000${apiKey}`;
  const cached = openaiClients.get(cacheKey);
  if (cached) return cached;

  const client = new OpenAI({ apiKey, baseURL });
  openaiClients.set(cacheKey, client);
  return client;
}

function validateEmbeddings(
  embeddings: number[][],
  expectedCount: number,
  provider: string,
): number[][] {
  if (
    embeddings.length !== expectedCount ||
    embeddings.some(
      (embedding) =>
        !Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS,
    )
  ) {
    throw new Error(
      `${provider} returned an unexpected embedding shape for ${expectedCount} input(s)`,
    );
  }
  return embeddings;
}

async function embedWithGemini(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini embedding API error: ${body.slice(0, 500)}`);
  }

  const body = (await response.json()) as {
    embeddings?: Array<{ values?: number[] }>;
  };
  const embeddings = (body.embeddings ?? []).map((item) => item.values ?? []);
  return validateEmbeddings(embeddings, texts.length, "Gemini");
}

export function getEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingProvider {
  const config = getEmbeddingProviderConfig(env);

  if (config.name === EMBEDDING_PROVIDER_GEMINI) {
    return {
      name: EMBEDDING_PROVIDER_GEMINI,
      model: GEMINI_EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      embed: (texts) => embedWithGemini(texts, config.apiKey),
    };
  }

  const model = config.model;
  const providerName = config.name as EmbeddingProviderName;
  const client = getOpenAIClient(config.apiKey, config.baseUrl);

  return {
    name: providerName,
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    embed: async (texts) => {
      const response = await client.embeddings.create({
        model,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
      });
      const embeddings = response.data
        .slice()
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
        .map((item) => item.embedding);
      return validateEmbeddings(embeddings, texts.length, config.name);
    },
  };
}

export function getMissingEmbeddingEnvVars(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  let provider: string | undefined;
  try {
    provider = getConfiguredEmbeddingProviderName(env);
  } catch (error) {
    return [error instanceof Error ? error.message : "Invalid EMBEDDING_PROVIDER"];
  }

  if (!provider) {
    return [
      "OPENROUTER_API_KEY or OPENAI_API_KEY (or EMBEDDING_PROVIDER=gemini with GOOGLE_API_KEY/GEMINI_API_KEY)",
    ];
  }

  if (
    provider === EMBEDDING_PROVIDER_OPENROUTER &&
    !hasEnvValue(env.OPENROUTER_API_KEY)
  ) {
    return ["OPENROUTER_API_KEY"];
  }
  if (provider === EMBEDDING_PROVIDER_OPENAI && !hasEnvValue(env.OPENAI_API_KEY)) {
    return ["OPENAI_API_KEY"];
  }
  if (
    provider === EMBEDDING_PROVIDER_GEMINI &&
    !hasEnvValue(env.GOOGLE_API_KEY) &&
    !hasEnvValue(env.GEMINI_API_KEY)
  ) {
    return ["GOOGLE_API_KEY or GEMINI_API_KEY"];
  }
  return [];
}
