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
  const allOrders: unknown[] = [];
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
    allOrders.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Open «طلب موظف / طلب فاتورة» rows — staff-facing, so the RLS policy on
  // service_requests (project members) is the boundary; this client is the
  // signed-in staff session, not the service role.
  const { data: serviceRequests } = await supabase
    .from('service_requests')
    .select('id,type,created_at,table_id,tables(number)')
    .eq('project_id', ctx.project.id)
    .eq('is_resolved', false)
    .order('created_at', { ascending: true });

  return (
    <KitchenClient
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      initialOrders={
        allOrders as (Order & {
          tables?: { number: number } | null;
          order_items?: OrderItem[];
        })[]
      }
      initialServiceRequests={(serviceRequests ?? []) as unknown as ServiceRequestRow[]}
    />
  );
}
