'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      {/* global-error REPLACES the root layout, so it inherits neither the viewport meta nor the
          theme colour from metadata: without these the error page can render zoomed-out and with
          a browser-chrome colour that does not match the product (audit T1 #16). */}
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#FAF9F6" />
      </head>
      <body
        style={{
          fontFamily: "'Cairo', sans-serif",
          display: 'flex',
          minHeight: '100dvh',
          alignItems: 'center',
          justifyContent: 'center',
          // audit T1 #16: these were cool slate (#F8FAFC/#0F172A) while every token in the
          // product is warm (#FAF9F6/#1F2320). global-error replaces the root layout, so it
          // cannot read the tokens - the values are duplicated ON PURPOSE, and they must stay
          // equal to the tokens in globals.css.
          background: '#FAF9F6',
          color: '#1F2320',
          padding: 16,
          textAlign: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            حدث خطأ غير متوقع
          </h1>
          <p style={{ color: '#6B6F68', fontSize: 14, marginBottom: 16 }}>
            حاول إعادة تحميل الصفحة.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#4F46E5',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '10px 16px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
