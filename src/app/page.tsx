import Link from 'next/link';
import Image from 'next/image';
import { DokanMark } from '@/components/brand/dokan-mark';
import {
  QrCode,
  ChefHat,
  ClipboardList,
  Store,
  Smartphone,
  Zap,
  CreditCard,
  MessageCircle,
  ExternalLink,
} from 'lucide-react';
import { SUPPORT_WHATSAPP_URL, SIGNUP_WHATSAPP_URL } from '@/lib/support';

/** A real, publicly readable menu. Browse-only (a table token is required to order). */
const DEMO_MENU = '/estikana/menu/table-1';

/** F-18: rendered per request so the proxy's CSP nonce reaches this page. */
export const dynamic = 'force-dynamic';
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
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <DokanMark className="h-9 w-9" />
            <span className="text-base font-bold">دكان</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost btn-sm">
              دخول
            </Link>
            <a
              href={SIGNUP_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
            >
              اطلب متجرك
            </a>
          </div>
        </div>
      </header>
      <main>
        <section className="landing-hero mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
          <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-start lg:text-start">
            <div className="flex-1">
              <p className="section-title mb-3">للمقاهي والمطاعم وعربات الطعام</p>
              <h1 className="landing-title mx-auto max-w-3xl font-extrabold text-[var(--color-text)] lg:mx-0">
                {'من التسجيل إلى أول طلب '}
                <br />
                <span className="landing-title-accent">في أقل من 7 دقائق</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[var(--color-text-secondary)] lg:mx-0">
                أنشئ متجرك، أضف منتجاتك، اطبع QR للطاولات، واستقبل الطلبات على
                شاشة المطبخ ونقطة البيع — بالعربية وRTL بالكامل.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <a
                  href={SIGNUP_WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-lg"
                >
                  <MessageCircle className="h-4 w-4" />
                  اطلب متجرك — 14 يوم مجاناً
                </a>
                <Link href={DEMO_MENU} className="btn btn-secondary btn-lg">
                  <ExternalLink className="h-4 w-4" />
                  شاهد قائمة حقيقية
                </Link>
              </div>
            </div>
            <div className="hidden shrink-0 lg:block">
              <div className="relative mx-auto" style={{ width: '250px' }}>
                <div className="overflow-hidden rounded-[2.5rem] border-[6px] border-[var(--color-text)] bg-[var(--color-surface)] shadow-xl">
                  <div className="mx-auto my-2 h-5 w-28 rounded-full bg-[var(--color-text)]" />
                  {/* A real menu from a live store — the screenshot is the proof, not an illustration. */}
                  <Image
                    src="/demo/menu.png"
                    alt="قائمة QR حقيقية لمتجر على دكان"
                    width={390}
                    height={844}
                    sizes="250px"
                    className="h-[430px] w-full object-cover object-top"
                    priority
                  />
                </div>
                <p className="mt-3 text-center text-[11.5px] text-[var(--color-text-muted)]">
                  قائمة حقيقية — جرّبها بنفسك
                </p>
              </div>
            </div>
          </div>
        </section>
        {/* F-11: one vertical rhythm for the landing — content sections carry py-16/sm:py-20 on
            the CONTAINER (the bordered strip below puts it on its inner grid so the border stays
            tight to the content), and the hero is allowed exactly one step more. Measured before
            the change: hero 112 · strip 56 · pricing 80 at >=640px. */}
        <section className="border-y border-white/80 bg-white/65">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:grid-cols-2 sm:py-20 lg:grid-cols-3">
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

        {/* Proof — a live menu, not a mockup. The rest of the landing is words; this is the
            one section a sceptical owner can verify in ten seconds on their own phone. */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="section-title mb-2">شاهد المنتج</p>
              <h2 className="text-2xl font-extrabold text-[var(--color-text)]">
                قائمة حقيقية، لا لقطات تصميم
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-7 text-[var(--color-text-secondary)]">
                هذه قائمة متجر يعمل على دكان الآن. افتحها من جوالك، أو راسلنا على واتساب ونرتب
                لك عرضاً مباشراً على متجرك أنت.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={DEMO_MENU} className="btn btn-primary btn-lg">
                  <ExternalLink className="h-4 w-4" />
                  افتح القائمة
                </Link>
                <a
                  href={SUPPORT_WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-lg"
                >
                  <MessageCircle className="h-4 w-4" />
                  واتساب الدعم
                </a>
              </div>
              <p className="mt-3 text-[11.5px] text-[var(--color-text-muted)]" dir="ltr">
                +973 3689 7959
              </p>
            </div>
            <div className="mx-auto w-full max-w-[300px]">
              <div className="overflow-hidden rounded-[2rem] border-[6px] border-[var(--color-text)] bg-[var(--color-surface)] shadow-xl">
                <Image
                  src="/demo/menu.png"
                  alt="لقطة من قائمة عميل حقيقية على دكان"
                  width={390}
                  height={844}
                  sizes="300px"
                  className="h-[520px] w-full object-cover object-top"
                />
              </div>
            </div>
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
              لا رسوم خفية. لا عقود. جرّب 14 يوماً كاملة وادفع لما تكون جاهز.
            </p>
          </div>
          <div className="mx-auto max-w-sm">
            <div className="overflow-hidden rounded-[var(--radius-xl)] border-2 border-[var(--color-primary)] bg-[var(--color-surface)] shadow-lg">
              <div className="bg-[var(--color-primary)] px-6 py-5 text-center text-white">
                <CreditCard className="mx-auto mb-2 h-6 w-6 text-white/90" />
                <h3 className="text-lg font-bold">باقة دكان</h3>
                <p className="mt-1 text-sm text-white/90">كل شي تحتاجه لإدارة مطعمك</p>
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
                <a
                  href={SIGNUP_WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-lg mt-7 w-full"
                >
                  <MessageCircle className="h-4 w-4" />
                  اطلب تجربتك المجانية
                </a>
                <p className="mt-3 text-[11.5px] text-[var(--color-text-tertiary)]">
                  نفتح لك الحساب ونجهّزه معك — بلا بطاقة ائتمان.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-text-muted)]">
        © {COPYRIGHT_YEAR} دكان — منصة طلبات للمؤسسات الصغيرة
        <div className="mt-2 flex items-center justify-center gap-4">
          <Link
            href="/terms"
            className="inline-flex min-h-[44px] items-center underline-offset-4 hover:underline"
          >
            الشروط والأحكام
          </Link>
          <Link
            href="/privacy"
            className="inline-flex min-h-[44px] items-center underline-offset-4 hover:underline"
          >
            سياسة الخصوصية
          </Link>
          <a
            href={SUPPORT_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center underline-offset-4 hover:underline"
          >
            واتساب
          </a>
        </div>
      </footer>
    </div>
  );
}
