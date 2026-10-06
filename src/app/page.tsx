import Link from 'next/link';
import { DokanMark } from '@/components/brand/dokan-mark';
import {
  QrCode,
  ChefHat,
  ClipboardList,
  Store,
  Smartphone,
  Zap,
  CreditCard,
} from 'lucide-react';

// سنة الحقوق بتوقيت البحرين (خادم UTC قد يعرض 2026 بينما البحرين في 2027
// عند منتصف ليلة 31 ديسمبر — Intl مرة واحدة لا إعادة حساب في كل render)
const COPYRIGHT_YEAR = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  timeZone: 'Asia/Bahrain',
}).format(new Date());


const FEATURES = [
  {
    icon: QrCode,
    title: 'قائمة QR للطاولات',
    desc: 'كل طاولة لها رابط ورمز QR. العميل يطلب خلال ثوانٍ.',
  },
  {
    icon: ClipboardList,
    title: 'طلبات لحظية',
    desc: 'الطلبات تصل فوراً إلى لوحة الطلبات ونقطة البيع.',
  },
  {
    icon: ChefHat,
    title: 'شاشة مطبخ (KDS)',
    desc: 'شاشة مطبخ فاتحة عالية التباين، تميّز حالة كل طلب بلونها مع تنبيه صوتي للطلبات الجديدة.',
  },
  {
    icon: Smartphone,
    title: 'PWA قابل للتثبيت',
    desc: 'ثبّت التطبيق على الجوال أو التابلت بدون متجر.',
  },
  {
    icon: Store,
    title: 'متعدد الفروع',
    desc: 'إدارة الفروع والطاولات والمنتجات من مكان واحد.',
  },
  {
    icon: Zap,
    title: 'جاهز في 7 دقائق',
    desc: 'من التسجيل إلى أول طلب حقيقي في أقل من سبع دقائق.',
  },
] as const;

export default function LandingPage() {
  return (
    <div className="storefront landing-shell min-h-dvh">
      <header className="landing-nav sticky top-0 z-[var(--z-sticky)] border-b border-white/70">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <DokanMark className="h-9 w-9" />
            <span className="text-base font-bold">دكان</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost btn-sm">
              دخول
            </Link>
            <Link href="/register" className="btn btn-primary btn-sm">
              ابدأ مجاناً
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
          <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-start lg:text-start">
            <div className="flex-1">
              <p className="section-title mb-3">للمقاهي والمطاعم وعربات الطعام</p>
              <h1 className="landing-title mx-auto max-w-3xl font-extrabold text-[var(--color-text)] lg:mx-0">
                من التسجيل إلى أول طلب
                <br />
                <span className="landing-title-accent">في أقل من 7 دقائق</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[var(--color-text-secondary)] lg:mx-0">
                أنشئ متجرك، أضف منتجاتك، اطبع QR للطاولات، واستقبل الطلبات على
                شاشة المطبخ ونقطة البيع — بالعربية وRTL بالكامل.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <Link href="/register" className="btn btn-primary btn-lg">
                  إنشاء حساب — 14 يوم مجاناً
                </Link>
              </div>
            </div>
            <div className="hidden shrink-0 lg:block">
              <div className="relative mx-auto" style={{ width: '240px' }}>
                <div className="overflow-hidden rounded-[2.5rem] border-[6px] border-[var(--color-text)] bg-[var(--color-primary)] shadow-xl">
                  <div className="mx-auto mt-2 h-5 w-28 rounded-full bg-[var(--color-text)]" />
                  <div className="flex flex-col items-center justify-center px-4 pb-8 pt-6 text-center text-white">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white">
                      <DokanMark className="h-9 w-9" />
                    </div>
                    <p className="text-sm font-bold">دكان</p>
                    <p className="mt-1 text-[11.5px] text-white/60">قائمة طعامك في جوال الزبون</p>
                    <div className="mt-4 flex h-16 w-16 items-center justify-center rounded-lg bg-white/10">
                      <QrCode className="h-8 w-8 text-white/50" />
                    </div>
                    <p className="mt-2 text-[11.5px] text-white/40">امسح واطلب</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-white/80 bg-white/65">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="landing-feature card">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-1 text-sm font-bold">{f.title}</h3>
                  <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                    {f.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── E2: Pricing ── */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="text-center">
            <p className="section-title mb-2">الأسعار</p>
            <h2 className="mb-4 text-2xl font-extrabold text-[var(--color-text)]">
              باقة واحدة بسيطة
            </h2>
            <p className="mx-auto mb-10 max-w-lg text-sm leading-relaxed text-[var(--color-text-secondary)]">
              لا رسوم خفية. لا عقود. ابدأ مجاناً وادفع لما تكون جاهز.
            </p>
          </div>

          <div className="mx-auto max-w-sm">
            <div className="overflow-hidden rounded-[var(--radius-xl)] border-2 border-[var(--color-primary)] bg-[var(--color-surface)] shadow-lg">
              <div className="bg-[var(--color-primary)] px-6 py-5 text-center text-white">
                <CreditCard className="mx-auto mb-2 h-6 w-6 text-white/70" />
                <h3 className="text-lg font-bold">باقة دكان</h3>
                <p className="mt-1 text-sm text-white/70">كل شي تحتاجه لإدارة مطعمك</p>
              </div>

              <div className="px-6 py-6 text-center">
                <div className="mb-1 flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-extrabold text-[var(--color-text)]" dir="ltr">7</span>
                  <span className="text-lg font-semibold text-[var(--color-text-secondary)]">د.ب</span>
                  <span className="text-sm text-[var(--color-text-muted)]">/ شهرياً</span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">بعد 14 يوم تجربة مجانية كاملة</p>

                <ul className="mt-6 space-y-3 text-start text-sm">
                  {[
                    'قائمة QR غير محدودة',
                    'شاشة مطبخ (KDS)',
                    'نقطة بيع (POS)',
                    'لوحة تحكم كاملة',
                    'دعم فني عبر تيليقرام',
                    'طلبات غير محدودة',
                    'بدون عمولة على الطلبات',
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                      <span className="text-[var(--color-primary)]">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>

                <Link href="/register" className="btn btn-primary btn-lg mt-7 w-full">
                  ابدأ تجربتك المجانية
                </Link>
                <p className="mt-3 text-[11.5px] text-[var(--color-text-tertiary)]">
                  لا حاجة لبطاقة ائتمان. 14 يوم مجاناً كاملة.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-text-muted)]">
        © {COPYRIGHT_YEAR} دكان — منصة طلبات للمؤسسات الصغيرة
        <div className="mt-2 flex items-center justify-center gap-4">
          <Link href="/terms" className="underline-offset-4 hover:underline">
            الشروط والأحكام
          </Link>
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            سياسة الخصوصية
          </Link>
        </div>
      </footer>
    </div>
  );
}
