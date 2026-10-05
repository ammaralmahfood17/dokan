// D1: Setup checklist section — extracted from dashboard/page.tsx.
import Link from 'next/link';
import { Check, ChevronLeft } from 'lucide-react';

type ChecklistItem = { id: string; label: string; href: string; done: boolean };

export function ChecklistSection({
  checklist,
  doneCount,
  allDone,
}: {
  checklist: ChecklistItem[];
  doneCount: number;
  allDone: boolean;
}) {
  if (allDone) {
    return (
      <section className="mb-8 card card-body text-center">
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-success-tint)] text-[var(--color-success)]">
            <Check className="h-6 w-6" />
          </div>
          <h2 className="text-base font-bold">متجرك جاهز لإستقبال الطلبات</h2>
          <Link
            href="/dashboard/pos"
            className="mt-2 inline-flex min-h-[44px] items-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-6 text-sm font-bold text-white transition-colors hover:opacity-90"
          >
            افتح POS
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[15px] font-bold">قائمة الإعداد</h2>
        <span dir="ltr" className="text-xs font-semibold text-[var(--color-text-secondary)]">
          {doneCount} / {checklist.length}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="تقدم قائمة الإعداد"
        aria-valuemin={0}
        aria-valuemax={checklist.length}
        aria-valuenow={doneCount}
        className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]"
      >
        <div
          className="h-full rounded-full bg-[var(--color-primary)] transition-all"
          style={{ width: `${(doneCount / checklist.length) * 100}%` }}
        />
      </div>
      <div className="space-y-2">
        {checklist.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`checklist-item ${item.done ? 'done' : 'checklist-item-pulse'}`}
          >
            <span className={`check-dot ${item.done ? 'done' : ''}`}>
              {item.done && <Check className="h-3 w-3" />}
            </span>
            <span
              className={`flex-1 text-sm font-semibold ${
                item.done
                  ? 'text-[var(--color-text-secondary)] line-through'
                  : 'text-[var(--color-text)]'
              }`}
            >
              {item.label}
            </span>
            <ChevronLeft className="h-4 w-4 text-[var(--color-text-muted)]" />
          </Link>
        ))}
      </div>
    </section>
  );
}
