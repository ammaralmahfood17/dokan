'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Armchair } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { usePostgresSubscription } from '@/lib/realtime/use-postgres-subscription';
import { formatMoney } from '@/lib/utils';
import { minutesSince, occupiedLabel } from '@/lib/floor-plan';
import type { TableBoardRow } from '@/lib/types';

/**
 * «الصالة» strip on the kitchen board — READ ONLY.
 *
 * The kitchen needs one number it cannot get from a ticket list: how much money
 * is sitting on each busy table (several customers can order on the same table,
 * and each arrival is a separate ticket). Closing or collecting is a staff
 * action and deliberately absent here — the kitchen has no button that can free
 * a table.
 *
 * The numbers come from `table_board()`, never from summing tickets in the
 * browser: money has one source of truth.
 */
export function KitchenTablesStrip({
  projectId,
  currency,
  selected,
  onSelect,
}: {
  projectId: string;
  currency: string;
  selected: string | null;
  onSelect: (tableId: string | null) => void;
}) {
  const [rows, setRows] = useState<TableBoardRow[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('table_board', { p_project_id: projectId });
    if (!error && data) setRows(data as TableBoardRow[]);
  }, [projectId]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  // Durations must not be computed during render (server clock ≠ browser clock).
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 400);
  }, [load]);

  usePostgresSubscription('kitchen-tables', [
    { table: 'table_sessions', event: '*', handler: schedule },
    { table: 'orders', event: '*', handler: schedule },
  ]);

  const busy = rows.filter((r) => r.session_id);
  // Keep the strip mounted while a filter is active even if every table just
  // became free — otherwise the filter would keep hiding tickets with no
  // control left to clear it.
  if (busy.length === 0 && !selected) return null;

  const total = busy.reduce((sum, r) => sum + r.total_amount, 0);

  return (
    <section
      aria-label="طاولات الصالة"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
    >
      <span className="text-label font-bold text-[var(--color-text)]">الصالة</span>
      <span className="text-caption text-[var(--color-text-secondary)]">
        {busy.length} مشغولة · {formatMoney(total, currency)}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {busy.map((r) => {
          const active = selected === r.table_id;
          return (
            <button
              key={r.table_id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(active ? null : r.table_id)}
              className={`flex min-h-9 items-center gap-2 rounded-full border px-2.5 text-caption font-bold ${
                active
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                  : r.bill_requested_at
                    ? 'border-[var(--color-warn)] bg-[var(--color-warn-tint)] text-[var(--color-warn)]'
                    : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)]'
              }`}
            >
              <span dir="ltr">{String(r.number).padStart(2, '0')}</span>
              <span className="opacity-50" aria-hidden="true">·</span>
              <span dir="ltr">{r.total_amount.toFixed(3)}</span>
              {r.opened_at && now !== null ? (
                // The duration is the first thing to go on a phone: the strip
                // already carries a total per chip and the kitchen's question is
                // «how much», not «how long».
                <span className="hidden font-normal opacity-80 sm:inline">
                  {occupiedLabel(minutesSince(r.opened_at, now))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {selected && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="ms-auto flex min-h-9 items-center gap-1 rounded-full border border-[var(--color-border-strong)] px-2.5 text-caption text-[var(--color-text-secondary)]"
        >
          <Armchair className="h-3.5 w-3.5" />
          عرض كل الطاولات
        </button>
      )}
    </section>
  );
}
