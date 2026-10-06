# Drift report — source vs production (owner item E3)

Read-only investigation, 2026-10-06. Queries and their output are below verbatim; nothing here was
applied to production (the one place a migration ran against production, it ran inside a transaction
that was rolled back, and that is marked).

## 1. The drift, exactly

**Source (`supabase/migrations/0000_init.sql:2019-2020`) grants default privileges in `public`:**

```
2019:ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
2020:ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
```

(and the sequence equivalents at `:1979-1980`).

**Production grants none.** Detection query and output:

```sql
SELECT coalesce(r.rolname,'-') AS owner, coalesce(n.nspname,'<global>') AS ns,
       d.defaclobjtype::text AS objtype, (a.grantee::regrole)::text AS grantee, a.privilege_type
  FROM pg_default_acl d
  LEFT JOIN pg_roles r ON r.oid = d.defaclrole
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
  LATERAL aclexplode(d.defaclacl) a
 WHERE a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
   AND (n.nspname = 'public' OR n.nspname IS NULL);
```
```
 rows: 0
```

So: **the environment was cleaned outside the repository, the source was not.** A fresh database
(`supabase db reset`, the CI job) rebuilds the exposed version. That is the whole finding, and it is
why it survived every review: production looks right.

The platform's remaining defaults are in OTHER schemas and are deliberately untouched:

| owner | schema | object | grantees | rows |
|---|---|---|---|---|
| `postgres` | `storage` | TABLE / SEQUENCE | `anon`, `authenticated` | 22 |
| `supabase_admin` | `graphql`, `graphql_public` | TABLE / SEQUENCE | `anon`, `authenticated` | 44 |

`supabase_admin`-owned defaults cannot be changed by the migration runner at all — attempted, and
Postgres answers `permission denied to change default privileges`. That is a platform/dashboard
setting (`auto_expose_new_tables`), recorded as an owner action in OPS-VERIFICATION §11.

## 2. Which migrations touch it, and are they safe against production?

| migration | touches the drift | behaviour against the real production state |
|---|---|---|
| `20261006150000_default_acl_hardening.sql` | **yes** — revokes the `postgres`-owned defaults in `public` | **no-op**: production already has none. Its purpose is to make a FRESH database match production. Idempotent (re-running a `REVOKE ALL` changes nothing). |
| `20261006160000_impersonation_at_rest.sql` | no | applies cleanly; verified inside a rolled-back transaction against production (§4) |
| `20261006140000_drop_dead_schema.sql` | no | **deferred by decision D1**, lives in `DEFERRED-DDL/` |

Already applied to production (in the ledger, `supabase_migrations.schema_migrations` head =
`20261006130000`): `20261006090000`, `20261006094000`, `20261006110000`, `20261006120000`,
`20261006130000`.

### Idempotency of every new migration

| migration | idempotent? | why |
|---|---|---|
| `20261006090000_table_scan_token.sql` | yes | `CREATE OR REPLACE FUNCTION` / `IF NOT EXISTS` forms |
| `20261006094000_qr_reprint_flag.sql` | yes | `ADD COLUMN IF NOT EXISTS` |
| `20261006110000_payment_idempotency.sql` | yes | `CREATE OR REPLACE FUNCTION` + explicit `REVOKE`/`GRANT` |
| `20261006120000_replay_race.sql` | yes | same shape |
| `20261006130000_subscription_payments_client_request_key.sql` | yes | `ADD COLUMN IF NOT EXISTS` |
| `20261006150000_default_acl_hardening.sql` | yes | `REVOKE ALL` twice is a no-op |
| `20261006160000_impersonation_at_rest.sql` | yes | `DROP CONSTRAINT IF EXISTS` before each `ADD`, `ADD COLUMN IF NOT EXISTS` |
| `DEFERRED-DDL/…drop_dead_schema.sql` | yes | `DROP TABLE/TYPE IF EXISTS` |

Clause-level behaviour, deliberately: two of the eight are **not** reversible statements (`DROP
CONSTRAINT` inside `160000` re-creates the constraint rather than restoring a prior one; `140000`
drops data if the table had any — it does not, 0 rows). Each file carries its own `-- ROLLBACK:`
header with the exact inverse, and the runbook keeps a per-step rollback.

## 3. Pre-flight queries to run on production before applying anything (read-only)

Run these and compare against the recorded baselines below. Any difference means the state moved
since this report and the migration set must be re-reasoned, not re-run.

