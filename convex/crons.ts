import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "tweet-vault-daily-sync",
  "0 6 * * *",
  api.tweetVault.syncTweetVault,
  { fetchAll: true, maxPages: 10, includeRaw: false },
);

export default crons;
