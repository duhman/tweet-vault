import OpenAI from "openai";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROVIDER_GEMINI,
  EMBEDDING_PROVIDER_OPENAI,
  GEMINI_EMBEDDING_MODEL,
} from "./processing.js";

export type EmbeddingProviderName =
  typeof EMBEDDING_PROVIDER_OPENAI | typeof EMBEDDING_PROVIDER_GEMINI;

export type EmbeddingProvider = {
  name: EmbeddingProviderName;
  model: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
};

let openaiClient: OpenAI | null = null;

function getOpenAIClient(apiKey: string): OpenAI {
  if (openaiClient) return openaiClient;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

function getGoogleKey(env: NodeJS.ProcessEnv): string | undefined {
  return env.GOOGLE_API_KEY || env.GEMINI_API_KEY;
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

  if (embeddings.length !== texts.length) {
    throw new Error(
      `Gemini returned ${embeddings.length} vectors for ${texts.length} inputs`,
    );
  }

  return embeddings;
}

export function getEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingProvider {
  const googleKey = getGoogleKey(env);
  if (googleKey) {
    return {
      name: EMBEDDING_PROVIDER_GEMINI,
      model: GEMINI_EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      embed: (texts) => embedWithGemini(texts, googleKey),
    };
  }

  const openaiKey = env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error(
      "OPENAI_API_KEY or GOOGLE_API_KEY/GEMINI_API_KEY environment variable is missing or empty",
    );
  }

  return {
    name: EMBEDDING_PROVIDER_OPENAI,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    embed: async (texts) => {
      const response = await getOpenAIClient(openaiKey).embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });
      return response.data.map((item) => item.embedding);
    },
  };
}

export function getMissingEmbeddingEnvVars(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return env.OPENAI_API_KEY || getGoogleKey(env)
    ? []
    : ["OPENAI_API_KEY or GOOGLE_API_KEY/GEMINI_API_KEY"];
}