```sql
-- P1 permissive policies: must be 0
SELECT count(*) FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true');

-- P3 RLS per public table: must be 21 of 21
SELECT count(*) FILTER (WHERE relrowsecurity) || ' of ' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r';

-- P4 SECURITY DEFINER functions must pin search_path (proconfig must never be <none>)
SELECT p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig,','),'<none>')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef ORDER BY 1;

-- P5 what Realtime publishes (orders/order_items only, plus Realtime's own internal tables)
SELECT schemaname||'.'||tablename FROM pg_publication_tables ORDER BY 1;

-- P6/P9 table grants for the web roles
SELECT t.tablename, g.grantee, string_agg(g.privilege_type, ',' ORDER BY g.privilege_type)
  FROM information_schema.role_table_grants g
  JOIN pg_tables t ON t.tablename=g.table_name AND t.schemaname=g.table_schema
 WHERE g.table_schema='public' AND g.grantee IN ('anon','authenticated')
 GROUP BY 1,2 ORDER BY 1;

-- P7 column-level grants (the narrow ones: e.g. authenticated may UPDATE only specific columns)
SELECT grantee, table_name, column_name, privilege_type
  FROM information_schema.column_privileges
 WHERE table_schema='public' AND grantee IN ('anon','authenticated') ORDER BY 1,2,3;

-- P8 the drift check itself: must be 0 rows
SELECT coalesce(r.rolname,'-'), coalesce(n.nspname,'<global>'), d.defaclobjtype,
       (a.grantee::regrole)::text, a.privilege_type
  FROM pg_default_acl d
  LEFT JOIN pg_roles r ON r.oid=d.defaclrole
  LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace,
  LATERAL aclexplode(d.defaclacl) a
 WHERE a.grantee IN ('anon'::regrole,'authenticated'::regrole)
   AND (n.nspname='public' OR n.nspname IS NULL);

-- P10 table-token format (amendment A1): must be 0
SELECT count(*) FROM public.tables WHERE qrcode !~ '^[0-9a-f]{32}$';

-- P11 order telemetry, the input to decision D4
SELECT CASE WHEN metadata->>'token_present'='false' THEN 'tokenless' ELSE 'with-token' END, count(*)
  FROM public.order_audit_logs GROUP BY 1;
```

### Baseline recorded 2026-10-06 (production)

| check | result |
|---|---|
| P1 permissive policies | **0** |
| P3 RLS | **21 of 21** |
| P4 SECURITY DEFINER | 24 functions, **all** `proconfig=search_path=public`, none `<none>` |
| P5 publication | `public.orders`, `public.order_items` (+ `realtime.messages_*` internal) |
| P6 grants (aggregate) | `anon` -> SELECT; `authenticated` -> DELETE,INSERT,SELECT,UPDATE |
| P9 grants (per table) | SELECT-only for `authenticated` on `orders`, `order_items`, `order_audit_logs`, `projects`; DELETE/INSERT/SELECT/UPDATE on `categories`, `products`, `product_addons`, `tables`, `staff_members`(no UPDATE), `push_subscriptions`, `telegram_links`, `telegram_link_codes`, `service_requests`; `anon` SELECT on `categories`, `products`, `product_addons` |
| P7 column-level | `anon`: SELECT on the public-read columns of categories/products/product_addons/projects/tables. `authenticated`: column-scoped UPDATE on `projects` (4 cols + `qr_reprinted_at`) and `staff_members` (2 notify cols) — no escalation path |
| P8 drift check | **0 rows** (production has no web-role default privileges in `public`) |
| P10 token format | **0** |
| P11 telemetry | `with-token` = 1, `tokenless` = **0** |

## 4. The one migration set run against a production-shaped database

The owner asked for the pending set to be exercised against something production-shaped, not only a
fresh database. There is no Supabase branch available to this session and no local Docker, so it was
run **against production itself, inside one transaction, then rolled back** (this is the only item in
this report that executed DDL against production; nothing committed):

```
begin;
<20261006150000_default_acl_hardening.sql>
<20261006160000_impersonation_at_rest.sql>
--- inside the transaction, after applying the pending set: ---
constraints on impersonation_sessions: impersonation_max_duration,
  impersonation_super_admin_session_no_refresh, impersonation_target_session_no_refresh,
  impersonation_used_requires_ended
used_at column: 1
default-ACL rows for web roles in public: 0
impersonation_sessions rows: 0
rollback;
```
```
EXIT=0
used_at exists after rollback: 0
```

So the pending set is proven against the real schema and data, and the database is verified unchanged
afterwards.

## 5. What this report does NOT establish (stated, not glossed)

- **A Supabase branch or a restored snapshot was not used.** Neither is reachable from this session:
  no Docker for the local stack, no branch credentials. The production transaction above is the
  closest available thing, and it is strictly better than a fresh `db reset` as evidence because it
  runs against the real objects, grants and constraints.
- **The `supabase_admin`-owned defaults cannot be verified as fixed from the repository**; only the
  owner can change them (dashboard), which is why the remedy is an ops step with a verification query.
- **`P7` output is long** (every column of every granted table). The query is above; run it and diff
  against the two-line summary in the baseline table.
