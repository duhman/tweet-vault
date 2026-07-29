import test from "node:test";
import assert from "node:assert/strict";
import { parseOptions as parseSyncOptions } from "../scripts/sync-from-bird.js";

test("parses sync flags and defaults", () => {
  const options = parseSyncOptions([
    "--likes-only",
    "--count=25",
    "--embed-rounds=2",
  ]);

  assert.equal(options.likesOnly, true);
  assert.equal(options.bookmarksOnly, false);
  assert.equal(options.count, 25);
  assert.equal(options.embedRounds, 2);
});

test("rejects conflicting sync timeline flags", () => {
  assert.throws(
    () => parseSyncOptions(["--bookmarks-only", "--likes-only"]),
    /Use only one of --bookmarks-only or --likes-only\./,
  );
});
