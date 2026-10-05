import Link from 'next/link';

export default function SubscriptionExpiredPage() {
  return (
    <div className="storefront flex min-h-dvh items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-2xl">
          ⏰
        </div>
        <h1 className="text-lg font-bold text-[var(--color-text)]">انتهى الاشتراك</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          اشتراك هذا المتجر انتهى. تواصل مع إدارة دكان لتجديد الاشتراك واستعادة
          الوصول إلى لوحة التحكم والطلبات.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex w-full items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
        >
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}
