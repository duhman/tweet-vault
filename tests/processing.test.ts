import test from "node:test";
import assert from "node:assert/strict";
import {
  clampEmbeddingInput,
  createLinkEmbeddingText,
  createTweetEmbeddingText,
  extractMetadataFromHtml,
  fetchLinkMetadataWithStrategy,
  getEmbeddingProviderConfig,
  requestOpenAICompatibleEmbeddings,
  selectLinksForMetadataProcessing,
} from "../shared/processing.js";

test("extracts metadata regardless of meta attribute order", () => {
  const metadata = extractMetadataFromHtml(`
    <html>
      <head>
        <meta content="A title" property="og:title">
        <meta name="description" content="A description here">
        <meta content="https://cdn.example.com/og.png" property="og:image">
      </head>
    </html>
  `);

  assert.deepEqual(metadata, {
    title: "A title",
    description: "A description here",
    og_image: "https://cdn.example.com/og.png",
  });
});

test("selects fresh and cooled-down links for metadata processing only", () => {
  const now = new Date("2026-04-13T08:00:00.000Z");
  const selected = selectLinksForMetadataProcessing(
    [
      { id: 1, url: "https://a.example.com", title: undefined, fetch_error: undefined },
      {
        id: 2,
        url: "https://b.example.com",
        title: undefined,
        fetch_error: "http:500",
        fetched_at: "2026-04-13T07:30:00.000Z",
      },
      {
        id: 3,
        url: "https://c.example.com",
        title: undefined,
        fetch_error: "http:500",
        fetched_at: "2026-04-11T07:30:00.000Z",
      },
      { id: 4, url: "https://done.example.com", title: "Done" },
    ],
    10,
    24,
    now,
  );

  assert.deepEqual(selected.map((link) => link.id), [1, 3]);
});

test("fetches metadata using the shared strategy", async () => {
  const metadata = (await fetchLinkMetadataWithStrategy(
    async () =>
      new Response(
        '<html><head><meta property="og:title" content="Shared title"><meta property="og:description" content="Shared description"></head></html>',
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      ),
    "https://example.com/article",
  )) as { ok: boolean; title?: string; description?: string };

  assert.equal(metadata.ok, true);
  assert.equal(metadata.title, "Shared title");
  assert.equal(metadata.description, "Shared description");
});

test("builds stable embedding text", () => {
  assert.match(
    createTweetEmbeddingText({
      content: "Hello world",
      author_username: "alice",
      author_name: "Alice",
    }),
    /Author: Alice \(@alice\)/,
  );

  assert.match(
    createLinkEmbeddingText({
      title: "Doc",
      description: "Deep dive",
      domain: "example.com",
      url: "https://example.com",
    }),
    /Domain: example\.com/,
  );

  assert.equal(clampEmbeddingInput("x".repeat(9000), 8000).length, 8000);
});

test("resolves OpenRouter as the default OpenAI-compatible route", () => {
  const config = getEmbeddingProviderConfig({
    OPENROUTER_API_KEY: "test-openrouter-key",
    OPENAI_API_KEY: "test-openai-key",
  });

  assert.deepEqual(
    {
      name: config.name,
      model: config.model,
      dimensions: config.dimensions,
      baseUrl: config.baseUrl,
    },
    {
      name: "openrouter",
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      baseUrl: "https://openrouter.ai/api/v1",
    },
  );
});

test("requests and validates OpenRouter-compatible embeddings", async () => {
  const originalFetch = globalThis.fetch;
  let request:
    | {
        url: string;
        body: Record<string, unknown>;
        authorization: string | null;
      }
    | undefined;
  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers);
    request = {
      url: String(input),
      body: JSON.parse(String(init?.body)),
      authorization: headers.get("authorization"),
    };
    return new Response(
      JSON.stringify({ data: [{ index: 0, embedding: Array(1536).fill(0.25) }] }),
      { headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const [embedding] = await requestOpenAICompatibleEmbeddings(
      "hello",
      getEmbeddingProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
    );
    assert.equal(embedding.length, 1536);
    assert.equal(request?.url, "https://openrouter.ai/api/v1/embeddings");
    assert.equal(request?.authorization, "Bearer test-key");
    assert.deepEqual(request?.body, {
      model: "openai/text-embedding-3-small",
      input: ["hello"],
      dimensions: 1536,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an OpenRouter response with the wrong vector dimensions", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ data: [{ embedding: [0, 1] }] }),
      { headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  try {
    await assert.rejects(
      requestOpenAICompatibleEmbeddings(
        "hello",
        getEmbeddingProviderConfig({ OPENROUTER_API_KEY: "test-key" }),
      ),
      /unexpected embedding shape/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
