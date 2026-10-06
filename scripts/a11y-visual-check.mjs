/**
 * Visual review for the two Criticals (W3-T1 focus ring, W3-T2 control boundaries).
 *
 * The plan requires a visual review of the change before merge. A screenshot alone cannot
 * prove a contrast ratio, so this also reads the COMPUTED styles from a real browser: the
 * border colour actually painted on an input, and the outline a focused field actually gets.
 *
 * Run: node scripts/a11y-visual-check.mjs   (E2E_BASE_URL=... to point elsewhere)
 * Names come from the env contract (.env.example): E2E_BASE_URL / E2E_MENU_PATH, the same ones
 * the axe spec reads, so nothing new has to be documented for these scripts to run.
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'https://dokanstore.xyz';
const MENU = process.env.E2E_MENU_PATH || '/estikana/menu/table-1';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
// The form is client-rendered: measuring at domcontentloaded read null on the first run.
await page.waitForSelector('input', { state: 'visible' });

const inputStyles = await page.evaluate(() => {
  const input = document.querySelector('input[type="email"], input');
  if (!input) return null;
  const cs = getComputedStyle(input);
  return {
    element: input.tagName.toLowerCase(),
    borderTop: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
    background: cs.backgroundColor,
  };
});

// Focus the way a KEYBOARD user does. `page.focus()` sets focus programmatically, and Chrome
// does not grant :focus-visible for that on a text input - which made the first version of this
// check report `outline: none` and look like a CSS failure that was really a measurement error.
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const focusStyles = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    focusedElement: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''),
    outline: cs.outline,
    outlineColor: cs.outlineColor,
    outlineWidth: cs.outlineWidth,
    outlineOffset: cs.outlineOffset,
    boxShadow: cs.boxShadow,
  };
});

await page.screenshot({ path: '/tmp/a11y-login-focus.png' });
console.log('login - control boundary (computed):', JSON.stringify(inputStyles));
console.log('login - focus indicator (computed):', JSON.stringify(focusStyles));

// A non-focused shot of the same form, for the "bounded but not heavy" judgement.
await page.evaluate(() => document.activeElement?.blur?.());
await page.screenshot({ path: '/tmp/a11y-login.png', fullPage: true });

await page.goto(`${BASE}${MENU}`, { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: '/tmp/a11y-menu.png', fullPage: true });
console.log('menu — landed on:', new URL(page.url()).pathname);

await browser.close();
