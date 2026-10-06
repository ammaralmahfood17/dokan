-- Re-arm the «طلب موظف / طلب فاتورة» surface.
--
-- The customer menu has always had the two buttons; their routes were deleted
-- in b3aab0c as "unused" and the buttons then silently 404'd. They are back
-- (POST /api/public/waiter|bill) and now write a real `service_requests` row
-- instead of a zero-amount order, with the kitchen board as the staff surface.
--
-- Two gaps in the base schema (0000_init.sql) block that:
--
--  1. `service_requests` is NOT in the realtime publication, so the board would
--     only ever see a request on its fallback poll — a customer could wait two
--     minutes for someone to notice. `orders` and `order_items` are already
--     published; this adds the third live table.
--
--  2. The base ACL ends at `GRANT SELECT` for `authenticated` (0000_init.sql
--     revokes the blanket ALL it had just granted). Staff must be able to mark a
--     request handled — `UPDATE ... SET is_resolved = true` — and a read-only
--     grant would fail at the RLS boundary with a permission error, not a
--     policy rejection. The RLS policy `service_requests_staff` already confines
--     every write to project members (is_project_member), so widening the grant
--     does not widen who can touch a row.
--
-- Both statements are additive and idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'service_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_requests;
  END IF;
END $$;

-- Staff (RLS-scoped to their own project) read, create and resolve requests.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_requests TO authenticated;
-- The public routes write with the service role; it bypasses RLS but still
-- needs the table privilege.
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_requests TO service_role;
