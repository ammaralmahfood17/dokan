'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Database,
  WifiOff,
  ShieldAlert,
  RefreshCw,
  Bug,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from 'lucide-react';
import { categorizeError, persistErrorLog, type ErrorDetails } from '@/lib/error-categories';

function ErrorIcon({ details }: { details: ErrorDetails }) {
  switch (details.icon) {
    case 'database': return <Database className="h-5 w-5 text-[var(--color-danger)]" />;
    case 'network': return <WifiOff className="h-5 w-5 text-[var(--color-danger)]" />;
    case 'auth': return <ShieldAlert className="h-5 w-5 text-[var(--color-danger)]" />;
    default: return <AlertTriangle className="h-5 w-5 text-[var(--color-danger)]" />;
  }
}

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const details = useMemo(() => categorizeError(error), [error]);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  // Log error for diagnostics (best-effort) after the error UI has rendered.
  useEffect(() => {
    persistErrorLog(error, details);
  }, [error, details]);

  // AR-8: تنظيف الـ timeout المرتبط بحالة "copied" — إن أُنجز النسخ مرة أخرى
  // أو أُزال المكوّن قبل انتهاء الـ 2ث، نلغي المؤقت السابق (لا تسريب).
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  function handleCopyLog() {
    const textToCopy = `[دكان — سجل الخطأ]
التصنيف: ${details.badgeText}
الوقت: ${new Date().toISOString()}
الرسالة: ${error.message}
التفاصيل: ${error.stack || 'غير متوفرة'}`;

    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
    }).catch(() => {});
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)] p-4 font-sans" dir="rtl">
      {/* FIX-A-002: إعلان الخطأ لقارئ الشاشة فور ظهوره */}
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 sm:p-8">
        {/* audit T1 #14: role="alert" used to wrap the retry button and the details accordion,
            so their labels were re-announced on every update and the announcement was unusable.
            The assertion now sits in its own live region, outside the interactive content. */}
        <p role="alert" aria-live="assertive" className="sr-only">
          {details.title}
        </p>
        {/* Header Badge & Title */}
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-danger-tint)] text-[var(--color-danger)]">
            <ErrorIcon details={details} />
          </div>
          <div className="min-w-0">
            <span className="mb-1 inline-block rounded-full border border-[var(--color-danger)]/20 bg-[var(--color-danger-tint)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-danger)]">
              {details.badgeText}
            </span>
            <h2 className="text-base font-bold leading-snug text-[var(--color-text)]">
              {details.title}
            </h2>
          </div>
        </div>

        {/* User-friendly message */}
        <div className="mb-4 space-y-2 rounded-xl bg-[var(--color-bg)] p-4">
          <p className="text-xs font-semibold leading-relaxed text-[var(--color-text)]">
            {details.userMessage}
          </p>
          <p className="text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
            💡 <span className="font-semibold">توجيه:</span> {details.recommendation}
          </p>
        </div>

        {/* Technical Accordion */}
        <div className="mb-5">
          <button
            type="button"
            onClick={() => setShowDetails((s) => !s)}
            aria-expanded={showDetails}
            aria-controls="error-details"
            className="flex w-full items-center justify-between rounded-lg bg-[var(--color-surface-sunken)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border)]/60 hover:text-[var(--color-text)]"
          >
            <span className="flex items-center gap-1.5">
              <Bug className="h-3.5 w-3.5" />
              <span>سجل التفاصيل الفنية (للمطورين)</span>
            </span>
            {showDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showDetails && (
            <div
              id="error-details"
              className="mt-2 space-y-2 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-[11px] font-mono text-[var(--color-text-secondary)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span>الوقت: {new Date().toISOString()}</span>
                <button
                  type="button"
                  onClick={handleCopyLog}
                  className="flex items-center gap-1 font-sans text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-[var(--color-success)]" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  <span>{copied ? 'تم النسخ' : 'نسخ السجل'}</span>
                </button>
              </div>
              <p className="break-all font-semibold text-[var(--color-danger)]">
                {error.message || 'لا توجد رسالة نصية للخطأ'}
              </p>
              {error.stack && (
                <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-[10px] leading-tight text-[var(--color-text-muted)]">
                  {error.stack}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" />
            <span>إعادة تحميل التطبيق والمحاولة</span>
          </button>
        </div>
      </div>
    </div>
  );
}
