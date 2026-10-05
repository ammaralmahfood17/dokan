'use client';

import { useCallback, useState } from 'react';

/**
 * "Resend the confirmation link" — amendment A5 (owner decision 3).
 *
 * Used in two places, which is why it is a component rather than inline JSX: the register
 * success screen ("the mail never arrived") and the login form when GoTrue answers
 * `email_not_confirmed`. The endpoint answers identically for every address, so the copy
 * here cannot be used to probe whether an account exists.
 */
export function ResendConfirmationButton({
  email,
  className = '',
}: {
  email: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const send = useCallback(async () => {
    setState('sending');
    setMessage(null);
    try {
      const res = await fetch('/api/auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;
      if (!res.ok) {
        setState('error');
        setMessage(json?.error ?? 'تعذر الإرسال، حاول بعد قليل.');
        return;
      }
      setState('sent');
      setMessage(json?.message ?? 'أرسلنا رابط التأكيد.');
    } catch {
      setState('error');
      setMessage('تعذر الإرسال، تحقق من الاتصال.');
    }
  }, [email]);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void send()}
        disabled={state === 'sending' || state === 'sent'}
        className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] px-3 text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline disabled:opacity-60"
      >
        {state === 'sending'
          ? 'جاري الإرسال…'
          : state === 'sent'
            ? 'أُرسل رابط التأكيد'
            : 'أعد إرسال رابط التأكيد'}
      </button>
      {message && (
        <p
          role="status"
          className={`mt-1 text-[13px] leading-6 ${
            state === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-secondary)]'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
