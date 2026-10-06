import Link from 'next/link';
// الرسمي للنصوص الطويلة: thmanyah serif text — its own CSS file, so this ~105KB is only
// downloaded by whoever opens a legal page, never by the app or the customer menu.
import '@/app/fonts/thmanyah-text.css';

/**
 * Shared legal-page shell (Arabic, RTL) for /terms and /privacy.
 * Static server components — no data, no auth, indexable.
 */
export function LegalPage({
  title,
  updatedAt,
  sections,
}: {
  title: string;
  updatedAt: string;
  sections: { heading: string; body: string[] }[];
}) {
  return (
    <div className="landing-shell min-h-dvh">
      <header className="landing-nav sticky top-0 z-[var(--z-sticky)] border-b border-white/70">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-bold">
              د
            </span>
            <span className="text-base font-bold">دكان</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/terms" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
              الشروط
            </Link>
            <Link href="/privacy" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
              الخصوصية
            </Link>
            <Link href="/login" className="btn btn-ghost btn-sm">
              دخول
            </Link>
          </nav>
        </div>
      </header>

      <main className="legal-prose mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-extrabold text-[var(--color-text)]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--color-text-tertiary)]">آخر تحديث: {updatedAt}</p>

        <div className="card card-body mt-6 space-y-6">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-base font-bold text-[var(--color-text)]">{s.heading}</h2>
              {s.body.map((p, i) => (
                <p key={i} className="mt-2 text-[15px] leading-7 text-[var(--color-text-secondary)]">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-[var(--color-text-tertiary)]">
          هذه الصفحة جزء من منصة دكان — dokanstore.xyz
        </p>
      </main>
    </div>
  );
}
