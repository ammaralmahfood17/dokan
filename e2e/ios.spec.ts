import { test, expect, devices } from '@playwright/test';

/**
 * iOS / WebKit smoke — Wave 6 (2026-10-22).
 *
 * WHY: until this file, `webkit` appeared ZERO times in `e2e/` and `.github/`.
 * Every layout gate ran on Chromium, while the customer QR menu is opened on an
 * iPhone and Safari differs exactly where this product lives: dynamic viewport
 * units, fixed bars above the home indicator, and the 16px input-zoom rule.
 *
 * Three assertions, each one a defect class that Chromium cannot catch:
 *  1. the fixed cart bar sits inside the visual viewport (not under Safari's
 *     bottom toolbar, not pushed down by `100vh`),
 *  2. form controls render at >=16px on a coarse pointer (Safari zooms the page
 *     on focus below that, and the zoom does not undo),
 *  3. `dvh` is supported and the page never scrolls horizontally.
 *
 * Read-only and public: safe against production, runs nightly.
 * Run: npm run test:webkit
 */

test.use({ ...devices['iPhone 13'] });

test.describe('@webkit iOS', () => {
  test('product sheet stays inside the visual viewport', async ({ page }) => {
    const res = await page.goto('/estikana/menu/table-1', { waitUntil: 'domcontentloaded' });
    expect(res?.status() ?? 0).toBeLessThan(400);

    await page
      .waitForFunction(() => document.body.innerText.trim().length > 20, undefined, { timeout: 15_000 })
      .catch(() => {});

    // Open the sheet the way a customer does. (The cart bar itself only exists
    // once a line is in the cart, and reaching that state needs the mandatory
    // size choice — a gate that asserts an unrendered component proves nothing.
    // The sheet is where the iOS failure lives: a bottom-anchored panel under
    // Safari's toolbar.)
    const add = page.locator('button[aria-label^="إضافة"]').first();
    await expect(add).toBeVisible();
    await add.click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // The panel slides up over 240ms (--motion-modal). Measuring mid-flight
    // reports a half-height overflow that does not exist — the first run of
    // this test "failed" at bottom 992px on a 664px viewport for that reason.
    await page.waitForTimeout(350);

    const geometry = await page.evaluate(() => {
      const overlay = document.querySelector<HTMLElement>('[role="dialog"]')!;
      const panel = overlay.querySelector<HTMLElement>(':scope > div')!;
      const o = overlay.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return {
        overlayTop: Math.round(o.top),
        overlayBottom: Math.round(o.bottom),
        panelBottom: Math.round(p.bottom),
        panelHeight: Math.round(p.height),
        innerHeight: window.innerHeight,
        visualHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
        // The shipped fix for the iOS toolbar: the panel is capped in dvh, not vh.
        usesDvh: panel.className.includes('max-h-dvh'),
      };
    });

    expect(geometry.usesDvh, 'sheet panel must cap height in dvh, not vh').toBe(true);
    expect(geometry.overlayTop, 'sheet overlay must start at the top of the viewport').toBeLessThanOrEqual(1);
    expect(
      geometry.overlayBottom,
      `sheet overlay bottom ${geometry.overlayBottom}px exceeds the visual viewport ${geometry.visualHeight}px`
    ).toBeLessThanOrEqual(geometry.visualHeight + 1);
    expect(
      geometry.panelBottom,
      `sheet panel bottom ${geometry.panelBottom}px sits under the iOS toolbar (viewport ${geometry.visualHeight}px)`
    ).toBeLessThanOrEqual(geometry.visualHeight + 1);
    expect(
      geometry.panelHeight,
      'sheet panel is taller than the visible viewport'
    ).toBeLessThanOrEqual(geometry.visualHeight + 1);
  });

  test('login fields stay >=16px so Safari does not zoom on focus', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    const email = page.locator('input[type="email"], input[name="email"]').first();
    await expect(email).toBeVisible();

    const metrics = await email.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fontSize: parseFloat(cs.fontSize), height: el.getBoundingClientRect().height };
    });

    expect(metrics.fontSize, 'an input below 16px makes iOS zoom the whole page').toBeGreaterThanOrEqual(16);
    expect(metrics.height, 'touch target floor').toBeGreaterThanOrEqual(44);

    // Focusing must not change the layout width (the zoom signature).
    const before = await page.evaluate(() => document.documentElement.clientWidth);
    await email.focus();
    const after = await page.evaluate(() => document.documentElement.clientWidth);
    expect(after, 'focus changed the layout viewport — Safari zoomed').toBe(before);
  });

  test('dynamic viewport units and RTL hold, with no horizontal scroll', async ({ page }) => {
    for (const path of ['/estikana', '/estikana/menu/table-1']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page
        .waitForFunction(() => document.body.innerText.trim().length > 20, undefined, { timeout: 15_000 })
        .catch(() => {});

      const m = await page.evaluate(() => ({
        supportsDvh: CSS.supports('height', '100dvh'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        direction: getComputedStyle(document.documentElement).direction,
      }));

      expect(m.supportsDvh, 'WebKit version without dvh support').toBe(true);
      expect(m.direction).toBe('rtl');
      expect(m.scrollWidth, `${path} scrolls horizontally on iPhone`).toBeLessThanOrEqual(m.clientWidth + 1);
    }
  });
});
