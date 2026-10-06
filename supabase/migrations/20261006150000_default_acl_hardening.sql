-- W6-T2 (audit T2 #14): close the default-privilege gap for FUTURE tables in `public`.
--
-- THE DRIFT, measured 2026-10-06:
--   * `0000_init.sql:2019-2020` (the platform bootstrap) grants ALL on future TABLES in `public` to
--     `anon` and `authenticated` (and ALL on SEQUENCES at :1979-1980), owned by `postgres`.
--   * NO migration in this repository ever revokes that. A FRESH database therefore hands every new
--     table to the web roles the moment it is created, with RLS as the only thing saying otherwise.
--   * Production measures 0 such grants, i.e. the live database was cleaned OUTSIDE this repository.
--     That is the dangerous shape: the environment is clean, the source is not, and `supabase db
--     reset` (the CI job) rebuilds the exposed version.
--
-- So this migration makes the repository produce what production has been running. On an
-- already-clean database it is a no-op, which is why it is not verifiable by running it against
-- production; the CI `Fresh database · Security assertions` job is the verification that matters.
--
-- NOT TOUCHED, deliberately:
--   * FUNCTION defaults: `anon` needs EXECUTE on the SECURITY DEFINER resolvers the public menu
--     calls (`resolve_table_by_token`); revoking it would break ordering.
--   * `storage`, `graphql`, `graphql_public`: those defaults belong to platform services, not to this
--     application's data. Production holds 22 such entries owned by `postgres` in `storage` and 44
--     owned by `supabase_admin` in `graphql*`; changing them is not this repository's business.
--
-- ROLLBACK (restores exactly what 0000_init.sql created):
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
