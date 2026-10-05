import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QrReprintBanner } from '@/components/dashboard/qr-reprint-banner';

/**
 * Owner decision 1 (2026-10 audit remediation): the merchant must reprint the table QR
 * sheets before the old ones stop working. The banner's exact wording is part of the
 * decision, and its dismiss control must be reachable — both are asserted here so a
 * refactor cannot quietly change what the merchant is told.
 */
describe('QrReprintBanner', () => {
  const html = renderToStaticMarkup(<QrReprintBanner onDismiss={() => {}} />);

  it('states the decision-1 wording verbatim', () => {
    expect(html).toContain('أعد طباعة رموز QR، الرموز القديمة لن تسمح بالطلب قريباً');
  });

  it('announces itself without stealing focus (role=status, not alert)', () => {
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it('has a labelled dismiss control at the 44px touch contract', () => {
    expect(html).toContain('aria-label="إغلاق التنبيه"');
    expect(html).toContain('h-11 w-11');
  });

  it('uses warning tokens, not the brand colour (it is a caution, not an action)', () => {
    expect(html).toContain('var(--color-warn)');
    expect(html).toContain('var(--color-warn-tint)');
  });

  it('contains no Latin digits (the UI contract is Latin numerals, Arabic copy)', () => {
    expect(html).not.toMatch(/[٠-٩]/);
  });
});
