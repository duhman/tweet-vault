import { runProcessing } from "../utils/convex.js";

/**
 * Process all pending embeddings (tweets and links)
 */
export async function processAllEmbeddings(concurrency = 3): Promise<{
  tweets: { processed: number; failed: number };
  links: { processed: number; failed: number };
}> {
  const batchSize = Math.max(5, concurrency * 10);
  let tweetProcessed = 0;
  let linkProcessed = 0;
  let failed = 0;

  for (let round = 0; round < 50; round++) {
    const result = await runProcessing({
      tweetLimit: batchSize,
      likeLimit: batchSize,
      linkMetaLimit: 0,
      linkEmbedLimit: batchSize,
    });

    tweetProcessed += result.tweets_embedded;
    linkProcessed += result.links_embedded;
    failed += result.errors.length;

    if (result.tweets_embedded + result.links_embedded === 0) {
      break;
    }
  }

  return {
    tweets: { processed: tweetProcessed, failed },
    links: { processed: linkProcessed, failed },
  };
}
