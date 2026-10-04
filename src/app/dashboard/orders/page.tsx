import { redirect } from 'next/navigation';
import { getCurrentProject } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import { OrdersClient } from './orders-client';
import type { Order, OrderItem } from '@/lib/types';

export default async function OrdersPage() {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');

  const supabase = await createClient();

  // Filter: only real orders (not waiter/bill requests), today only.
  //
  // "Today" = Bahrain midnight (UTC+3) — the SAME business day the home
  // dashboard, the analytics page and the daily order numbering use. The
  // server clock is UTC, so a naive `new Date(); setHours(0,0,0,0)` started
  // the day at 03:00 Bahrain and dropped every order placed between 00:00 and
  // 03:00 local — exactly the window a late-night café trades in. The client
  // used to paper over the mismatch with a mount-time refetch in the browser's
  // local day (which is why this page could flash another day's orders before
  // settling); with the server on the same boundary there is nothing to paper
  // over, and the merchant sees the right day on first paint.
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bahrain',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const today = new Date(Date.parse(`${dayFmt.format(new Date())}T00:00:00+03:00`));

  // UX-report C1: a busy day silently truncated at 50 rows — day totals and
  // status counts were computed client-side from the first 50 orders only.
  // Paged loop per repo contract (1000/page); hard stop 5 pages (5000/day is
  // far beyond any Dokan merchant; client then shows what it got).
  const orders: NonNullable<Awaited<ReturnType<typeof fetchOrderPage>>> = [];
  for (let p = 0; p < 5; p++) {
    const page = await fetchOrderPage(supabase, ctx.project.id, today, p);
    if (!page) break;
    orders.push(...page);
    if (page.length < 1000) break;
  }

  async function fetchOrderPage(
    client: Awaited<ReturnType<typeof createClient>>,
    projectId: string,
    since: Date,
    pageIndex: number
  ) {
    const { data } = await client
      .from('orders')
      .select('*, tables(number, slug), order_items(*)')
      .eq('project_id', projectId)
      .is('service_type', null) // null = real order (not waiter/bill)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .range(pageIndex * 1000, pageIndex * 1000 + 999);
    return data;
  }

  return (
    <OrdersClient
      projectId={ctx.project.id}
      currency={ctx.project.currency}
      initialOrders={orders as unknown as (Order & {
        tables?: { number: number; slug: string } | null;
        order_items?: OrderItem[];
      })[]}
    />
  );
}
