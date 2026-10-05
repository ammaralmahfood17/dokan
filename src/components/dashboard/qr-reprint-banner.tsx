'use client';

/**
 * QR reprint banner — 2026-10 audit remediation, owner decision 1.
 *
 * The new table QR sheets carry the table's 128-bit scan token in `?k=`; the ones already
 * printed do not. Enforcement (`REQUIRE_TABLE_TOKEN`) stays OFF until tokenless orders have
 * been zero for 48h, so this banner is the merchant-facing half: it tells them to reprint
 * before the old sheets stop working, and it stays until they act.
 *
 * "Act" = printed at least once, or dismissed. Either way the flag is persisted per project
 * (`projects.qr_reprinted_at`), so it does not come back on another device.
 *
 * Purely presentational: the parent owns the flag and the write (RLS allows the update for
 * the project's owner only, and the parent reports a failed write honestly).
 */
export function QrReprintBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-warn)] bg-[var(--color-warn-tint)] px-4 py-3"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-warn)] text-[12px] font-bold text-white"
      >
        !
      </span>
      <p className="min-w-0 flex-1 text-[13px] font-semibold leading-6 text-[var(--color-warn)]">
        أعد طباعة رموز QR، الرموز القديمة لن تسمح بالطلب قريباً
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="إغلاق التنبيه"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-warn)] transition-colors hover:bg-[var(--color-surface)]/60"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
