'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type State = 'loading' | 'unsupported' | 'denied' | 'inactive' | 'subscribed';

export function PushNotificationManager({
  projectId,
}: {
  projectId: string;
}) {
  const [state, setState] = useState<State>('loading');
  const [swReg, setSwReg] = useState<ServiceWorkerRegistration | null>(null);
  const [sub, setSub] = useState<PushSubscription | null>(null);

  // Detect current state on mount
  useEffect(() => {
    (async () => {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        setState('unsupported');
        return;
      }

      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        setSwReg(reg);

        // Check for existing subscription
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          setSub(existing);
          setState('subscribed');
        } else if (Notification.permission === 'denied') {
          setState('denied');
        } else {
          setState('inactive');
        }
      } catch {
        setState('unsupported');
      }
    })();
  }, []);

  const subscribe = useCallback(async () => {
    if (!swReg) return;

    try {
      setState('loading');

      // Request permission if needed
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState('denied');
          toast.error('تم رفض الإشعارات — غيّر الإعدادات من المتصفح');
          return;
        }
      }

      if (Notification.permission !== 'granted') {
        setState('denied');
        return;
      }

      if (!VAPID_PUBLIC_KEY) {
        toast.error('مفاتيح الإشعارات غير مضبوطة — راجع الإعدادات');
        setState('inactive');
        return;
      }

      // Subscribe to push
      const subscription = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
      });

      // Save to server
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          subscription: subscription.toJSON(),
        }),
      });

      if (!res.ok) {
        throw new Error('Server rejected subscription');
      }

      setSub(subscription);
      setState('subscribed');
      toast.success('🔔 الإشعارات مفعّلة — سنخبرك عند وصول طلب جديد');
    } catch (err) {
      console.error('[Push] Subscribe failed', err);
      toast.error('فشل تفعيل الإشعارات');
      setState('inactive');
    }
  }, [swReg, projectId]);

  const unsubscribe = useCallback(async () => {
    if (!sub || !swReg) return;

    try {
      setState('loading');

      // Remove from server
      const res = await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      if (!res.ok) {
        throw new Error('Server rejected unsubscribe');
      }

      // Unsubscribe from browser
      await sub.unsubscribe();
      setSub(null);
      setState('inactive');
      toast.success('تم إيقاف الإشعارات');
    } catch (err) {
      console.error('[Push] Unsubscribe failed', err);
      toast.error('فشل إيقاف الإشعارات');
      setState('subscribed');
    }
  }, [sub, swReg]);

  const isActive = state === 'subscribed';

  return (
    <div className="card card-body">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${
            isActive
              ? 'bg-[var(--color-success-tint)] text-[var(--color-success)]'
              : state === 'denied'
                ? 'bg-[var(--color-danger-tint)] text-[var(--color-danger)]'
                : 'bg-[var(--color-primary-tint)] text-[var(--color-primary)]'
          }`}
        >
          {state === 'loading' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isActive ? (
            <Bell className="h-5 w-5" />
          ) : (
            <BellOff className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold">
            {isActive
              ? '🔔 الإشعارات مفعّلة'
              : state === 'denied'
                ? '⚠️ الإشعارات محظورة'
                : 'إشعارات المتصفح'}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            {isActive
              ? 'سيصلك إشعار حتى لو المتصفح مقفول عند وصول طلب جديد'
              : state === 'unsupported'
                ? 'المتصفح هذا ما يدعم الإشعارات'
                : state === 'denied'
                  ? 'سمحت لمتصفحك بحظر الإشعارات. غيّر الإعدادات من المتصفح.'
                  : 'فعّل الإشعارات عشان يجيك تنبيه عند وصول طلب جديد — حتى لو الموقع مقفول'}
          </p>
        </div>
        <div className="shrink-0">
          {state === 'loading' ? (
            <Button variant="secondary" size="sm" disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
            </Button>
          ) : isActive ? (
            <Button variant="secondary" size="sm" className="min-h-11" onClick={unsubscribe}>
              إيقاف
            </Button>
          ) : state === 'inactive' || state === 'denied' ? (
            <Button size="sm" className="min-h-11" onClick={subscribe}>
              تفعيل
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Convert a base64url string to Uint8Array for the applicationServerKey */
function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData.split('').map((c) => c.charCodeAt(0)));
}
