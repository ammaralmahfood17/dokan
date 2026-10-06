-- ESTIKANA RESTORE (2026-09-28)
--
-- WHY THIS FILE EXISTS: while probing Supabase realtime for a "new order does
-- not appear instantly" report, a cleanup query was written with `?q` instead
-- of `?slug=` — PostgREST ignored the unknown param, returned EVERY project,
-- and the delete loop removed the real merchant store `estikana`. The FKs are
-- all ON DELETE CASCADE, so its tables/products/categories/staff_members went
-- with it. Orders and order_items were already 0, so no order history was
-- lost, and no storage objects existed.
--
-- RECONSTRUCTION SOURCES (both are real records, not invention):
--   1. dokan-v2 skill HEALTH line 2026-09-28: "estikana active (sub
--      2027-10-23, 7 products)", plus OPERATIONAL 2026-09-24 giving the
--      project id, created_by, and subscription expiry.
--   2. e2e/merchant-lifecycle.spec.ts:383 pins the table slugs to exactly
--      ['table-1','table-2'].
--   3. The stale Vercel ISR render of /estikana/menu/table-1, captured in
--      this session BEFORE the cache expired, listed the categories and every
--      product name + price verbatim.
--
-- HONEST CAVEAT: category membership per product and the `description`
-- values are NOT recoverable — the cached render listed names and prices
-- only. Product↔category here follows the menu's rendered order within each
-- group. Prices are exact (0.100 / 0.200). Product and table ids are NEW
-- uuids; nothing referenced them.
--
-- The `projects` row was restored separately by its ORIGINAL id before this
-- file ran, so every FK below points at the real row.

BEGIN;

-- Owner membership. admin@estikana.com owns the store (projects.created_by).
INSERT INTO public.staff_members (project_id, user_id, role)
VALUES ('9520304f-6489-4301-bd97-a5fa708246b2',
        '5a966ac8-ef3d-4ac5-a29b-cadbcfc3712e', 'owner')
ON CONFLICT DO NOTHING;

-- Two active tables (slugs pinned by e2e/merchant-lifecycle.spec.ts:383).
-- qrcode is regenerated per row by the column DEFAULT in 0000_init.sql, so
-- these are real scannable codes rather than a placeholder.
INSERT INTO public.tables (project_id, number, slug, is_active)
VALUES
  ('9520304f-6489-4301-bd97-a5fa708246b2', 1, 'table-1', true),
  ('9520304f-6489-4301-bd97-a5fa708246b2', 2, 'table-2', true);

-- Categories in the order the menu rendered them.
INSERT INTO public.categories (project_id, name, name_en, sort_order)
VALUES
  ('9520304f-6489-4301-bd97-a5fa708246b2', 'مشروبات باردة', 'Cold Drinks', 1),
  ('9520304f-6489-4301-bd97-a5fa708246b2', 'مشروبات ساخنه', 'Hot Drinks',   2),
  ('9520304f-6489-4301-bd97-a5fa708246b2', 'أصناف',          'Snacks',       3);

-- Products: name + price are verbatim from the captured render.
INSERT INTO public.products (project_id, category_id, name, name_en, price, is_available, sort_order)
SELECT '9520304f-6489-4301-bd97-a5fa708246b2', c.id, p.name, p.name_en, p.price, true, p.ord
FROM (VALUES
  ('مشروبات باردة', 'شاي أحمر',    'Red Tea',        0.100, 1),
  ('مشروبات باردة', 'شاي كرك',     'Karak Tea',      0.100, 2),
  ('مشروبات باردة', 'شاي لومي',    'Loomi Tea',      0.100, 3),
  ('مشروبات ساخنه', 'كستر',        'Kestar',         0.200, 4),
  ('مشروبات ساخنه', 'كستر فستق',   'Pistar',         0.200, 5),
  ('أصناف',         'مهلبية عيش',   'Mahalabia',      0.200, 6),
  ('أصناف',         'كستر شعيرية', 'Kestar Noodles', 0.200, 7)
) AS p(cat, name, name_en, price, ord)
JOIN public.categories c
  ON c.project_id = '9520304f-6489-4301-bd97-a5fa708246b2' AND c.name = p.cat;

COMMIT;
