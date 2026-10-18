'use client';

import { useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type ChannelResult = { sent: number; failed: number };
type TestResult = { telegram: ChannelResult; push: ChannelResult };

/**
 * «اختبار الإشعارات» — one button, two numbers.
 *
 * The question «هل الإشعارات تشتغل؟» cannot be answered from the settings screen: a channel with
 * no linked destination looks identical to a broken one. This POSTs /api/notifications/test,
 * which fans out through the SAME recipient filter as a real order and answers
 * `{telegram:{sent,failed}, push:{sent,failed}}` — `sent: 0` means "nothing is linked", which is
 * the actionable answer, not an error.
 */
export function NotificationsTest({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json().catch(() => null)) as TestResult | { error?: string } | null;
      if (!res.ok || !data || 'error' in data) {
        toast.error((data as { error?: string } | null)?.error || 'تعذّر إرسال التنبيه');
        return;
      }
      setResult(data as TestResult);
      toast.success('أرسلنا التنبيه — تحقق من جوالك');
    } catch {
      toast.error('تعذّر إرسال التنبيه — تحقق من الاتصال');
    } finally {
      setBusy(false);
    }
  }

  const nothingLinked = result && result.telegram.sent === 0 && result.push.sent === 0;

  return (
    <section className="card card-body" aria-labelledby="notifications-test-title">
      <h2 id="notifications-test-title" className="mb-1 flex items-center gap-2 text-base font-bold">
        <BellRing className="h-4 w-4" aria-hidden="true" />
        اختبار الإشعارات
      </h2>
      <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
        يرسل تنبيهًا تجريبيًا عبر تيليجرام وإشعارات المتصفح، بنفس طريقة تنبيه الطلب الحقيقي.
      </p>

      <Button type="button" onClick={() => void send()} disabled={busy} className="min-h-11">
        {busy ? (
          <>
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
            جاري الإرسال…
          </>
        ) : (
          'إرسال تنبيه تجريبي'
        )}
      </Button>

      {result && (
        <p role="status" className="mt-3 text-sm leading-6" dir="rtl">
          تيليجرام: أُرسل {result.telegram.sent}
          {result.telegram.failed > 0 ? ` · فشل ${result.telegram.failed}` : ''} · المتصفح: أُرسل{' '}
          {result.push.sent}
          {result.push.failed > 0 ? ` · فشل ${result.push.failed}` : ''}
          {nothingLinked && (
            <span className="mt-1 block text-[var(--color-warn)]">
              ما فيه أي وجهة مربوطة — اربط تيليجرام أو فعّل إشعارات المتصفح أولًا.
            </span>
          )}
        </p>
      )}
    </section>
  );
}
