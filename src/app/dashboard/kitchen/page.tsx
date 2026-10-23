import { redirect } from 'next/navigation';
import { getCurrentProject } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import { KitchenClient } from './kitchen-client';
import type { Order, OrderItem } from '@/lib/types';
import type { ServiceRequestRow } from '@/components/dashboard/kitchen/use-kitchen-service-requests';

export default async function KitchenPage() {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');

  const supabase = await createClient();

  // Fetch ALL active tickets, paged (1000/page) — a plain limit(50) silently
  // dropped the OLDEST tickets on a busy shift, exactly the ones the cook
  // needs to see first. Matches the analytics collectOrders pattern.
  const PAGE = 1000;

  // The ticket pages and the open service requests are INDEPENDENT reads, so
  // they share one barrier. The paging loop stays sequential (page N decides
  // whether page N+1 exists), but waiting for it before asking for the service
  // requests added a whole round trip (~150ms) to every kitchen render.
  const [allOrders, serviceRequestsResult, notificationState] = await Promise.all([
    (async () => {
      const rows: unknown[] = [];
      let from = 0;
      for (;;) {
        const { data } = await supabase
          .from('orders')
          .select('*, tables(number), order_items(*)')
          .eq('project_id', ctx.project.id)
          .in('status', ['pending', 'preparing', 'ready'])
          .is('service_type', null)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return rows;
    })(),
    // Open «طلب موظف / طلب فاتورة» rows — staff-facing, so the RLS policy on
    // service_requests (project members) is the boundary; this client is the
    // signed-in staff session, not the service role.
    supabase
      .from('service_requests')
      .select('id,type,created_at,table_id,tables(number)')
      .eq('project_id', ctx.project.id)
      .eq('is_resolved', false)
      .order('created_at', { ascending: true }),
    // Alert wiring for the banner. Both counts are head-only, so this costs no rows:
    //   • telegram_links — project members may read it (RLS: is_project_member);
    //   • push_subscriptions — RLS is per-user, so this is THIS staff member's devices.
    (async () => {
      const [{ count: telegram }, { count: push }] = await Promise.all([
        supabase
          .from('telegram_links')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', ctx.project.id),
        supabase.from('push_subscriptions').select('*', { count: 'exact', head: true }),
      ]);
      return { telegramLinked: (telegram ?? 0) > 0, pushDevices: push ?? 0 };
    })(),
  ]);
  const serviceRequests = serviceRequestsResult.data;

  return (
    <KitchenClient
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      currency={ctx.project.currency}
      initialOrders={
        allOrders as (Order & {
          tables?: { number: number } | null;
          order_items?: OrderItem[];
        })[]
      }
      initialServiceRequests={(serviceRequests ?? []) as unknown as ServiceRequestRow[]}
      notificationState={notificationState}
    />
  );
}
