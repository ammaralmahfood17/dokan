/**
 * Turning the floor plan into a PNG — layout maths pure and tested, drawing done
 * by the browser's canvas (no dependency, no server round trip).
 *
 * Restored from the 2026-10-13 build and re-pointed at sessions: a chip is
 * `free | busy | awaiting_bill | inactive`, and its second line is whatever the
 * screen shows (the running total for a busy table, seats for a free one), so
 * the printed sheet cannot disagree with the screen the merchant is looking at.
 */

export type ExportState = 'free' | 'busy' | 'awaiting_bill' | 'inactive';

export interface ExportTable {
  id: string;
  number: number;
  seats?: number | null;
}

export interface ExportChip {
  id: string;
  number: number;
  /** Top-left corner in device pixels, already clamped inside the page. */
  x: number;
  y: number;
  width: number;
  height: number;
  state: ExportState;
  /** Second line: total for a busy table, seats for a free one. */
  sub: string | null;
}

export interface PlanChipsInput {
  tables: ExportTable[];
  /** Grid coordinates 0..1000 per table (drag override → stored → automatic). */
  positions: Map<string, { x: number; y: number }>;
  stateOf: (tableId: string) => ExportState;
  subOf: (tableId: string) => string | null;
  width: number;
  height: number;
  padding: number;
  topInset?: number;
  bottomInset?: number;
  grid?: number;
}

export function planChips({
  tables,
  positions,
  stateOf,
  subOf,
  width,
  height,
  padding,
  topInset = 0,
  bottomInset = 0,
  grid = 1000,
}: PlanChipsInput): ExportChip[] {
  const inner = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding - topInset - padding - bottomInset);
  const chipW = Math.max(24, Math.min(inner * 0.16, 120));
  const chipH = Math.max(24, Math.min(innerH * 0.18, 96));

  const chips: ExportChip[] = [];
  for (const t of tables) {
    const pos = positions.get(t.id);
    if (!pos) continue; // not placed and not auto-laid-out → nothing to draw
    const cx = padding + (pos.x / grid) * inner;
    const cy = padding + topInset + (pos.y / grid) * innerH;
    chips.push({
      id: t.id,
      number: t.number,
      // Clamp to the PAGE, not the point: a table dragged to the very edge would
      // otherwise print half off the sheet.
      x: Math.round(Math.min(Math.max(cx - chipW / 2, padding), padding + inner - chipW)),
      y: Math.round(
        Math.min(Math.max(cy - chipH / 2, padding + topInset), padding + topInset + innerH - chipH)
      ),
      width: Math.round(chipW),
      height: Math.round(chipH),
      state: stateOf(t.id),
      sub: subOf(t.id),
    });
  }
  return chips;
}

/** Rounded rectangle that works with or without `ctx.roundRect` (older Safari). */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const CHIP_FILL: Record<ExportState, string> = {
  free: '#dcfce7',
  busy: '#ece5ff',
  awaiting_bill: '#fef3c7',
  inactive: '#f3f4f6',
};

const CHIP_BORDER: Record<ExportState, string> = {
  free: '#16a34a',
  busy: '#7047eb',
  awaiting_bill: '#b45309',
  inactive: '#9ca3af',
};

export interface PlanImageMeta {
  title: string;
  /** Pre-formatted line under the title (date, store). */
  subtitle?: string;
  legend?: string;
}

/** Draw the plan. Text is the browser's job, so Arabic shapes correctly. */
export function drawFloorPlan(
  ctx: CanvasRenderingContext2D,
  chips: ExportChip[],
  meta: PlanImageMeta,
  size: { width: number; height: number; padding: number; topInset?: number; bottomInset?: number }
) {
  const { width, height, padding, topInset = 130, bottomInset = 60 } = size;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1f2320';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 40px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.direction = 'rtl';
  ctx.fillText(meta.title, padding + (width - padding * 2), padding + 46);
  if (meta.subtitle) {
    ctx.font = '24px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText(meta.subtitle, padding + (width - padding * 2), padding + 84);
  }

  const top = padding + topInset;
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 2;
  roundedRect(ctx, padding, top, width - padding * 2, height - top - padding - bottomInset, 16);
  ctx.stroke();

  for (const chip of chips) {
    ctx.fillStyle = CHIP_FILL[chip.state];
    ctx.strokeStyle = CHIP_BORDER[chip.state];
    ctx.lineWidth = 3;
    roundedRect(ctx, chip.x, chip.y, chip.width, chip.height, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1f2320';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(chip.height * 0.34)}px system-ui, -apple-system, sans-serif`;
    ctx.direction = 'ltr';
    ctx.fillText(String(chip.number).padStart(2, '0'), chip.x + chip.width / 2, chip.y + chip.height * 0.38);
    if (chip.sub) {
      ctx.fillStyle = '#6b7280';
      ctx.font = `bold ${Math.round(chip.height * 0.26)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.direction = 'ltr';
      ctx.fillText(chip.sub, chip.x + chip.width / 2, chip.y + chip.height * 0.72);
    }
  }

  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6b7280';
  ctx.font = '22px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(
    meta.legend ?? 'أخضر = متاحة · بنفسجي = مشغولة (مع الإجمالي) · أصفر = بانتظار الفاتورة',
    width - padding,
    height - padding - 16
  );
}
