# Migration manifest (owner item E4)

Every migration added on `fix/audit-remediation-20261005`, in order, with its apply timing. The
production ledger head at the time of writing is `20261006130000`, so the five files below are already
applied and the three marked PENDING are not.

| # | file | purpose | destructive | rollback | apply |
|---|---|---|---|---|---|
| 1 | `20261006090000_table_scan_token.sql` | `resolve_table_by_token` (SECURITY DEFINER, pinned `search_path`); unique index on `tables.qrcode` | no | in file | **already applied** |
| 2 | `20261006094000_qr_reprint_flag.sql` | `projects.qr_reprinted_at` + column-scoped UPDATE grant (decision 1's banner) | no | in file | **already applied** |
| 3 | `20261006110000_payment_idempotency.sql` | `record_payment_and_renew` takes `p_client_request_id` + a replay guard | no | in file | **already applied** |
| 4 | `20261006120000_replay_race.sql` | `create_order_transactional` catches `unique_violation` for concurrent same-key submits | no | in file | **already applied** |
| 5 | `20261006130000_subscription_payments_client_request_key.sql` | the client request key column on `subscription_payments` | no | in file | **already applied** |
| 6 | `20261006150000_default_acl_hardening.sql` | revokes the `postgres`-owned default grants that hand new `public` tables to `anon`/`authenticated` (audit T2 #14) | no (grants only) | in file | **PENDING — apply BEFORE or WITH the deploy** |
| 7 | `20261006160000_impersonation_at_rest.sql` | `super_admin_session` may not carry a refresh token; 15-minute ceiling; `used_at` single-use marker (audit T2 #15, A8 option A) | no (constraints + a column; the `DELETE` touches 0 rows) | in file | **PENDING — apply IMMEDIATELY AFTER the deploy** (see below) |
| 8 | `DEFERRED-DDL/20261006140000_drop_dead_schema.sql` | drops `service_requests` + its enum (audit T2 #13) | **yes** | in file | **DEFERRED by decision D1** — re-evaluate 7 days after deploy (OPS-VERIFICATION §13) |

## Why #7 must come after the deploy, and not before

The old production code inserts `super_admin_session` **with** the actor's refresh token. The new
CHECK rejects exactly that, so applying #7 first would break impersonation the moment the migration
lands. Order: deploy the new code (which writes an access token only) → then apply #7.

**Can it be made backward-compatible instead? Not usefully.** `ADD CONSTRAINT … NOT VALID` only skips
the check for EXISTING rows; new inserts are still enforced, so the old code's insert would fail
anyway. With 0 rows in the table there is nothing for `NOT VALID` to spare, and a later `VALIDATE
CONSTRAINT` would be instant. The accepted cost is therefore a short window (super-admin only) where
impersonation is unavailable — recorded in the runbook, step 7.

## Verification after applying #6 and #7

```sql
-- #6: 0 rows (see DRIFT-REPORT §3, query P8)
SELECT count(*) FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace,
  LATERAL aclexplode(d.defaclacl) a
 WHERE n.nspname='public' AND a.grantee IN ('anon'::regrole,'authenticated'::regrole);

-- #7: the four constraints and the column
SELECT conname FROM pg_constraint WHERE conrelid='public.impersonation_sessions'::regclass AND contype='c' ORDER BY 1;
SELECT count(*) FROM information_schema.columns WHERE table_name='impersonation_sessions' AND column_name='used_at';

-- #7 behavioural: a refresh token at rest must be refused (expect a CHECK violation)
INSERT INTO public.impersonation_sessions (super_admin_user_id, target_user_id, super_admin_session, target_session, expires_at)
VALUES ('<a user id>', '<another user id>', '{"access_token":"a","refresh_token":"r"}'::jsonb, '{}'::jsonb, now() + interval '10 minutes');
```
