# Post-deploy monitoring — the QR rollout and the D4 flip (owner item R3)

The gate for flipping `REQUIRE_TABLE_TOKEN` to `true` is **48 consecutive hours with zero tokenless
orders**, not a date. This file is how you check that, what "old QR still in use" looks like, and how
to undo the flip.

## The daily check

```sql
-- tokenless vs with-token, every audit row ever recorded
SELECT CASE WHEN metadata->>'token_present' = 'false' THEN 'tokenless' ELSE 'with-token' END AS kind,
       count(*) AS orders,
       min(created_at) AS first_seen,
       max(created_at) AS last_seen
  FROM public.order_audit_logs
 GROUP BY 1 ORDER BY 1;
```

Run it once a day (the weekly CWV job cannot do this for you; the query is one line, and the numbers
only matter while the flag is false):

```
date | tokenless | with-token | tokenless last seen | hours since
_____|___________|____________|_____________________|____________
```

**Flip condition:** the `tokenless` row is absent (or its `last_seen` is more than 48 hours ago) AND
the store owners have had the reprint banner dismissed enough times that you believe the old sheets are
retired. The banner lives in `/dashboard/tables` and is per-project (`projects.qr_reprinted_at`), so
the second half of that sentence is a judgement call, not a number — **the 48 hours is the hard rule**.

## The flip

```bash
# 1. set the flag in Vercel (Production AND Preview), then redeploy
#    REQUIRE_TABLE_TOKEN=true
# 2. verify enforcement is live
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://dokanstore.xyz/api/public/order \
  -H 'content-type: application/json' \
  -d '{"projectSlug":"<store>","tableSlug":"table-1","items":[{"productId":"<uuid>","quantity":1}]}'
# expect 403 (was 200/201 while the flag was false)
# 3. a supplied-but-wrong token must still be 404, not 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://dokanstore.xyz/api/public/order \
  -H 'content-type: application/json' \
  -d '{"projectSlug":"<store>","tableSlug":"table-1","tableToken":"junk","items":[{"productId":"<uuid>","quantity":1}]}'
# expect 404
```

Then run `scripts/smoke-test.sh` with `SMOKE_ALLOW_WRITES=1`: the tokenless check must print
`403 (flag is true — enforcement is on)` and the valid-token check must still pass.

## Signals that an old QR is still in use

| signal | where | meaning |
|---|---|---|
| `token_present=false` on a new order | `order_audit_logs.metadata` (query above) | someone scanned an old sheet. **This is the one that matters.** |
| a `[Order] tokenless` warning | Sentry, warning level | the same event, with the project id and the request's ip/country |
| `TOKENLESS_LIMIT` hits (429) | Sentry, and the response body | a tokenless client exceeded the tight window budget (10/min, 60/h per project) — usually a legacy sheet being reloaded repeatedly, occasionally something automated |
| a 404 spike on `/api/public/order` | Sentry / Vercel analytics | wrong or stale tokens being presented — the normal shape of a partial reprint |
| PostgREST `42501` on `tables.qrcode` | Supabase logs | normal: `anon` is not allowed to read the token column, by design |

None of the first four is an error state; all are the telemetry the flip is supposed to be judged on.

## Rollback of the flip

`REQUIRE_TABLE_TOKEN=false` in Vercel → redeploy. Enforcement returns to the window behaviour
immediately (tokenless orders are accepted, recorded and rate-limited tightly). No migration, no data
change — the flag is read at request time.

```
flipped on:  __________  by: __________  reason: 48h clean, confirmed by query output above
rolled back: __________  because: __________
```
