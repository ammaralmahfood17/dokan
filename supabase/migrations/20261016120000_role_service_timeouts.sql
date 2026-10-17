-- Migration: bound the waits on the roles the app actually runs as
-- (backend audit B-4, 2026-10-16)
--
-- MEASURED BEFORE (production, `pg_roles.rolconfig` — the only honest source; `pg_settings`
-- reports the psql session's role, which is `postgres`, not what a request runs as):
--
--     anon           statement_timeout = 3s
--     authenticated  statement_timeout = 8s
--     authenticator  statement_timeout = 8s, lock_timeout = 8s
--     service_role   (none)
--
-- and NO role carried idle_in_transaction_session_timeout.
--
-- WHY THAT MATTERS: `service_role` is what the order path runs as, and create_order_transactional
-- takes `FOR UPDATE` locks on product rows while it re-prices the cart. With no statement_timeout
-- and no lock_timeout on that role, a statement that stalls (a lock held by a dead-but-not-reaped
-- backend, a plan that goes wrong under load) is bounded only by the platform default, which is
-- unknown from here. The idle-in-transaction case is separate and worse: neither statement_timeout
-- (the statement already finished) nor lock_timeout (that bounds WAITING for a lock, not HOLDING
-- one) applies to a session that opens a transaction and goes quiet.
--
-- Values: all far longer than any real request — the slowest RPC measured in this repo is
-- create_order_transactional at ~87ms including the pooler round trip, and the whole HTTP budget
-- is seconds — so a legitimate transaction can never be cut short, while an abandoned one cannot
-- pin a product row indefinitely.
--
-- Rollback:
--   alter role service_role reset statement_timeout;
--   alter role service_role reset lock_timeout;
--   alter role authenticated reset idle_in_transaction_session_timeout;
--   alter role anon reset idle_in_transaction_session_timeout;
--   alter role service_role reset idle_in_transaction_session_timeout;

alter role service_role set statement_timeout = '15s';
alter role service_role set lock_timeout = '8s';

alter role authenticated set idle_in_transaction_session_timeout = '30s';
alter role anon set idle_in_transaction_session_timeout = '30s';
alter role service_role set idle_in_transaction_session_timeout = '30s';
