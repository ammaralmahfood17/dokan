'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateSlug } from '@/lib/utils';
import { getSiteHost } from '@/lib/site-url';
import { CURRENCIES, DEFAULT_PRIMARY_COLOR } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { Store, Globe, Palette, Check } from 'lucide-react';

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [currency, setCurrency] = useState('BHD');
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const autoSlug = useMemo(() => generateSlug(name), [name]);

  const effectiveSlug = slugTouched ? slug : autoSlug;

  // Redirect if already has project or not logged in
  // Prefill name from full_name in signup metadata
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login?next=/onboarding');
        return;
      }

      const metaFullName = (user.user_metadata?.full_name as string) || '';
      const emailLocal = user.email ? user.email.split('@')[0] : '';
      setName((currentName) => currentName || metaFullName || emailLocal || 'متجري');

      const { data: membership } = await supabase
        .from('staff_members')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (!cancelled) {
        if (membership) {
          router.replace('/dashboard');
        } else {
          setChecking(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/onboarding/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug.trim(),
          currency,
          primaryColor,
        }),
      });
      const data = (await res.json()) as { error?: string; redirect?: string };

      if (!res.ok) {
        if (res.status === 409 && data.redirect) {
          router.push(data.redirect);
          return;
        }
        if (res.status === 409 && data.error?.includes('مستخدم')) {
          const newSlug = `${effectiveSlug}-${Math.random().toString(36).slice(2, 6)}`;
          setSlug(newSlug);
          setSlugTouched(true);
          setError('تم اقتراح معرّف جديد. حاول مرة أخرى.');
          setLoading(false);
          return;
        }
        setError(data.error || 'فشل إنشاء المتجر');
        setLoading(false);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-[var(--color-text-secondary)]">
        جاري التحميل…
      </div>
    );
  }

  return (
    <div className="storefront flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-4 py-10">
      <div className="w-full max-w-md">
        {/* Progress indicator */}
        <div className="mb-6">
          <p className="section-title">الخطوة {step} من 3</p>
          <div className="mt-2 flex gap-1.5">
            {([1, 2, 3] as const).map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s <= step ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
                }`}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/20 bg-[var(--color-danger-tint)] px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit}>
          {/* Step 1: Store Name + Slug */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-primary-tint)] text-[var(--color-primary)]"
                >
                  <Store className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">اسم المتجر</h1>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    اختر اسماً لمتجرك — سيظهر للعملاء في القائمة.
                  </p>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="name">اسم المتجر</label>
                <input
                  id="name"
                  className="input"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="مثال: مقهى النخلة"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="card card-body bg-[var(--color-bg)]">
                <p className="text-xs text-[var(--color-text-muted)]">معاينة الرابط:</p>
                <p className="mt-1 text-sm font-bold" dir="ltr">
                  {getSiteHost()}/menu/{effectiveSlug || '…'}/table-1
                </p>
              </div>

              {/* Live store preview */}
              {name.trim().length >= 2 && (
                <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] transition-all">
                  <div
                    className="flex items-center gap-2 px-4 py-3 text-white"
                    style={{ background: primaryColor }}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-white/20 text-sm font-bold">
                      {name.trim().slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{name.trim() || 'اسم المتجر'}</p>
                      <p className="text-[11px] text-white/80">طاولة 1</p>
                    </div>
                  </div>
                  <div className="flex gap-1 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <span className="rounded-full bg-[var(--color-primary-tint)] px-3 py-1 text-[10px] font-bold text-[var(--color-primary)]">الكل</span>
                    <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-[10px] font-bold text-[var(--color-text-secondary)]">مشروبات</span>
                    <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-[10px] font-bold text-[var(--color-text-secondary)]">طعام</span>
                  </div>
                  <div className="space-y-2 bg-[var(--color-surface)] p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 rounded-[6px] bg-[var(--color-bg)]" />
                      <div className="min-w-0 flex-1">
                        <div className="h-3 w-24 rounded bg-[var(--color-bg)]" />
                        <div className="mt-1 h-2 w-32 rounded bg-[var(--color-bg)]" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 rounded-[6px] bg-[var(--color-bg)]" />
                      <div className="min-w-0 flex-1">
                        <div className="h-3 w-20 rounded bg-[var(--color-bg)]" />
                        <div className="mt-1 h-2 w-28 rounded bg-[var(--color-bg)]" />
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2 text-center text-[11px] font-semibold" style={{ color: primaryColor }}>
                    معاينة حية — القائمة العامة
                  </div>
                </div>
              )}
              <Button
                type="button"
                block
                disabled={name.trim().length < 2}
                onClick={() => setStep(2)}
              >
                التالي
              </Button>
            </div>
          )}

          {/* Step 2: Slug + Currency */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">الرابط والعملة</h1>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    عدّل معرّف المتجر واختر عملتك.
                  </p>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="slug-step2">معرّف الرابط (slug)</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-text-muted)] shrink-0">/menu/</span>
                  <input
                    id="slug-step2"
                    className="input"
                    required
                    dir="ltr"
                    maxLength={60}
                    value={effectiveSlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                    }}
                  />
                </div>
                <p className="hint">
                  سيظهر في الرابط: /{effectiveSlug || '…'}/menu/table-1
                </p>
              </div>
              <div className="field">
                <label htmlFor="currency-step2" className="label">العملة</label>
                <select
                  id="currency-step2"
                  className="select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="brand-color" className="label">اللون الأساسي</label>
                <div className="flex items-center gap-3">
                  <input
                    id="brand-color"
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded border border-[var(--color-border)]"
                  />
                  <input
                    className="input flex-1"
                    dir="ltr"
                    value={primaryColor}
                    maxLength={7}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    pattern="^#[0-9A-Fa-f]{6}$"
                  />
                </div>
                <div
                  className="mt-3 h-12 rounded-[var(--radius-md)] flex items-center justify-center text-sm font-bold text-white transition-all"
                  style={{ background: primaryColor }}
                >
                  معاينة: رأس القائمة
                </div>
                <p className="hint">اختر لوناً يظهر في رأس القائمة للعملاء</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                  السابق
                </Button>
                <Button
                  type="button"
                  block
                  disabled={!effectiveSlug.trim()}
                  onClick={() => setStep(3)}
                >
                  التالي
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Summary + Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                  <Palette className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">تأكيد المتجر</h1>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    راجع بيانات متجرك قبل الإنشاء.
                  </p>
                </div>
              </div>
              <div className="card card-body space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--color-text-muted)]">الاسم</span>
                  <span className="text-sm font-bold">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--color-text-muted)]">الرابط</span>
                  <span className="text-sm font-bold" dir="ltr">{effectiveSlug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--color-text-muted)]">العملة</span>
                  <span className="text-sm font-bold">
                    {CURRENCIES.find((c) => c.value === currency)?.label || currency}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setStep(2)}>
                  السابق
                </Button>
                <Button
                  type="submit"
                  block
                  disabled={loading}
                >
                  {loading ? 'جاري الإنشاء…' : 'أنشئ متجرك الآن'}
                </Button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
