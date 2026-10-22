import { test, expect } from '@playwright/test';

/**
 * Responsive baseline — Wave 0 (2026-10-22).
 *
 * WHY THIS FILE EXISTS: before this spec the suite had exactly ONE viewport
 * (390×844 in playwright.config.ts), so a layout could break at 320 or 768 and
 * every gate stayed green. The target devices are phones AND tablets (the
 * counter/POS tablet is 744–820 CSS px), so the matrix below is the contract.
 *
 * SCOPE — public, read-only. These routes need no session and write nothing, so
 * the spec is safe against production (the default baseURL). Authed screens
 * (POS/KDS/dashboard) are covered by their own specs; their responsive pass
 * arrives with the tablet layout in Wave 1, when there is something to assert.
 *
 * WHAT IT FAILS ON:
 *  1. the document scrolls horizontally (the classic 320px / tablet failure),
 *  2. an interactive control is painted outside the viewport,
 *  3. an icon-only control is under 44×44 on a touch viewport (house floor),
 *  4. the page is not RTL, or renders an empty body.
 *
 * Run: npm run test:responsive
 * Against a local server: E2E_BASE_URL=http://localhost:3000 npm run test:responsive
 */

const ROUTES = [
  { path: '/', name: 'landing' },
  { path: '/login', name: 'login' },
  { path: '/register', name: 'register' },
  { path: '/reset-password', name: 'reset-password' },
  { path: '/terms', name: 'terms' },
  { path: '/privacy', name: 'privacy' },
  { path: '/estikana', name: 'storefront' },
  { path: '/estikana/menu/table-1', name: 'menu' },
] as const;

type Vp = { name: string; width: number; height: number; touch: boolean };

/**
 * 320 is the floor the brief names; 360 is the real Android middle; 390 is the
 * design baseline; 768 is the TABLET switch (iPad mini 744 / Tab A9 800);
 * 1024 is tablet landscape; 1280 is desktop. Six points, not ten: each one
 * changes a layout decision, otherwise it is just runtime.
 */
const VIEWPORTS: Vp[] = [
  { name: '320-se', width: 320, height: 568, touch: true },
  { name: '360-android', width: 360, height: 800, touch: true },
  { name: '390-phone', width: 390, height: 844, touch: true },
  { name: '768-tablet', width: 768, height: 1024, touch: true },
  { name: '1024-tablet-landscape', width: 1024, height: 768, touch: true },
  { name: '1280-desktop', width: 1280, height: 800, touch: false },
  // WCAG 1.4.10 reflow: a 1280×1024 window at 200% browser zoom is a 640×512
  // viewport to CSS. No horizontal scroll allowed at that width either.
  { name: '640-zoom200', width: 640, height: 512, touch: true },
];

type Measurement = {
  viewportWidth: number;
  scrollWidth: number;
  clientWidth: number;
  direction: string;
  bodyTextLength: number;
  overflowCount: number;
  overflowSample: { tag: string; label: string; left: number; right: number }[];
  smallIconButtons: { label: string; width: number; height: number }[];
};

for (const vp of VIEWPORTS) {
  test.describe(`@responsive ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch,
    });

    for (const route of ROUTES) {
      test(`${route.name} fits ${vp.width}px`, async ({ page }) => {
        const res = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        expect(res, `no response for ${route.path}`).not.toBeNull();
        expect(res!.status(), `${route.path} answered ${res!.status()}`).toBeLessThan(400);

        // Let webfonts/layout settle without waiting for every image: CLS and
        // overflow are decided by layout, not by pixels arriving.
        await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());

        // The QR menu streams a skeleton first and swaps it after hydration. At
        // domcontentloaded `main.innerText` already has the product text (it
        // falls back to textContent for an unrendered subtree) while
        // `body.innerText` still reads 16 characters — so wait on the exact
        // thing that gets asserted. A page that never becomes visible is a
        // legitimate failure, not a skipped check.
        await page
          .waitForFunction(() => document.body.innerText.trim().length > 20, undefined, {
            timeout: 15_000,
          })
          .catch(() => {});

        const m = await page.evaluate((): Measurement => {
          const doc = document.documentElement;
          const vw = window.innerWidth;
          const isVisible = (el: Element) => {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            if (Number(cs.opacity) === 0) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };

          // A control scrolled out of a horizontal chip rail is intentional, not
          // an overflow bug: the rail is the affordance (the category strip on
          // the QR menu is exactly this). Only elements that overflow the PAGE
          // are defects.
          const inHorizontalScroller = (el: Element) => {
            let node: Element | null = el.parentElement;
            while (node && node !== document.body) {
              const ox = getComputedStyle(node).overflowX;
              if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
              node = node.parentElement;
            }
            return false;
          };

          const interactive = Array.from(
            document.querySelectorAll<HTMLElement>(
              'a,button,input,select,textarea,[role="button"],[role="switch"],[role="checkbox"]'
            )
          ).filter(isVisible);

          const overflow = interactive
            .filter((el) => !inHorizontalScroller(el))
            .map((el) => {
              const r = el.getBoundingClientRect();
              return {
                tag: el.tagName.toLowerCase(),
                label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
                left: Math.round(r.left),
                right: Math.round(r.right),
              };
            })
            .filter((r) => r.right > vw + 2 || r.left < -2);

          // Icon-only controls carry the 44px floor (house rule, and the one
          // shape scripts/check-touch-targets.mjs already guards statically).
          // A control with a visible label is sized by its text.
          const smallIconButtons = Array.from(
            document.querySelectorAll<HTMLElement>('button,[role="switch"],[role="checkbox"]')
          )
            .filter(isVisible)
            .map((el) => {
              const r = el.getBoundingClientRect();
              const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
              return { label, width: Math.round(r.width), height: Math.round(r.height) };
            })
            .filter((b) => b.label.length === 0 && (b.width < 44 || b.height < 44));

          return {
            viewportWidth: vw,
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            direction: getComputedStyle(doc).direction,
            bodyTextLength: document.body.innerText.trim().length,
            overflowCount: overflow.length,
            overflowSample: overflow.slice(0, 8),
            smallIconButtons: smallIconButtons.slice(0, 8),
          };
        });

        expect(m.direction, 'the document must be RTL').toBe('rtl');
        expect(m.bodyTextLength, 'page rendered no text').toBeGreaterThan(20);

        expect(
          m.scrollWidth,
          `${route.path} scrolls horizontally at ${vp.width}px (scrollWidth ${m.scrollWidth} > ${m.clientWidth})`
        ).toBeLessThanOrEqual(m.clientWidth + 1);

        expect(
          m.overflowCount,
          `interactive controls outside the ${vp.width}px viewport: ${JSON.stringify(m.overflowSample)}`
        ).toBe(0);

        if (vp.touch) {
          expect(
            m.smallIconButtons,
            `icon-only controls under 44px at ${vp.width}px: ${JSON.stringify(m.smallIconButtons)}`
          ).toEqual([]);
        }
      });
    }
  });
}
