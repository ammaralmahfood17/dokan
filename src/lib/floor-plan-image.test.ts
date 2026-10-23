import { describe, it, expect } from 'vitest';
import { planChips, type ExportState } from './floor-plan-image';

const size = { width: 2000, height: 1500, padding: 60, topInset: 140, bottomInset: 80 };

describe('planChips()', () => {
  const tables = [
    { id: 'a', number: 1, seats: 4 },
    { id: 'b', number: 2 },
  ];
  const positions = new Map([
    ['a', { x: 500, y: 500 }],
    ['b', { x: 1000, y: 1000 }],
  ]);
  const stateOf = (id: string): ExportState => (id === 'a' ? 'busy' : 'free');
  const subOf = (id: string) => (id === 'a' ? '1.350' : null);

  it('draws one chip per placed table, and skips unplaced ones', () => {
    const chips = planChips({ tables, positions, stateOf, subOf, ...size });
    expect(chips).toHaveLength(2);
    const onlyOne = planChips({
      tables,
      positions: new Map([['a', { x: 500, y: 500 }]]),
      stateOf,
      subOf,
      ...size,
    });
    expect(onlyOne).toHaveLength(1);
  });

  it('carries the state and the second line the screen shows', () => {
    const chips = planChips({ tables, positions, stateOf, subOf, ...size });
    const a = chips.find((c) => c.id === 'a')!;
    const b = chips.find((c) => c.id === 'b')!;
    expect(a.state).toBe('busy');
    expect(a.sub).toBe('1.350');
    expect(b.state).toBe('free');
    expect(b.sub).toBeNull();
  });

  it('clamps every chip inside the printable box, even at 0 and 1000', () => {
    const edge = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 1000, y: 1000 }],
    ]);
    const chips = planChips({ tables, positions: edge, stateOf, subOf, ...size });
    for (const c of chips) {
      expect(c.x).toBeGreaterThanOrEqual(size.padding);
      expect(c.y).toBeGreaterThanOrEqual(size.padding + 140);
      expect(c.x + c.width).toBeLessThanOrEqual(size.width - size.padding);
      expect(c.y + c.height).toBeLessThanOrEqual(size.height - size.padding - 80);
    }
  });
});
