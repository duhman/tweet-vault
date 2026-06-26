-- Tweet Vault: harden runtime grants for the personal service-role automation model.

begin;

revoke all on schema tweet_vault from anon, authenticated;
grant usage on schema tweet_vault to service_role;

revoke all on all tables in schema tweet_vault from anon, authenticated;
revoke all on all sequences in schema tweet_vault from anon, authenticated;
revoke execute on all functions in schema tweet_vault from anon, authenticated;

grant all on all tables in schema tweet_vault to service_role;
grant usage, select on all sequences in schema tweet_vault to service_role;
grant execute on all functions in schema tweet_vault to service_role;

alter default privileges in schema tweet_vault
revoke all on tables from anon, authenticated;
alter default privileges in schema tweet_vault
grant select, insert, update, delete on tables to service_role;

alter default privileges in schema tweet_vault
revoke all on sequences from anon, authenticated;
alter default privileges in schema tweet_vault
grant usage, select on sequences to service_role;

alter default privileges in schema tweet_vault
revoke execute on functions from anon, authenticated;
alter default privileges in schema tweet_vault
grant execute on functions to service_role;

commit;
