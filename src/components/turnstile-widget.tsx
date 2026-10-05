'use client';

import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile widget — owner decisions 7 + 8 (2026-10 audit remediation).
 *
 * Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is present, which keeps local dev and CI
 * working without a Cloudflare account; the server takes the same decision independently
 * (src/lib/turnstile.ts), so neither side can drift into "captcha skipped" on its own.
 *
 * Explicit rendering (not the implicit `.cf-turnstile` class) so the token lands in React
 * state and can be cleared when it expires.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      remove: (id: string) => void;
      reset: (id?: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function TurnstileWidget({
  onToken,
  onExpire,
}: {
  onToken: (token: string) => void;
  /** Called when the token expires or the widget errors: the caller must clear its token. */
  onExpire: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Callbacks live in refs so a parent re-render never tears the widget down mid-challenge.
  // They are refreshed in an effect, not during render: writing a ref while rendering is what
  // react-hooks/refs (and the React Compiler) reject.
  const onTokenRef = useRef(onToken);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onTokenRef.current = onToken;
    onExpireRef.current = onExpire;
  }, [onToken, onExpire]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;

    function renderWidget() {
      if (cancelled || widgetIdRef.current) return;
      if (!window.turnstile || !containerRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        language: 'ar',
        // Turnstile picks managed/interactive by itself; 'auto' matches the app theme.
        theme: 'auto',
        callback: (token: string) => onTokenRef.current(token),
        'expired-callback': () => onExpireRef.current(),
        'error-callback': () => onExpireRef.current(),
      });
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (existing) {
      // Script already loaded (client-side navigation): render straight away.
      renderWidget();
    } else {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = 'true';
      script.addEventListener('load', renderWidget);
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        window.turnstile.remove(id);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <div
      ref={containerRef}
      className="flex min-h-[65px] justify-center"
      // The widget is a third-party iframe; the label is what a screen reader announces.
      aria-label="التحقق الأمني"
    />
  );
}
