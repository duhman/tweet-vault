import test from "node:test";
import assert from "node:assert/strict";
import { parseOptions as parseSyncOptions } from "../scripts/sync-from-bird.js";
import { parseOptions as parseExportOptions } from "../scripts/export-to-obsidian.js";

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

test("parses export output and defaults", () => {
  const options = parseExportOptions([
    "--bookmarks-only",
    "--output=/tmp/export",
  ]);

  assert.equal(options.bookmarksOnly, true);
  assert.equal(options.output, "/tmp/export");
  assert.equal(options.count, 50);
});

test("defaults Obsidian export to the workboi brain inbox", () => {
  const options = parseExportOptions(["--bookmarks-only"]);

  assert.equal(
    options.output,
    "/Users/workboi/projects/obsidian-memory/00-Inbox/feeds/twitter",
  );
});
