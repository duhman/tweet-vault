-- Grant service_role explicit access to interaction model objects.

begin;

grant usage on schema tweet_vault to service_role;
grant select, insert, update, delete on tweet_vault.tweet_interactions to service_role;
grant select on tweet_vault.twitter_likes to service_role;
grant execute on function tweet_vault.vault_stats to service_role;
grant execute on function tweet_vault.get_tweet_vault_stats to service_role;
grant usage, select on all sequences in schema tweet_vault to service_role;

commit;
