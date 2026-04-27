import test from "node:test";
import assert from "node:assert/strict";
import {
  extractUrlsFromTweet,
  parseExportedTweet,
  parseGraphQLTweet,
} from "../src/process/tweets.js";

test("parses exported tweet format", () => {
  const tweet = parseExportedTweet({
    id: "123",
    author: { username: "alice", name: "Alice" },
    text: "hello world",
    created_at: "2025-01-02T03:04:05.000Z",
    media: ["https://cdn.example.com/image.jpg"],
    metrics: { likes: 10 },
  });

  assert.ok(tweet);
  assert.equal(tweet.tweet_id, "123");
  assert.equal(tweet.author_username, "alice");
  assert.deepEqual(tweet.media_urls, ["https://cdn.example.com/image.jpg"]);
});

test("parses GraphQL tweet format", () => {
  const tweet = parseGraphQLTweet({
    rest_id: "456",
    core: {
      user_results: {
        result: {
          legacy: {
            screen_name: "bob",
            name: "Bob",
            profile_image_url_https: "https://example.com/avatar.jpg",
          },
        },
      },
    },
    legacy: {
      full_text: "Look at https://example.com/demo",
      created_at: "Mon Apr 07 10:00:00 +0000 2025",
      entities: {
        urls: [
          {
            url: "https://t.co/demo",
            expanded_url: "https://example.com/demo",
            display_url: "example.com/demo",
          },
        ],
      },
      favorite_count: 42,
      retweet_count: 7,
      reply_count: 3,
    },
  });

  assert.ok(tweet);
  assert.equal(tweet.tweet_id, "456");
  assert.equal(tweet.metrics?.likes, 42);
});

test("extracts entity URLs and repairs wrapped content URLs", () => {
  const urls = extractUrlsFromTweet({
    tweet_id: "1",
    author_username: "alice",
    content:
      "Useful link https://example.com/lo\nng/path and https://second.example.com/post.",
    raw_data: {
      legacy: {
        entities: {
          urls: [
            {
              url: "https://t.co/demo",
              expanded_url: "https://example.com/long/path",
              display_url: "example.com/long/path",
            },
          ],
        },
      },
    },
  });

  assert.deepEqual(urls, [
    {
      url: "https://t.co/demo",
      expanded_url: "https://example.com/long/path",
      display_url: "example.com/long/path",
    },
    {
      url: "https://second.example.com/post",
    },
  ]);
});
