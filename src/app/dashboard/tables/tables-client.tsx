'use client';

import { FormEvent, useState, useCallback, useEffect, useRef } from 'react';
import { Plus, Copy, ExternalLink, Printer, Trash2, LayoutGrid, List, Clock } from 'lucide-react';
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
import { FloorPlan } from '@/components/dashboard/floor-plan';
import { TableSessionDrawer } from '@/components/dashboard/table-session-drawer';
import { usePostgresSubscription } from '@/lib/realtime/use-postgres-subscription';
import { OCCUPANCY_LABEL, tableState, type TableOccupancy } from '@/lib/floor-plan';
import { formatMoney } from '@/lib/utils';
import type { Table, TableBoardRow } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type TableRow = Table;

/** Pill colour per occupancy — one map, so list and floor cannot disagree. */
function stateTone(state: TableOccupancy): string {
  return state === 'busy'
    ? 'bg-[var(--color-primary-tint)] text-[var(--color-primary)]'
    : state === 'awaiting_bill'
      ? 'bg-[var(--color-warn-tint)] text-[var(--color-warn)]'
      : state === 'inactive'
        ? 'bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]'
        : 'bg-[var(--color-success-tint)] text-[var(--color-success)]';
}

export function TablesClient({
  projectId,
  projectSlug,
  siteUrl,
  initialTables,
  initialBoard,
  currency,
  canManage,
  qrReprintedAt,
}: {
  projectId: string;
  projectSlug: string;
  siteUrl: string;
  initialTables: Table[];
  /** table_board() — occupancy + running totals, computed server-side. */
  initialBoard: TableBoardRow[];
  currency: string;
  /** staff run the floor and close sessions; table/QR editing stays owner+manager. */
  canManage: boolean;
  /** projects.qr_reprinted_at — NULL means the merchant has not dealt with the reprint yet. */
  qrReprintedAt: string | null;
}) {
  const router = useRouter();
  const [tables, setTables] = useState(initialTables);
  const [board, setBoard] = useState<TableBoardRow[]>(initialBoard);
  const [view, setView] = useState<'floor' | 'list'>('floor');
  // Mount timestamp: the «أُغلق آليًا» marker is relative to NOW, and reading the
  // clock during render is both a hydration mismatch (React #418) and impure.
  const [mountedAt, setMountedAt] = useState<number | null>(null);
  const [activeRow, setActiveRow] = useState<TableBoardRow | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setMountedAt(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);

  const boardByTable = new Map(board.map((r) => [r.table_id, r]));
  const stateByTable = new Map(board.map((r) => [r.table_id, tableState(r)]));

  /**
   * Re-read from the RPC, never recompute in the browser: these are money
   * totals and `table_board()` is the one place that sums them.
   */
  const loadBoard = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('table_board', { p_project_id: projectId });
    if (error) return;
    const next = (data ?? []) as TableBoardRow[];
    setBoard(next);
    setActiveRow((prev) =>
      prev ? (next.find((r) => r.table_id === prev.table_id) ?? null) : null
    );
  }, [projectId]);

  const scheduleBoard = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    // One QR order emits an order row and a session row; 400ms coalesces them
    // into one board read instead of one per row.
    reloadTimer.current = setTimeout(() => {
      void loadBoard();
    }, 400);
  }, [loadBoard]);

  usePostgresSubscription('table-board', [
    { table: 'table_sessions', event: '*', handler: scheduleBoard },
    { table: 'orders', event: '*', handler: scheduleBoard },
  ]);
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
        color: { dark: '#1F2320', light: '#FFFFFF' },
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
          color: { dark: '#1F2320', light: '#FFFFFF' },
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
          /* F-15: this window is a bare document with none of the app's CSS, so the palette is
             written as literals — the SHIPPED ones (ink --color-text #1F2320, secondary
             --color-text-secondary #6B6F68, border-strong composited on white #E1E1DF). It used to
             carry the retired slate set (#0F172A/#E2E8F0/#475569) while the product is warm. */
          body { font-family: system-ui, sans-serif; padding: 20px; background: #fff; }
          h1 { font-size: 18px; color: #1F2320; margin-bottom: 16px; text-align: center; }
          .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
          .card { border: 1px solid #E1E1DF; border-radius: 8px; padding: 12px; text-align: center; break-inside: avoid; }
          .card img { width: 160px; height: 160px; margin: 0 auto 8px; display: block; }
          .card .label { font-weight: 700; font-size: 14px; color: #1F2320; }
          .card .slug { font-size: 11px; color: #6B6F68; direction: ltr; }
          /* 15 tables in a 3-column grid spilled one row onto a second A4 page —
             a lone card on its own sheet. Four columns at print time (with a
             130px code, still ~34mm) fits them on one page. */
          @media print {
            body { padding: 8px; }
            .grid { grid-template-columns: repeat(4, 1fr); gap: 10px; }
            .card { padding: 8px; }
            .card img { width: 130px; height: 130px; }
          }
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
        <div className={`flex gap-2 ${canManage ? '' : 'hidden'}`}>
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

      {/* Two lenses on the same objects: the floor is what a shift uses, the
          list is where QR codes and table CRUD live. The floor is the default. */}
      <div className="mb-4 inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
        <button
          type="button"
          onClick={() => setView('floor')}
          aria-pressed={view === 'floor'}
          className={`flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-label ${
            view === 'floor'
              ? 'bg-[var(--color-primary-tint)] text-[var(--color-primary)]'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          <LayoutGrid className="h-4 w-4" />
          مخطط الصالة
        </button>
        <button
          type="button"
          onClick={() => setView('list')}
          aria-pressed={view === 'list'}
          className={`flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-label ${
            view === 'list'
              ? 'bg-[var(--color-primary-tint)] text-[var(--color-primary)]'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          <List className="h-4 w-4" />
          الطاولات و QR
        </button>
      </div>

      {view === 'floor' ? (
        <FloorPlan
          projectId={projectId}
          tables={tables}
          board={board}
          onOpen={setActiveRow}
          onChanged={() => void loadBoard()}
        />
      ) : (
        <>
      {/* Only a store that already has tables can be holding old printed sheets. A brand-new
          store used to see «أعد طباعة رموز QR» before it had ever created one — nonsense on the
          first screen a merchant opens. */}
      {canManage && !reprinted && tables.length > 0 && (
        <QrReprintBanner onDismiss={() => void markReprinted()} />
      )}

      {/* D2: رابط المتجر — يشاركه التاجر مع زبائنه (يفتح صفحة المتجر العامة) */}
      <section className={`mb-6 ${canManage ? '' : 'hidden'}`}>
        <p className="section-title">رابط المتجر</p>
        <div className="dashboard-card card flex flex-wrap items-center gap-3 px-4 py-3">
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
            {canManage && (
              <Button onClick={openCreateModal}>
                أضف أول طاولة
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {/* Two columns on a desktop: a full-width row left ~700px of empty
                card beside the actions once they moved next to the identity. */}
            {tables.map((t) => {
              // Audit T2 #1: the copyable link must carry the scan token too, otherwise the
              // merchant copies a link that cannot complete an order once enforcement is on.
              const path = menuPath(projectSlug, t.slug, t.qrcode);
              const url = `${siteUrl}${path}`;
              return (
                <div
                  key={t.id}
                  /* Actions sit NEXT to the table's identity: justify-between put
                     them ~800px away on a 1440 screen (measured), so the eye
                     crossed the whole row for every table (audit 2026-10-22). */
                  className="dashboard-card card flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold">طاولة {t.number}</p>
                      <span className={`rounded-full px-2 py-0.5 text-caption font-bold ${stateTone(stateByTable.get(t.id) ?? 'free')}`}>
                        {OCCUPANCY_LABEL[stateByTable.get(t.id) ?? 'free']}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      <span dir="ltr">{t.slug}</span>
                      {(boardByTable.get(t.id)?.total_amount ?? 0) > 0 ? (
                        <span className="ms-2 font-semibold text-[var(--color-text)]" dir="ltr">
                          {formatMoney(boardByTable.get(t.id)!.total_amount, currency)}
                        </span>
                      ) : null}
                    </p>
                    {mountedAt !== null &&
                    !boardByTable.get(t.id)?.session_id &&
                    boardByTable.get(t.id)?.last_closed_automatically &&
                    boardByTable.get(t.id)?.last_closed_at &&
                    mountedAt - Date.parse(boardByTable.get(t.id)!.last_closed_at!) < 24 * 3600e3 ? (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-caption text-[var(--color-text-secondary)]">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        أُغلق آليًا
                      </span>
                    ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1">
                    <Button
                      variant={boardByTable.get(t.id)?.session_id ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => {
                        const row = boardByTable.get(t.id);
                        if (row) setActiveRow(row);
                      }}
                    >
                      الجلسة
                    </Button>
                    {canManage && (
                    <>
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
                    </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
          </section>
        </>
      )}
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
      {activeRow && (
        <TableSessionDrawer
          row={activeRow}
          currency={currency}
          onClose={() => setActiveRow(null)}
          onChanged={() => void loadBoard()}
        />
      )}
    </div>
  );
}
