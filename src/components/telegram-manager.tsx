'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send, Loader2, Link2, Trash2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

type LinkedChat = {
  id: string;
  chat_id: string;
  kind: 'user' | 'group';
  label: string | null;
};

type PendingLink = {
  code: string;
  bot_username: string;
  url: string;
};

export function TelegramManager({ projectId }: { projectId: string }) {
  const [links, setLinks] = useState<LinkedChat[] | null>(null);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [generating, setGenerating] = useState(false);

  const loadLinks = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('telegram_links')
      .select('id, chat_id, kind, label')
      .eq('project_id', projectId)
      .order('created_at');
    if (!error) setLinks((data as LinkedChat[]) || []);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('telegram_links')
        .select('id, chat_id, kind, label')
        .eq('project_id', projectId)
        .order('created_at');
      if (!error && !cancelled) setLinks((data as LinkedChat[]) || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function generateLink() {
    setGenerating(true);
    try {
      const res = await fetch('/api/telegram/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as PendingLink & { error?: string };
      if (!res.ok || !data.code) {
        toast.error(data.error || 'فشل إنشاء الرابط');
        return;
      }
      setPending(data);
    } catch {
      toast.error('تعذّر الاتصال');
    } finally {
      setGenerating(false);
    }
  }

  async function removeLink(chatId: string) {
    // Fix: try/catch — فشل الشبكة كان يرمي unhandled rejection بلا رسالة
    try {
      const res = await fetch('/api/telegram/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, chatId }),
      });
      if (!res.ok) {
        toast.error('فشل الإزالة');
        return;
      }
      toast.success('تم إلغاء الربط');
      loadLinks();
    } catch {
      toast.error('تعذّر الاتصال');
    }
  }

  const isConfigured = links !== null;

  return (
    <div className="card card-body">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-info-tint)] text-[var(--color-info)]">
          <Send className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold">تنبيهات تيليجرام</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            يوصلك تنبيه لكل طلب جديد على تيليجرام — حتى لو الموقع مقفول، بدون أي رسوم
          </p>
        </div>
      </div>

      {links && links.length > 0 && (
        <ul className="mt-3 space-y-2">
          {links.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-success)]" />
                <span className="truncate font-semibold" dir="auto">
                  {l.label || (l.kind === 'group' ? 'مجموعة' : 'حساب تيليجرام')}
                </span>
                <span className="shrink-0 rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
                  {l.kind === 'group' ? 'مجموعة' : 'حساب'}
                </span>
              </span>
              <button
                type="button"
                aria-label="إلغاء الربط"
                onClick={() => removeLink(l.chat_id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!pending ? (
        <Button className="mt-3" size="sm" onClick={generateLink} disabled={generating}>
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          {links && links.length > 0 ? 'ربط جهاز/مجموعة إضافية' : 'ربط تيليجرام'}
        </Button>
      ) : (
        <div className="mt-3 rounded-[10px] border border-sky-200 bg-sky-50 p-3">
          <p className="text-xs font-bold text-[var(--color-info)]">١. افتح تيليجرام واضغط الرابط:</p>
          <a
            href={pending.url}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="mt-1 block truncate rounded-[var(--radius-md)] bg-white px-3 py-2 text-center text-sm font-bold text-[var(--color-info)] underline"
          >
            {pending.url}
          </a>
          <p className="mt-2 text-xs font-bold text-[var(--color-info)]">٢. أو أرسل للبوت هذا الرمز:</p>
          <p dir="ltr" className="mt-1 rounded-[var(--radius-md)] bg-white px-3 py-2 text-center font-mono text-sm font-bold">
            /start {pending.code}
          </p>
          <p className="mt-2 text-xs text-[var(--color-info)]">
            الرمز صالح لمدة 15 دقيقة. بعد ما ترسله، اضغط:
          </p>
          <Button className="mt-2" variant="secondary" size="sm" onClick={loadLinks}>
            <RefreshCw className="h-4 w-4" />
            تحقق من الربط
          </Button>
        </div>
      )}

      {pending && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {isConfigured ? 'لإلغاء، اضغط «تحقق من الربط» ثم احذف من القائمة.' : ''}
        </p>
      )}
    </div>
  );
}
