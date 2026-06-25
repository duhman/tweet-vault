import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("README documents the Codex MCP launcher without leaking secrets", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const codexSection = readme.slice(
    readme.indexOf("[mcp_servers.tweet-vault]"),
    readme.indexOf("### Example Queries"),
  );

  assert.match(readme, /\[mcp_servers\.tweet-vault\]/);
  assert.match(
    readme,
    /args = \["run", "--cwd", "\/Users\/workboi\/projects\/tweet-vault", "mcp"\]/,
  );
  assert.match(readme, /"SUPABASE_SCHEMA" = "tweet_vault"/);
  assert.doesNotMatch(codexSection, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(codexSection, /OPENAI_API_KEY/);
  assert.doesNotMatch(
    readme,
    /\/Users\/bigmac\/projects\/personal\/tweet-vault/,
  );
});

test("docs do not point at legacy tweet-vault project locations", async () => {
  const docs = [
    "README.md",
    "SETUP-LIKES-SYNC.md",
    ...(await readdir(join(root, "docs"))).map((name) => join("docs", name)),
  ];

  for (const doc of docs) {
    const content = await readFile(join(root, doc), "utf8");
    assert.doesNotMatch(
      content,
      /\/Users\/(?:bigmac|minimac)\/projects\/(?:personal\/)?tweet-vault/,
      doc,
    );
  }
});
