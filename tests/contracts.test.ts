import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { validateEnvironment } from "../mcp-server/index.js";
import { getEmbeddingProvider } from "../shared/embedding-provider.js";

const cwd = join(dirname(fileURLToPath(import.meta.url)), "..");

test("package scripts point at the compiled entrypoint", () => {
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  assert.equal(pkg.scripts.start, "bun run dist/src/index.js");
  assert.equal(pkg.scripts["smoke:mcp"], "bun run mcp -- --healthcheck");
});

test("run-mcp launcher is portable", () => {
  const launcher = readFileSync(join(cwd, "run-mcp.sh"), "utf8");
  assert.match(
    launcher,
    /SCRIPT_DIR="\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)" && pwd\)"/,
  );
  assert.match(launcher, /cd "\$SCRIPT_DIR"/);
});

test("MCP validation reports missing environment clearly", () => {
  const missing = validateEnvironment({
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "set",
    OPENAI_API_KEY: "",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(missing, [
    "SUPABASE_URL",
    "OPENROUTER_API_KEY or OPENAI_API_KEY (or EMBEDDING_PROVIDER=gemini with GOOGLE_API_KEY/GEMINI_API_KEY)",
  ]);
});

test("MCP validation accepts an OpenRouter embedding key", () => {
  const missing = validateEnvironment({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "set",
    OPENROUTER_API_KEY: "test-openrouter-key",
    OPENAI_API_KEY: "",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(missing, []);
});

test("MCP validation fails closed for a Google-only environment", () => {
  const missing = validateEnvironment({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "set",
    GOOGLE_API_KEY: "legacy-google-key",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(missing, [
    "OPENROUTER_API_KEY or OPENAI_API_KEY (or EMBEDDING_PROVIDER=gemini with GOOGLE_API_KEY/GEMINI_API_KEY)",
  ]);
});

test("MCP validation rejects whitespace-only OpenRouter keys", () => {
  const missing = validateEnvironment({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "set",
    OPENROUTER_API_KEY: "   ",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(missing, [
    "OPENROUTER_API_KEY or OPENAI_API_KEY (or EMBEDDING_PROVIDER=gemini with GOOGLE_API_KEY/GEMINI_API_KEY)",
  ]);
});

test("embedding provider prefers OpenRouter when configured", () => {
  const provider = getEmbeddingProvider({
    OPENROUTER_API_KEY: "test-openrouter-key",
    GOOGLE_API_KEY: "test-google-key",
    OPENAI_API_KEY: "test-openai-key",
  } as NodeJS.ProcessEnv);

  assert.equal(provider.name, "openrouter");
  assert.equal(provider.model, "openai/text-embedding-3-small");
  assert.equal(provider.dimensions, 1536);
});

test("Gemini requires explicit opt-in", () => {
  const provider = getEmbeddingProvider({
    EMBEDDING_PROVIDER: "gemini",
    OPENROUTER_API_KEY: "test-openrouter-key",
    GOOGLE_API_KEY: "test-google-key",
  } as NodeJS.ProcessEnv);

  assert.equal(provider.name, "gemini");
  assert.equal(provider.model, "gemini-embedding-001");
});

test("explicit OpenRouter fails when its key is missing", () => {
  assert.throws(
    () =>
      getEmbeddingProvider({
        EMBEDDING_PROVIDER: "openrouter",
        OPENAI_API_KEY: "test-openai-key",
      } as NodeJS.ProcessEnv),
    /OPENROUTER_API_KEY is missing or empty/,
  );
});

test("embedding provider keeps OpenAI as fallback", () => {
  const provider = getEmbeddingProvider({
    OPENAI_API_KEY: "test-openai-key",
  } as NodeJS.ProcessEnv);

  assert.equal(provider.name, "openai");
  assert.equal(provider.model, "text-embedding-3-small");
  assert.equal(provider.dimensions, 1536);
});

test("MCP healthcheck can run offline with mocked env", () => {
  const result = spawnSync("bun", ["run", "mcp", "--", "--healthcheck"], {
    cwd,
    env: {
      ...process.env,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      OPENROUTER_API_KEY: "test-openrouter-key",
      OPENAI_API_KEY: "",
      MCP_SKIP_REMOTE_VALIDATION: "1",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /healthcheck passed/);
});
