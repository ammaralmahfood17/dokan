import { describe, it, expect } from 'vitest';
import { chipSubline, formatAmount, minutesSince, occupiedLabel, tableState } from './floor-plan';

const base = {
  table_id: 't1',
  number: 1,
  slug: 'table-1',
  zone: null,
  seats: null,
  is_active: true,
  session_id: null,
  opened_at: null,
  bill_requested_at: null,
  orders_count: 0,
  active_orders: 0,
  total_amount: 0,
  paid_amount: 0,
  unpaid_amount: 0,
};

describe('minutesSince()', () => {
  it('counts whole minutes', () => {
    expect(minutesSince('2026-10-23T10:00:00Z', Date.parse('2026-10-23T10:12:59Z'))).toBe(12);
  });

  it('clamps clock skew to zero instead of a negative duration', () => {
    expect(minutesSince('2026-10-23T10:05:00Z', Date.parse('2026-10-23T10:00:00Z'))).toBe(0);
  });

  it('treats an unparseable timestamp as zero', () => {
    expect(minutesSince('not-a-date', Date.now())).toBe(0);
  });
});

describe('occupiedLabel()', () => {
  it('shows the first minute as «1 د», never «0 د»', () => {
    expect(occupiedLabel(0)).toBe('1 د');
  });

  it('uses minutes under an hour and hours above it', () => {
    expect(occupiedLabel(42)).toBe('42 د');
    expect(occupiedLabel(60)).toBe('1 س');
    expect(occupiedLabel(95)).toBe('1 س 35 د');
  });
});

describe('tableState()', () => {
  it('free only when there is no session and the table is active', () => {
    expect(tableState(base)).toBe('free');
  });

  it('busy while a session is open — delivered orders do not free it', () => {
    expect(tableState({ ...base, session_id: 's1' })).toBe('busy');
  });

  it('awaiting bill wins over busy once the bill was requested', () => {
    expect(
      tableState({ ...base, session_id: 's1', bill_requested_at: '2026-10-23T10:30:00Z' })
    ).toBe('awaiting_bill');
  });

  it('inactive, but a live session still shows as busy (customers are seated)', () => {
    expect(tableState({ ...base, is_active: false })).toBe('inactive');
    expect(tableState({ ...base, is_active: false, session_id: 's1' })).toBe('busy');
  });
});

describe('chipSubline()', () => {
  it('shows the running total for a busy table with money on it', () => {
    expect(chipSubline({ ...base, session_id: 's1', total_amount: 1.25 }, 'busy', Date.now())).toBe('1.250');
  });

  it('falls back to the duration when the session has no money yet', () => {
    const now = Date.parse('2026-10-23T10:20:00Z');
    expect(
      chipSubline({ ...base, session_id: 's1', opened_at: '2026-10-23T10:00:00Z' }, 'busy', now)
    ).toBe('20 د');
  });

  it('shows seats on a free table', () => {
    expect(chipSubline({ ...base, seats: 4 }, 'free', null)).toBe('4');
  });

  it('renders nothing when there is neither money, time, nor seats', () => {
    expect(chipSubline(base, 'free', null)).toBeNull();
  });
});

describe('formatAmount()', () => {
  it('always uses the three decimals BHD prices are stored with', () => {
    expect(formatAmount(0.1)).toBe('0.100');
    expect(formatAmount(12)).toBe('12.000');
  });
});
