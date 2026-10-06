/**
 * Debug: why does the focus indicator not apply? (W3-T1)
 *
 * Reads the computed outline for a field focused BY KEYBOARD (the real path the finding is
 * about) and then lists every CSS rule that declares `outline` on that element with the
 * order/specificity information the cascade uses.
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input', { state: 'visible' });

// focus the way a keyboard user does: Tab from the top of the document
await page.keyboard.press('Tab');
const focused = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id,
    className: String(el.className).slice(0, 60),
    outline: cs.outline,
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
    boxShadow: cs.boxShadow,
    matchesFocusVisible: el.matches(':focus-visible'),
  };
});
console.log('kbd-focused:', JSON.stringify(focused, null, 2));

// every rule in the document that touches `outline`, in cascade order, with its layer info
const rules = await page.evaluate(() => {
  const out = [];
  const walk = (list, layer, media) => {
    for (const rule of list) {
      if (rule.cssRules && rule.constructor.name === 'CSSLayerBlockRule') {
        walk(rule.cssRules, rule.name, media);
        continue;
      }
      if (rule.cssRules && rule.constructor.name === 'CSSMediaRule') {
        walk(rule.cssRules, layer, rule.conditionText);
        continue;
      }
      if (rule.cssRules) { walk(rule.cssRules, layer, media); continue; }
      if (rule.selectorText && /outline/.test(rule.style?.cssText ?? '')) {
        out.push({ layer, media, selector: rule.selectorText, css: rule.style.cssText.slice(0, 120) });
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules, null, null); } catch { /* cross-origin */ }
  }
  return out;
});
console.log('\nrules declaring outline:');
for (const r of rules) console.log(`  layer=${r.layer} media=${r.media} ${r.selector} { ${r.css} }`);

await browser.close();
