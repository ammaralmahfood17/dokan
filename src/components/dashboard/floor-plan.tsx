'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Armchair, Download, GripVertical, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import type { Table, TableBoardRow } from '@/lib/types';
import { chipSubline, tableState, OCCUPANCY_LABEL } from '@/lib/floor-plan';
import { drawFloorPlan, planChips } from '@/lib/floor-plan-image';
import { toast } from 'sonner';

/**
 * «مخطط الصالة» — the visual floor plan, now DRIVEN BY SESSIONS.
 *
 * Restored from the 2026-10-13 build (reverted with that batch) and changed in
 * one place: occupancy used to be derived from active order statuses, so the
 * kitchen delivering the last order silently freed the table. Since migration
 * 20261023120000 the state comes from `table_board()`: an open table_session
 * means busy, `bill_requested_at` means awaiting bill, and only a staff close
 * makes a table free again.
 *
 * Coordinates stay on the 0..1000 abstract grid (`tables.pos_x/pos_y`), never
 * pixels: NULL = not placed yet, and the automatic layout is used until the
 * merchant drags a table. Position is DERIVED (drag override → stored → auto)
 * instead of mirrored into state — mirroring snaps a table back mid-drag on
 * every background refresh, and a synchronous setState in an effect is the
 * cascading render this repo's lint rejects.
 */

const GRID = 1000;
const CHIP_W = 18;
const CHIP_H = 13;

type Pos = { x: number; y: number };

function autoPositions(tables: Table[]): Map<string, Pos> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const rows = Math.max(1, Math.ceil(tables.length / cols));
  const out = new Map<string, Pos>();
  tables.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.set(t.id, {
      x: Math.round(((col + 0.5) / cols) * GRID),
      y: Math.round(((row + 0.5) / rows) * GRID),
    });
  });
  return out;
}

const clamp = (n: number) => Math.max(0, Math.min(GRID, Math.round(n)));

const CHIP_STYLE: Record<string, { background: string; border: string }> = {
  free: { background: 'var(--color-success-tint)', border: 'var(--color-success)' },
  busy: { background: 'var(--color-primary-tint)', border: 'var(--color-primary)' },
  awaiting_bill: { background: 'var(--color-warn-tint)', border: 'var(--color-warn)' },
  inactive: { background: 'var(--color-surface-sunken)', border: 'var(--color-border)' },
};

