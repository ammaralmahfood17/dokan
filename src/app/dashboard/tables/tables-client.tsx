'use client';

import { FormEvent, useState, useCallback } from 'react';
import { Plus, Copy, ExternalLink, Printer, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  generateQrToken,
  menuPath,
  tableSlugFromNumber,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { QrReprintBanner } from '@/components/dashboard/qr-reprint-banner';
import type { Table } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type TableRow = Table;

export function TablesClient({
  projectId,
  projectSlug,
  siteUrl,
  initialTables,
  occupiedTableIds,
  qrReprintedAt,
}: {
  projectId: string;
  projectSlug: string;
  siteUrl: string;
  initialTables: Table[];
  occupiedTableIds: Set<string>;
  /** projects.qr_reprinted_at — NULL means the merchant has not dealt with the reprint yet. */
  qrReprintedAt: string | null;
}) {
  const router = useRouter();
  const [tables, setTables] = useState(initialTables);
  // Owner decision 1: the reprint banner persists per project. Set on print (the real act)
  // and on dismiss (the escape hatch), so it never comes back on another device.
  const [reprinted, setReprinted] = useState(Boolean(qrReprintedAt));

  const markReprinted = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('projects')
      .update({ qr_reprinted_at: new Date().toISOString() })
      .eq('id', projectId)
      .select('id');
    if (error || !data?.length) {
      // RLS on projects is owner-only; a manager's update matches zero rows. Say so instead
      // of pretending the reminder was acknowledged.
      toast.error('ما قدرنا نحفظ — اطلب من صاحب المتجر يفتح هذي الصفحة');
      return;
    }
    setReprinted(true);
  }, [projectId]);
  const [showTable, setShowTable] = useState(false);
  const [qrPreview, setQrPreview] = useState<{
    url: string;
    dataUrl: string;
    label: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Table | null>(null);

  const refresh = useCallback(async () => { router.refresh(); }, [router]);

  const [tableNumber, setTableNumber] = useState('1');
  const [tableSlug, setTableSlug] = useState('table-1');

  // Prefill the modal with the smallest available table number (reuses freed
  // numbers after a delete), and derive the default slug from it.
  function openCreateModal() {
    const used = new Set(tables.map((t) => t.number));
    let next = 1;
    while (used.has(next) && next <= 999) next++;
    if (next > 999) next = 1; // all 1..999 used — fall back to 1, insert will reject
    setTableNumber(String(next));
    setTableSlug(tableSlugFromNumber(next));
    setShowTable(true);
  }

  async function createTable(e: FormEvent) {
    e.preventDefault();
    const number = Number(tableNumber);
    // Normalize + validate the slug: lowercase, spaces→dashes, [a-z0-9-] only.
    // Unvalidated slugs (Arabic, uppercase, "/") break the menu URL (case-sensitive
    // route → QR 404) and would be interpolated unescaped into the print window HTML.
    const rawSlug = tableSlug.trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9-]{1,60}$/.test(rawSlug)) {
      toast.error('المعرّف يجب أن يكون أحرف إنجليزية وأرقام وشرطات فقط');
      return;
    }
    const slug = rawSlug || tableSlugFromNumber(number);
    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase
      .from('tables')
      .insert({
        project_id: projectId,
        number,
        slug,
        qrcode: generateQrToken(),
        is_active: true,
      })
      .select('*')
      .single();
    setLoading(false);
    if (error || !data) {
      toast.error(error?.message?.includes('unique') ? 'المعرّف مستخدم' : 'فشل إنشاء الطاولة');
      return;
    }
    setTables((prev) => [...prev, data as TableRow]);
    setShowTable(false);
    toast.success('تم إنشاء الطاولة مع QR');
    await showQr(data as Table);
    router.refresh();
  }

  async function showQr(table: Table) {
    // Audit T2 #1: the printed QR must carry the scan token, otherwise ordering by
    // slug alone is what let anyone inject orders into this store.
    const path = menuPath(projectSlug, table.slug, table.qrcode);
    const url = `${siteUrl}${path}`;
    try {
      // Lazy-load qrcode lib — keeps the tables page chunk small
      const QRCode = (await import('qrcode')).default;
      const dataUrl = await QRCode.toDataURL(url, {
        width: 280,
        margin: 2,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      });
      setQrPreview({
        url,
        dataUrl,
        label: `طاولة ${table.number}`,
      });
    } catch {
      toast.error('فشل توليد QR');
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('تم نسخ الرابط'))
      .catch(() => toast.error('تعذّر النسخ — انسخ الرابط يدويًا'));
  }

  async function printAllQrs() {
    // Printing IS the act the banner asks for — record it before the dialog even opens, so a
    // cancelled print dialog still counts as "dealt with" (the merchant has the sheet).
    void markReprinted();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('الرجاء السماح للنوافذ المنبثقة (popups)');
      return;
    }
    const qrPromises = tables.map(async (t) => {
      const path = menuPath(projectSlug, t.slug, t.qrcode);
      const url = `${siteUrl}${path}`;
      try {
        // Lazy-load qrcode lib (shared chunk with showQr)
        const QRCode = (await import('qrcode')).default;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 180,
          margin: 1,
          color: { dark: '#0F172A', light: '#FFFFFF' },
        });
        return { number: t.number, slug: t.slug, dataUrl, url };
      } catch {
        return null;
      }
    });

    const qrData = (await Promise.all(qrPromises)).filter(Boolean) as {
      number: number; slug: string; dataUrl: string; url: string
    }[];

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8">
        <title>QR الطاولات — ${projectSlug}</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 20px; background: #fff; }
          h1 { font-size: 18px; color: #0F172A; margin-bottom: 16px; text-align: center; }
          .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
          .card { border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px; text-align: center; break-inside: avoid; }
          .card img { width: 160px; height: 160px; margin: 0 auto 8px; display: block; }
          .card .label { font-weight: 700; font-size: 14px; color: #0F172A; }
          .card .slug { font-size: 11px; color: #475569; direction: ltr; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <h1>QR الطاولات — ${projectSlug}</h1>
        <div class="grid">
          ${qrData.map((q) => `
            <div class="card">
              <img src="${q.dataUrl}" alt="رمز QR لطاولة ${q.number}" />
              <div class="label">طاولة ${q.number}</div>
              <div class="slug">${q.slug}</div>
            </div>
          `).join('')}
        </div>
        <script>window.print(); window.close();</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  async function deleteTable(table: Table) {
    setLoading(true);
    const supabase = createClient();
    // Guard: a table with ACTIVE orders (pending/preparing/ready) cannot be
    // deleted — the kitchen/orders screens still reference it. Only
    // delivered/cancelled (or zero) orders allow deletion.
    const { count: activeOrders } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('table_id', table.id)
      .in('status', ['pending', 'preparing', 'ready']);
    if ((activeOrders ?? 0) > 0) {
      setLoading(false);
      setConfirmDelete(null);
      toast.error(`لا يمكن الحذف — ${activeOrders} طلب نشط على هذه الطاولة`);
      return;
    }
    const { error } = await supabase.from('tables').delete().eq('id', table.id).eq('project_id', projectId);
    setLoading(false);
    setConfirmDelete(null);
    if (error) { toast.error('فشل حذف الطاولة'); return; }
    setTables((prev) => prev.filter((t) => t.id !== table.id));
    toast.success('تم حذف الطاولة');
  }

  return (
    <div className="page">
      <PullToRefresh onRefresh={refresh}>
      <div className="page-header">
        <div>
          <h1>الطاولات و QR</h1>
          <p>الطاولات وروابط القوائم العامة</p>
        </div>
        <div className="flex gap-2">
          {tables.length > 0 && (
            <Button variant="secondary" size="sm" onClick={printAllQrs}>
              <Printer className="h-4 w-4" />
              طباعة QR
            </Button>
          )}
          <Button size="sm" onClick={openCreateModal}>
            <Plus className="h-4 w-4" />
            طاولة جديدة
          </Button>
        </div>
      </div>

      {!reprinted && <QrReprintBanner onDismiss={() => void markReprinted()} />}

      {/* D2: رابط المتجر — يشاركه التاجر مع زبائنه (يفتح صفحة المتجر العامة) */}
      <section className="mb-6">
        <p className="section-title">رابط المتجر</p>
        <div className="dashboard-card card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-[var(--color-text-secondary)]" dir="ltr">
            {siteUrl}/{projectSlug}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copyUrl(`${siteUrl}/${projectSlug}`)}
          >
            <Copy className="h-3.5 w-3.5" />
            نسخ الرابط
          </Button>
        </div>
      </section>

      <section>
        <p className="section-title">الطاولات</p>
        {!tables.length ? (
          <div className="card empty">
            <h3>ما فيه طاولات بعد</h3>
            <p className="mb-4 text-sm">أضف أول طاولة عشان تولّد QR ويقدر العملاء يطلبون.</p>
            <Button onClick={openCreateModal}>
              أضف أول طاولة
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {tables.map((t) => {
              // Audit T2 #1: the copyable link must carry the scan token too, otherwise the
              // merchant copies a link that cannot complete an order once enforcement is on.
              const path = menuPath(projectSlug, t.slug, t.qrcode);
              const url = `${siteUrl}${path}`;
              return (
                <div
                  key={t.id}
                  className="dashboard-card card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold">طاولة {t.number}</p>
                      {occupiedTableIds.has(t.id) ? (
                        <span className="rounded-full bg-[var(--color-warn-tint)] px-2 py-0.5 text-[11.5px] font-bold text-[var(--color-warn)]">
                          مشغولة
                        </span>
                      ) : (
                        <span className="rounded-full bg-[var(--color-success-tint)] px-2 py-0.5 text-[11.5px] font-bold text-[var(--color-success)]">
                          متاحة
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      <span dir="ltr">{t.slug}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => showQr(t)}
                    >
                      عرض QR
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyUrl(url)}
                      aria-label="نسخ رابط المنيو"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <a
                      href={path}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="فتح المنيو في تبويب جديد"
                      className="btn btn-ghost btn-sm"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(t)}
                      aria-label="حذف الطاولة"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--color-danger)]" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </PullToRefresh>

      {/* Create Table Modal — sibling of PullToRefresh */}
      {showTable && (
        <Modal title="طاولة جديدة" onClose={() => setShowTable(false)}>
          <form onSubmit={createTable}>
            <div className="field">
              <label htmlFor="table-number" className="label">رقم الطاولة</label>
              <input
                id="table-number"
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                required
                dir="ltr"
                value={tableNumber}
                onChange={(e) => {
                  const value = e.target.value;
                  setTableNumber(value);
                  const number = Number(value);
                  if (Number.isFinite(number) && number > 0 && number <= 999) {
                    setTableSlug(tableSlugFromNumber(number));
                  }
                }}
              />
              <p className="hint">رقم الطاولة بين 1 و 999</p>
            </div>
            <div className="field">
              <label htmlFor="table-slug" className="label">معرّف الرابط (slug)</label>
              <input
                id="table-slug"
                className="input"
                required
                maxLength={60}
                dir="ltr"
                value={tableSlug}
                onChange={(e) => setTableSlug(e.target.value)}
              />
              <p className="hint">
                /{projectSlug}/menu/{tableSlug || '…'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="submit" block disabled={loading}>
                إنشاء + توليد QR
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowTable(false)}>
                إلغاء
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* QR Preview Modal — sibling of PullToRefresh */}
      {qrPreview && (
        <Modal title={`QR — ${qrPreview.label}`} onClose={() => setQrPreview(null)}>
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrPreview.dataUrl}
              alt="QR Code"
              className="mx-auto max-w-full rounded-[var(--radius-md)] border border-[var(--color-border)]"
            />
            <p className="mt-3 break-all text-xs text-[var(--color-text-secondary)]" dir="ltr">
              {qrPreview.url}
            </p>
            <div className="mt-4 flex gap-2">
              <Button block onClick={() => copyUrl(qrPreview.url)}>
                <Copy className="h-4 w-4" />
                نسخ الرابط
              </Button>
              <a
                href={qrPreview.dataUrl}
                download={`qr-${qrPreview.label}.png`}
                className="btn btn-secondary btn-block"
              >
                تحميل
              </a>
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="حذف الطاولة" onClose={() => setConfirmDelete(null)}>
          <div className="text-center">
            <div className="mb-3 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-tint)]">
              <Trash2 className="h-6 w-6 text-[var(--color-danger)]" />
            </div>
            <p className="mb-1 text-sm font-bold">طاولة {confirmDelete.number}</p>
            <p className="mb-5 text-xs text-[var(--color-text-secondary)]">
              هل أنت متأكد من حذف هذه الطاولة؟ الطلبات المرتبطة ستبقى.
              لا يمكن الحذف إذا كان عليها طلبات نشطة (قيد التحضير أو جاهزة).
            </p>
            <div className="flex gap-2">
              <Button variant="danger" block disabled={loading} onClick={() => deleteTable(confirmDelete)}>
                {loading ? 'جاري…' : 'نعم، احذف'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                إلغاء
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
