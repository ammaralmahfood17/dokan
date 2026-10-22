'use client';

// FIX-R-006: مؤشر بصري للسحب — arrow + "اسحب للتحديث" يظهران أثناء السحب
// (كان المكوّن صامتًا: المستخدم لا يعرف أنه يسحب).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';

export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
}: {
  onRefresh: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const startY = useRef(0);
  const pulling = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ pulling: boolean; distance: number }>({
    pulling: false,
    distance: 0,
  });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    const elNonNull = el; // narrowed for TypeScript closure

    function onTouchStart(e: TouchEvent) {
      // FIX(ux-report F5/B5): the scrolling element is often window/body, not
      // this container — el.scrollTop stays 0 and the pull hijacked mid-list.
      if (elNonNull.scrollTop <= 0 && window.scrollY <= 0) {
        startY.current = e.touches[0].clientY;
        pulling.current = true;
        setIndicator({ pulling: true, distance: 0 });
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!pulling.current) return;
      const dy = e.touches[0].clientY - startY.current;
      // FIX-R-006: تحديث المسافة للمؤشر أثناء السحب (بدون تجاوز 60px بصريًا)
      setIndicator({ pulling: true, distance: Math.min(dy, 60) });
      if (dy > 60) {
        pulling.current = false;
        setRefreshing(true);
        setIndicator({ pulling: false, distance: 0 });
        Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
      }
    }

    function onTouchEnd() {
      pulling.current = false;
      setIndicator({ pulling: false, distance: 0 });
    }

    elNonNull.addEventListener('touchstart', onTouchStart, { passive: true });
    elNonNull.addEventListener('touchmove', onTouchMove, { passive: true });
    elNonNull.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      elNonNull.removeEventListener('touchstart', onTouchStart);
      elNonNull.removeEventListener('touchmove', onTouchMove);
      elNonNull.removeEventListener('touchend', onTouchEnd);
    };
  }, [onRefresh, disabled]);

  const show = indicator.pulling || refreshing;

  return (
    <div ref={containerRef}>
      {/* FIX-R-006: مؤشر السحب — يظهر فوق المحتوى عند بدء السحب */}
      {show && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)]"
        >
          {refreshing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              جاري التحديث…
            </>
          ) : (
            <>
              <ArrowDown
                className={`h-4 w-4 transition-transform duration-[var(--motion-fast)] ${
                  indicator.distance >= 50 ? 'rotate-180' : ''
                }`}
                style={{ transform: `translateY(${indicator.distance * 0.5}px)` }}
              />
              اسحب للتحديث
            </>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
