'use client';

import { useState } from 'react';
import { toast } from 'sonner';

/**
 * "Login as" (Phase C) — super-admin support impersonation.
 * Calls the impersonate API (re-checks membership server-side), swaps the
 * auth session to the target owner's minted session, sets the marker cookie,
 * and lands on the target's dashboard. The persistent banner then shows on
 * every page until ended or the 30-min expiry.
 */
export function ImpersonateButton({
  ownerUserId,
  ownerEmail,
  projectId,
  projectName,
}: {
  ownerUserId: string | null;
  ownerEmail: string;
  projectId: string;
  projectName: string;
}) {
  const [busy, setBusy] = useState(false);

  if (!ownerUserId) return null;

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: ownerUserId, projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل بدء الجلسة');
        return;
      }
      // The API already wrote the SSR auth cookie (and the two support cookies) in this
      // response. Calling supabase.auth.setSession() here used to fail — supabase-js
      // validates the deliberately non-refreshable refresh token — so the browser stayed
      // an admin while the server thought the swap had happened.
      toast.success(`دخلت باسم ${ownerEmail}`);
      // Full navigation rebuilds the browser client with auto-refresh disabled
      // for support mode. SPA navigation would retain the pre-existing client.
      window.location.assign('/dashboard');
    } catch {
      toast.error('فشل بدء الجلسة');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      title={`الدخول كمستخدم: ${ownerEmail}`}
      className="btn btn-ghost btn-sm"
    >
      {busy ? '…' : 'دخول كمالك'}
    </button>
  );
}
