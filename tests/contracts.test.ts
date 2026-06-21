import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { validateEnvironment } from "../mcp-server/index.js";

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

  assert.deepEqual(missing, ["SUPABASE_URL", "OPENAI_API_KEY"]);
});

test("MCP healthcheck can run offline with mocked env", () => {
  const result = spawnSync("bun", ["run", "mcp", "--", "--healthcheck"], {
    cwd,
    env: {
      ...process.env,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      OPENAI_API_KEY: "test-openai-key",
      MCP_SKIP_REMOTE_VALIDATION: "1",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /healthcheck passed/);
});
