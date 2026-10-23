import type { Page } from '@playwright/test';

/**
 * Layout probe — the ONE measurement every responsive gate uses.
 *
 * Extracted from `responsive.spec.ts` (Wave 0) when the authed matrix landed
 * (Wave 6): two copies of a 70-line page.evaluate would drift, and the whole
 * point of the matrix is that public and merchant screens are measured by the
 * same rule. Change the rule here and every cell re-measures identically.
 *
 * The three traps encoded below were each paid for once already:
 *  - `overflow-x: auto` ancestors are rails, not page overflow (menu chips),
 *  - hidden/zero-opacity elements are not "controls outside the viewport",
 *  - icon-only means no accessible label AND no text, so labelled buttons are
 *    sized by their content.
 */
export type LayoutMeasurement = {
  viewportWidth: number;
  scrollWidth: number;
  clientWidth: number;
  direction: string;
  bodyTextLength: number;
  overflowCount: number;
  overflowSample: { tag: string; label: string; left: number; right: number }[];
  smallIconButtons: { label: string; width: number; height: number }[];
};

export async function measureLayout(page: Page): Promise<LayoutMeasurement> {
  return page.evaluate((): LayoutMeasurement => {
    const doc = document.documentElement;
    const vw = window.innerWidth;
    const isVisible = (el: Element) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // A control scrolled out of a horizontal chip rail is intentional, not an
    // overflow bug: the rail is the affordance. Only elements that overflow
    // the PAGE are defects.
    const inHorizontalScroller = (el: Element) => {
      let node: Element | null = el.parentElement;
      while (node && node !== document.body) {
        const ox = getComputedStyle(node).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
        node = node.parentElement;
      }
      return false;
    };

    // A CLOSED off-canvas drawer is not an overflow bug: its controls are
    // painted at x=329 on a 320px screen because the panel is parked outside
    // the viewport by design (translate-x-full). Without this, every merchant
    // screen at 320px failed on the sidebar's own close/settings/logout
    // buttons (measured 2026-10-22). Exclude an element only when its drawer
    // ancestor is ENTIRELY outside the viewport — a drawer slid half-in is
    // still a defect.
    const inOffscreenDrawer = (el: Element) => {
      let node: Element | null = el.parentElement;
      while (node && node !== document.body) {
        if (node.tagName === 'ASIDE' || node.getAttribute('role') === 'dialog') {
          const r = node.getBoundingClientRect();
          if (r.right <= 0 || r.left >= vw) return true;
        }
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
      .filter((el) => !inHorizontalScroller(el) && !inOffscreenDrawer(el))
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

    // Icon-only controls carry the 44px floor (house rule, and the one shape
    // scripts/check-touch-targets.mjs already guards statically).
    const smallIconButtons = Array.from(
      document.querySelectorAll<HTMLElement>('button,[role="switch"],[role="checkbox"]')
    )
      .filter(isVisible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        // Accessible name, approximated the way the browser computes it:
        // aria-label, then an associated <label>, then the element's text.
        // Without the <label> step, every properly-labelled form control reads
        // as "icon-only" (the store-colour swatch was flagged on 2026-10-22
        // while carrying <label for="primary-color">).
        const labelled =
          el.getAttribute('aria-label') ||
          (el as HTMLInputElement).labels?.[0]?.textContent ||
          '';
        const label = (labelled || el.textContent || '').trim();
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
}
