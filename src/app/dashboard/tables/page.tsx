import { requireCurrentProjectRole } from '@/lib/project';
import { getSiteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/server';
import { TablesClient } from './tables-client';
import type { Table } from '@/lib/types';

export default async function TablesPage() {
  const ctx = await requireCurrentProjectRole(['owner', 'manager']);

  const supabase = await createClient();
  const { data: tables } = await supabase
    .from('tables')
    .select('*')
    .eq('project_id', ctx.project.id)
    .order('number');

  // Which tables have ACTIVE orders right now (pending/preparing/ready)?
  // Shown as a مشغولة/متاحة chip on each table card.
  const { data: activeOrders } = await supabase
    .from('orders')
    .select('table_id')
    .eq('project_id', ctx.project.id)
    .is('service_type', null)
    .not('table_id', 'is', null)
    .in('status', ['pending', 'preparing', 'ready']);
  const occupiedTableIds = new Set(
    (activeOrders ?? []).map((o) => o.table_id).filter(Boolean)
  );

  const siteUrl = getSiteUrl();

  return (
    <TablesClient
      projectId={ctx.project.id}
      projectSlug={ctx.project.slug}
      siteUrl={siteUrl}
      initialTables={(tables ?? []) as Table[]}
      occupiedTableIds={occupiedTableIds}
      qrReprintedAt={ctx.project.qr_reprinted_at ?? null}
    />
  );
}
