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

---

## Migrations after this manifest (state as of 2026-10-13)

The table at the top stops at the 2026-10-06 remediation set. Everything shipped since is listed
here with the same facts: what it does, whether it is destructive, and its apply state — all
verified against production, not inferred.

| # | file | purpose | destructive | apply |
|---|---|---|---|---|
| 9 | `20261006190000_product_options.sql` | `option_groups` / `option_choices` + their RLS and grants; `create_order_transactional` repriced against option choices; flat addons retired (then dropped) | no (the dropped table held 0 rows) | **applied** — verified by the two tables' existence and the RPC's signature |
| 10 | `20261006200000_drop_legacy_addons.sql` | drops the retired `product_addons` table | no (empty) | **applied** |
| 11 | `20261008100000_phase1_ingredient_inventory.sql` | ingredient inventory: tables, ledger, four SECURITY DEFINER RPCs | no | **applied** — `adjust_ingredient_stock`, `replace_product_recipe` present in `pg_proc` |
| 12 | `20261013120000_upsert_product_with_options.sql` | **new** — one transactional RPC replacing the product editor's ten un-transacted statements (architecture review 2026-10-13, finding P0) | no (a new function + its grants) | **applied 2026-10-13, BEFORE the code deploy — required**, because the deployed modal starts calling it the moment the build lands |

### Verification for #12

```sql
-- exists, is SECURITY INVOKER, and is callable by exactly authenticated + service_role
SELECT p.proname, p.prosecdef, p.proacl::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'upsert_product_with_options';
-- expect: prosecdef = f; acl = {postgres=…,service_role=…,authenticated=…}  (no anon, no PUBLIC)
```

Behavioural proof (21 assertions) lives in `supabase/tests/phase8_product_upsert.sql` and runs in
CI's fresh-database job. It was also executed once against **production inside a transaction that
was rolled back in full** (21/21 ok, row counts unchanged afterwards) — the same "prove it on the
real database, leave nothing behind" method used for the earlier audits.


## 2026-10-16 — the Task-2 backend-remediation set (#13–#16)

Four migrations from the backend audit's findings. **Written, dry-run on production inside a
rolled-back transaction (all four applied cleanly and their effects verified), NOT yet applied —
each one needs the owner's own approval, per the standing gate.**

| # | file | purpose | destructive | apply |
|---|---|---|---|---|
| 13 | `20261016120000_role_service_timeouts.sql` | `service_role`: `statement_timeout=15s` + `lock_timeout=8s`; and `idle_in_transaction_session_timeout=30s` on `authenticated`/`anon`/`service_role` — the ONE genuinely unbounded wait left (B-4). Measured before: `anon` 3s · `authenticated` 8s · `authenticator` 8s+8s lock · **`service_role` (none)**, no idle timeout anywhere | no (role settings) | **PENDING approval** |
| 14 | `20261016121000_drop_inert_write_policies.sql` | drops 4 policies that cannot allow anything because the role holds no matching GRANT: `orders_staff_insert`, `order_audit_logs_insert` (authenticated has SELECT only on orders/order_items, table AND column level) and both `subscription_payments` "Super admins can …" policies (their `EXISTS` reads `super_admins`, which is FORCED RLS with zero policies) (B-7) | no (they can never fire; dropping makes a future re-grant fail CLOSED) | **PENDING approval** |
| 15 | `20261016122000_drop_misleading_amount_trigger.sql` | drops `orders_validate_amount_on_insert` + its function: it short-circuits for `service_role` — the only role that can insert — and made `create_order_transactional` fail for anyone else with «total_amount must match order_items sum» (measured). The boundary is the absent INSERT grant (B-7) | no | **PENDING approval** |
| 16 | `20261016123000_auth_signup_requires_api_marker.sql` | a BEFORE INSERT trigger on `auth.users` requiring `raw_app_meta_data->>'provisioned_by' = 'dokan-admin-api'`, the marker only the app's route can set (GoTrue maps client input to `user_metadata`, never `app_metadata`). This is what makes the owner's closed-signups decision true at the data layer: `POST /auth/v1/signup` with the PUBLIC anon key answers 422 `weak_password` — GoTrue's own handler, validating a request it would create an account for (B-1) | no — but **it changes who can create accounts**: a user added by hand in the Supabase dashboard is refused | **PENDING approval** |

**Ordering constraint for #16:** the code that sets the marker (`src/app/api/auth/signup/route.ts`)
must be DEPLOYED BEFORE the migration is applied, or the app's own signup breaks until the deploy
lands. Apply it after the Vercel build for this batch is Ready.

**Verification already done (production, rolled back, nothing written):**

```sql
-- #13: the timeouts land on the roles the requests actually run as
--   authenticated=statement_timeout=8s,idle_in_transaction_session_timeout=30s
--   anon=statement_timeout=3s,idle_in_transaction_session_timeout=30s
--   service_role=statement_timeout=15s,lock_timeout=8s,idle_in_transaction_session_timeout=30s
-- #14: inert_policies_left=0      #15: amount_trigger=0, amount_func=0
-- #16: auth_guard=1, and behaviourally, in the SAME transaction:
--   an insert without the marker -> NOTICE "EXPECTED: refused (42501): account creation is closed"
--   an insert with the marker    -> NOTICE "EXPECTED: the app provisioning path is accepted"
```

`supabase/tests/phase11_auth_signup_boundary.sql` (4 assertions) pins #16 for CI's fresh-database
job, and `phase4_5_advisor_hardening.sql` drops its two assertions for the removed function
(plan 10 -> 8) with the reason inline.

**Correction to the audit, recorded here so it is not re-filed:** B-10 claimed the two retention
tables had no visible retention index. They DO: `impersonation_sessions_expires_idx (expires_at)`
and `super_admin_audit_log_created_at_idx (created_at DESC)` both exist, so the sweeps are indexed
and the sizes (216KB / 160KB) are just data volume. No migration written for it.
