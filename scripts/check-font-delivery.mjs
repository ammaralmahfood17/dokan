/**
 * Font-delivery gate. Proves, from a real browser, the three properties the
 * Thmanyah licence and the single-family decision both depend on:
 *
 *   1. NO request ever goes to fonts.googleapis.com / fonts.gstatic.com. The
 *      licence forbids hosting the typeface or making it available at any URL,
 *      so it must arrive as data: URIs inside our own compiled CSS.
 *   2. No .woff2 is served from any URL — including ours. If a future change
 *      re-adds `url('/fonts/x.woff2')`, this fails: that is a licence breach
 *      and an offline-build regression at the same time.
 *   3. Every text element on the page resolves to "thmanyah sans" — the ONE
 *      family the product uses. A serif face sneaking back into a CSS variable
 *      would show up here as a computed family we do not ship.
 *
 * The previous version of this gate asserted /Cairo/ and expected own-origin
 * .woff2 fetches. Both were wrong long before this file was last run: Cairo was
 * replaced by Thmanyah, and the licence forbids serving font files at a URL, so
 * the correct expectation is a data: URI and NO woff2 request at all.
 *
 * Run: E2E_BASE_URL=http://localhost:3100 node scripts/check-font-delivery.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const PATHS = (process.env.E2E_FONT_PATHS || '/login').split(',');

const browser = await chromium.launch();
let ok = true;

for (const p of PATHS) {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(`${BASE}${p}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500); // let any deferred font work happen

  const google = requests.filter((u) => /fonts\.(googleapis|gstatic)\.com/.test(u));
  const woff2 = requests.filter((u) => /\.woff2?(\?|$)/i.test(u));
  const familiesUsed = await page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const f = getComputedStyle(el).fontFamily;
      if (f) out.add(f);
    }
    return [...out];
  });

  console.log(`\n--- ${p} ---`);
  console.log('  requests to Google fonts :', google.length);
  console.log('  .woff2 served at any URL :', woff2.length, woff2.slice(0, 3));
  console.log('  distinct font-families   :', familiesUsed.length);
  for (const f of familiesUsed) console.log('     ·', f);

  // Only text the USER reads matters. Third-party widgets (sonner's toast portal,
  // injected overlays) carry their own inline stacks; we style them explicitly
  // rather than rewriting their shadow DOM. So judge visible text nodes only.
  const nonThmanyahText = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || '').trim();
      if (!text) continue;
      const f = getComputedStyle(n.parentElement).fontFamily;
      if (!/thmanyah sans/i.test(f)) {
        out.push({ text: text.slice(0, 40), family: f.slice(0, 60), where: n.parentElement.tagName.toLowerCase() });
      }
    }
    return out;
  });
  await page.close();

  const pass = google.length === 0 && woff2.length === 0 && nonThmanyahText.length === 0;
  console.log(pass ? '  PASS' : `  FAIL — ${nonThmanyahText.length} text nodes off-family: ${JSON.stringify(nonThmanyahText.slice(0, 3))}`);
  ok = ok && pass;
}

await browser.close();
console.log(ok ? '\nPASS: one family, inline as data: URIs, nothing fetched from a URL.' : '\nFAIL');
process.exit(ok ? 0 : 1);