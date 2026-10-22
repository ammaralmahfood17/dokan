'use client';

// Orders list — the merchant's read-only view of the day's orders.
//
// Architecture review 2026-10-13 (wave 4): this file was 608 lines mixing the
// Bahrain day arithmetic, the filter/sort/search rules, four refresh cadences,
// paging and the whole list markup. It is now composition only:
//
//   lib/order-filters.ts                  the rules (pure, unit-tested)
//   components/dashboard/orders/
//     use-orders-feed.ts                  state, paging, realtime
//     orders-toolbar.tsx                  day nav + search + sort
//     orders-filter-chips.tsx             status chips with live counts
//     order-card.tsx                      one order
//
// Nothing about the behaviour changed — the comments that explain WHY (day
// boundary, hasMore, the header coming from a full-day read, the three refresh
// cadences) moved with the code they explain.
import { formatMoney } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useOrdersFeed, type OrderRow } from '@/components/dashboard/orders/use-orders-feed';
import { OrdersToolbar } from '@/components/dashboard/orders/orders-toolbar';
import { OrdersFilterChips } from '@/components/dashboard/orders/orders-filter-chips';
import { OrderCard } from '@/components/dashboard/orders/order-card';

export function OrdersClient({
  projectId,
  currency,
  initialOrders,
}: {
  projectId: string;
  currency: string;
  initialOrders: OrderRow[];
}) {
  const feed = useOrdersFeed({ projectId, initialOrders });

  return (
    <div className="page">
      <PullToRefresh onRefresh={() => void feed.refresh()}>
        <div className="page-header">
          <div>
            <h1>الطلبات</h1>
            <p>متابعة فقط · الحالة تتحدث من شاشة المطبخ</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p className="text-caption text-[var(--color-text-secondary)]">مبيعات اليوم</p>
            <p
              className="font-mono text-lg font-bold tabular-nums text-[var(--color-text)]"
              dir="ltr"
            >
              {formatMoney(feed.dayTotal, currency)}
            </p>
          </div>
        </div>

        {feed.realtimeOffline && (
          <div
            role="status"
            className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-danger)]/20 bg-[var(--color-danger-tint)] px-3 py-2 text-xs font-medium text-[var(--color-danger)]"
          >
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-danger)]" />
            انقطع الاتصال المباشر — يُحدَّث تلقائيًا كل 30 ثانية
          </div>
        )}

        <OrdersToolbar
          dateKey={feed.dateKey}
          isToday={feed.isToday}
          onSelectDate={feed.selectDate}
          onSelectDayOffset={feed.selectDayOffset}
          query={feed.query}
          onQueryChange={feed.setQuery}
          sortBy={feed.sortBy}
          onSortChange={feed.setSortBy}
        />

        <OrdersFilterChips
          filter={feed.filter}
          counts={feed.counts}
          onFilterChange={feed.setFilter}
        />

        {!feed.filtered.length ? (
          <EmptyState
            title="ما فيه طلبات في هذا اليوم"
            description={feed.isToday ? 'أول طلب بيظهر هنا مباشرة.' : 'جرب اختيار يوم آخر.'}
          />
        ) : (
          <div className="space-y-3">
            {feed.filtered.map((order) => (
              <OrderCard key={order.id} order={order} currency={currency} />
            ))}
          </div>
        )}

        {/* تحميل المزيد — صفحة تالية (50/صفحة).
            FIX-PAGE-003: gated on the RAW loaded span, never on `filtered`.
            Keying it on the filtered list made the button unreachable under any
            rare filter (12 «مسلّم» out of 100 → 12 < 50 → never renders), which
            silently capped the merchant at page 1 of that filter. */}
        {feed.hasMore && (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={() => void feed.loadMore()}
              disabled={feed.loadingMore}
              className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 text-sm font-bold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
            >
              {feed.loadingMore ? 'جاري التحميل…' : 'تحميل المزيد'}
            </button>
          </div>
        )}
      </PullToRefresh>
    </div>
  );
}
