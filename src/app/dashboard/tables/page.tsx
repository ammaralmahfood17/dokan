import { requireCurrentProjectRole } from '@/lib/project';
import { getSiteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/server';
import { TablesClient } from './tables-client';
import type { Table, TableBoardRow } from '@/lib/types';

export default async function TablesPage() {
  // Staff included: closing a table is explicitly a staff action (owner decision
  // 2026-10-23). QR/table management stays owner/manager via `canManage`.
  const ctx = await requireCurrentProjectRole(['owner', 'manager', 'staff']);

  const supabase = await createClient();

  // TWO independent reads in ONE barrier. Both are keyed on the project id, so
  // awaiting them in sequence cost a full round trip (~150ms) for nothing —
  // every query costs the same regardless of shape, so the count that matters
  // is the number of SEQUENTIAL barriers (see ARCHITECTURE.md).
  const [{ data: tables }, { data: board }] = await Promise.all([
    supabase.from('tables').select('*').eq('project_id', ctx.project.id).order('number'),
    // Occupancy + running totals in ONE call. `table_board()` reads open
    // table_sessions (an explicit row), not order statuses — the kitchen
    // delivering the last order must not free the table.
    supabase.rpc('table_board', { p_project_id: ctx.project.id }),
  ]);

  const siteUrl = getSiteUrl();

  return (
    <TablesClient
      projectId={ctx.project.id}
      projectSlug={ctx.project.slug}
      siteUrl={siteUrl}
      initialTables={(tables ?? []) as Table[]}
      initialBoard={(board ?? []) as TableBoardRow[]}
      currency={ctx.project.currency}
      canManage={ctx.membership.role !== 'staff'}
      qrReprintedAt={ctx.project.qr_reprinted_at ?? null}
    />
  );
}