export function FloorPlan({
  projectId,
  tables,
  board,
  onOpen,
  onChanged,
}: {
  projectId: string;
  tables: Table[];
  board: TableBoardRow[];
  onOpen: (row: TableBoardRow) => void;
  onChanged: () => void;
}) {
  const [dragPositions, setDragPositions] = useState<Map<string, Pos>>(new Map());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  /**
   * The duration is computed AFTER mount, never during render: the server's
   * clock and the browser's differ, so rendering «12 د» on both sides is a
   * React #418 hydration mismatch (the same defect the kitchen board fixed).
   */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const canvasRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);
  /**
   * A tap is not a 0px gesture: a finger lands and rolls a pixel or two, and a
   * mouse click between down and up can emit a stray move. Treating ANY move as
   * a drag made the chip unopenable (measured: the drawer never opened in the
   * 2026-10-23 verification run). Four points is below a deliberate drag and
   * above hand jitter.
   */
  const downRef = useRef<{ x: number; y: number } | null>(null);

  const rows = useMemo(() => new Map(board.map((r) => [r.table_id, r])), [board]);
  const auto = useMemo(() => autoPositions(tables), [tables]);
  const stored = useMemo(() => {
    const m = new Map<string, Pos>();
    for (const t of tables) {
      if (t.pos_x != null && t.pos_y != null) m.set(t.id, { x: t.pos_x, y: t.pos_y });
    }
    return m;
  }, [tables]);

  const posOf = useCallback(
    (t: Table): Pos | undefined => dragPositions.get(t.id) ?? stored.get(t.id) ?? auto.get(t.id),
    [dragPositions, stored, auto]
  );

  const persist = useCallback(
    async (tableId: string, x: number, y: number) => {
      const supabase = createClient();
      const { error } = await supabase
        .from('tables')
        .update({ pos_x: x, pos_y: y })
        .eq('id', tableId)
        .eq('project_id', projectId);
      if (error) {
        toast.error('ما قدرنا نحفظ موضع الطاولة');
        return false;
      }
      return true;
    },
    [projectId]
  );

  // ---- drag -------------------------------------------------------------
  // Pointer events cover mouse + touch through one path; the chip sets
  // touch-action: none or the browser scrolls instead of delivering moves.
  function onPointerDown(e: React.PointerEvent, table: Table) {
    e.preventDefault();
    movedRef.current = false;
    downRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraggingId(table.id);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingId || !canvasRef.current) return;
    const down = downRef.current;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) movedRef.current = true;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clamp(((e.clientX - rect.left) / rect.width) * GRID);
    const y = clamp(((e.clientY - rect.top) / rect.height) * GRID);
    setDragPositions((prev) => new Map(prev).set(draggingId, { x, y }));
  }

  async function onPointerUp() {
    if (!draggingId) return;
    const id = draggingId;
    setDraggingId(null);
    const pos = dragPositions.get(id);
    if (!pos) return;
    const saved = await persist(id, pos.x, pos.y);
    if (!saved) {
      setDragPositions((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    onChanged();
  }

  // ---- keyboard ---------------------------------------------------------
  // The chip is a real button, so a keyboard user can reach it; arrows move it
  // by 2% of the grid and the write is committed on keyup so holding a key does
  // not fire one UPDATE per auto-repeat.
  const nudgeRef = useRef<{ id: string; x: number; y: number } | null>(null);

  function onTileKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, table: Table) {
    const STEP = 20;
    const delta: Record<string, { dx: number; dy: number }> = {
      ArrowUp: { dx: 0, dy: -STEP },
      ArrowDown: { dx: 0, dy: STEP },
      ArrowLeft: { dx: -STEP, dy: 0 },
      ArrowRight: { dx: STEP, dy: 0 },
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const current = dragPositions.get(table.id) ?? posOf(table);
    if (!current) return;
    const x = clamp(current.x + d.dx);
    const y = clamp(current.y + d.dy);
    setDragPositions((prev) => new Map(prev).set(table.id, { x, y }));
    nudgeRef.current = { id: table.id, x, y };
  }

  async function onTileKeyUp(e: React.KeyboardEvent<HTMLButtonElement>, table: Table) {
    if (!e.key.startsWith('Arrow')) return;
    const pending = nudgeRef.current;
    if (!pending || pending.id !== table.id) return;
    nudgeRef.current = null;
    const saved = await persist(pending.id, pending.x, pending.y);
    if (!saved) {
      setDragPositions((prev) => {
        const next = new Map(prev);
        next.delete(pending.id);
        return next;
      });
      return;
    }
    onChanged();
  }

  /**
   * «تنزيل المخطط» — what a merchant prints for the pass or sends to a new hire.
   * Drawn on a canvas from the SAME resolved positions and the SAME state/total
   * the screen is showing, so the paper cannot disagree with the screen.
   */
  async function exportPng() {
    setExporting(true);
    try {
      const W = 2000;
      const H = 1500;
      const PAD = 60;
      const TOP = 140;
      const BOTTOM = 80;

      const positions = new Map<string, { x: number; y: number }>();
      for (const t of tables) {
        const p = posOf(t);
        if (p) positions.set(t.id, p);
      }

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');

      const chips = planChips({
        tables: tables.map((t) => ({ id: t.id, number: t.number, seats: t.seats ?? null })),
        positions,
        stateOf: (id) => {
          const row = rows.get(id);
          return row ? tableState(row) : 'free';
        },
        subOf: (id) => {
          const row = rows.get(id);
          return row ? chipSubline(row, tableState(row), now ?? Date.now()) : null;
        },
        width: W,
        height: H,
        padding: PAD,
        topInset: TOP,
        bottomInset: BOTTOM,
      });

      drawFloorPlan(
        ctx,
        chips,
        { title: 'مخطط الصالة', subtitle: new Date().toLocaleDateString('ar-BH') },
        { width: W, height: H, padding: PAD, topInset: TOP, bottomInset: BOTTOM }
      );

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('toBlob returned null');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `floor-plan-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('نزّلنا المخطط');
    } catch (err) {
      console.error('[FloorPlan] export failed', err);
      toast.error('ما قدرنا نصدّر المخطط');
    } finally {
      setExporting(false);
    }
  }

  async function clearLayout() {
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('tables')
        .update({ pos_x: null, pos_y: null })
        .eq('project_id', projectId);
      if (error) {
        toast.error('ما قدرنا نرجع الترتيب التلقائي');
        return;
      }
      setDragPositions(new Map());
      toast.success('رجعنا الترتيب التلقائي');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!tables.length) {
    return (
      <div className="card empty">
        <h3>ما فيه طاولات بعد</h3>
        <p className="text-sm">أضف طاولات أول، وبعدين رتّبها على المخطط.</p>
      </div>
    );
  }

  const busyCount = board.filter((r) => r.session_id).length;
  const awaitingBill = board.filter((r) => r.bill_requested_at).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-text-secondary)]">
          اسحب الطاولة على مكانها — الحفظ تلقائي. ومن الكيبورد: ركّز الطاولة وحرّكها بالأسهم، وEnter
          يفتح جلستها.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void exportPng()} disabled={exporting}>
            <Download className="h-3.5 w-3.5" />
            تنزيل المخطط
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void clearLayout()} disabled={busy}>
            <LayoutGrid className="h-3.5 w-3.5" />
            ترتيب تلقائي
          </Button>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] sm:aspect-[4/3]"
      >
        {tables.map((t) => {
          const pos = posOf(t);
          if (!pos) return null;
          const row = rows.get(t.id);
          const state = row ? tableState(row) : 'free';
          const style = CHIP_STYLE[state];
          const sub = row ? chipSubline(row, state, now) : null;
          return (
            <button
              key={t.id}
              type="button"
              onPointerDown={(e) => onPointerDown(e, t)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(e) => onTileKeyDown(e, t)}
              onKeyUp={(e) => onTileKeyUp(e, t)}
              onClick={() => {
                if (movedRef.current || !row) return;
                onOpen(row);
              }}
              aria-label={`طاولة ${t.number} — ${OCCUPANCY_LABEL[state]}${
                row && row.session_id && row.total_amount > 0
                  ? ` · ${row.total_amount.toFixed(3)}`
                  : ''
              }`}
              className="absolute flex flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] border-2 text-center transition-colors"
              style={{
                left: `${(pos.x / GRID) * 100}%`,
                top: `${(pos.y / GRID) * 100}%`,
                width: `${CHIP_W}%`,
                height: `${CHIP_H}%`,
                transform: 'translate(-50%, -50%)',
                touchAction: 'none',
                cursor: draggingId === t.id ? 'grabbing' : 'grab',
                borderColor: style.border,
                background: style.background,
              }}
            >
              <span className="text-[13px] font-bold" dir="ltr">
                {String(t.number).padStart(2, '0')}
              </span>
              {sub ? (
                state === 'free' ? (
                  // A bare «4» under the number reads as money on this screen
                  // (busy chips carry a total in the same slot), so capacity
                  // gets its own glyph.
                  <span className="flex items-center gap-0.5 text-caption text-[var(--color-text-secondary)]">
                    <Armchair className="h-3 w-3" aria-hidden="true" />
                    <span dir="ltr">{sub}</span>
                  </span>
                ) : (
                  <span className="text-caption font-semibold text-[var(--color-text-secondary)]" dir="ltr">
                    {sub}
                  </span>
                )
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border-2 border-[var(--color-success)] bg-[var(--color-success-tint)]" />
          متاحة
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border-2 border-[var(--color-primary)] bg-[var(--color-primary-tint)]" />
          مشغولة
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border-2 border-[var(--color-warn)] bg-[var(--color-warn-tint)]" />
          بانتظار الفاتورة
        </span>
        <span className="flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5" />
          {busyCount} مشغولة{awaitingBill > 0 ? ` · ${awaitingBill} تنتظر الفاتورة` : ''}
        </span>
      </div>
    </>
  );
}
