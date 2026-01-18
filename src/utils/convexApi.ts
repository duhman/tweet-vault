export const api: any = {
  tweetVaultMutations: {
    upsertTweets: "tweetVaultMutations:upsertTweets",
    upsertLinks: "tweetVaultMutations:upsertLinks",
    recordSync: "tweetVaultMutations:recordSync",
  },
  tweetVaultQueries: {
    searchTweets: "tweetVaultQueries:searchTweets",
    searchLinks: "tweetVaultQueries:searchLinks",
    getTweet: "tweetVaultQueries:getTweet",
    listLinksByDomain: "tweetVaultQueries:listLinksByDomain",
    findRelated: "tweetVaultQueries:findRelated",
    vaultStats: "tweetVaultQueries:vaultStats",
    listAuthors: "tweetVaultQueries:listAuthors",
  },
  tweetVault: {
    processTweetVault: "tweetVault:processTweetVault",
  },
};
