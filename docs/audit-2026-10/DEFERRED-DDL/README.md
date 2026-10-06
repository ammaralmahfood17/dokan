# DEFERRED DDL — deliberately NOT in the deploy set

Owner decision **D1** (2026-10-06): the `service_requests` drop is deferred. The table is dead
surface but harmless, and the drop is irreversible.

## What is here

`20261006140000_drop_dead_schema.sql` — drops `public.service_requests` and its
`service_request_type` enum (used by no other column). It lives OUTSIDE `supabase/migrations/` on
purpose: `supabase db push` and the CI `db reset` only read that directory, so this file cannot be
applied by accident.

## To apply it later (re-evaluate 7 days after the deploy — OPS-VERIFICATION §13)

Apply the migration **and** the two changes that were reverted with it, or the suite will disagree
with the schema:

1. Move the file back into `supabase/migrations/` and `supabase db push`.
2. In `supabase/tests/phase4_5_advisor_hardening.sql`, restore the index list to four entries
   (add `'idx_service_requests_table_id'`) and the expected count `3` -> `4`.
3. `npm run db:types` to regenerate `src/lib/database.types.ts` (the table block and both
   `service_request_type` entries were removed by hand when this was written; they are back in the
   generated file today because the table still exists).

All three steps are one commit. Steps 2 and 3 are exactly what commit `9135bdc` did in reverse.
