/**
 * Proof that the font is self-hosted and the page never reaches Google.
 *
 * Two facts, both read from a real browser rather than inferred from the source:
 *   1. no request goes to fonts.googleapis.com / fonts.gstatic.com
 *   2. a woff2 is fetched from OUR origin, and the computed font-family resolves to the family
 *      the package declares ("Cairo Variable") - i.e. the typeface still arrives.
 *
 * Run: E2E_BASE_URL=http://localhost:3100 node scripts/check-font-delivery.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage();
const requests = [];
page.on('request', (r) => requests.push(r.url()));

await page.goto(`${BASE}/login`, { waitUntil: 'load' });
await page.waitForTimeout(1500); // let any deferred font fetch happen

const external = requests.filter((u) => /fonts\.(googleapis|gstatic)\.com/.test(u));
const woff2 = requests.filter((u) => u.endsWith('.woff2'));
const ownWoff2 = woff2.filter((u) => u.startsWith(BASE) || u.includes(new URL(BASE).host));

const computed = await page.evaluate(() => {
  const body = getComputedStyle(document.body).fontFamily;
  const el = document.querySelector('h1, p, input, button');
  return { body, sample: el ? getComputedStyle(el).fontFamily : null };
});

console.log('requests to Google fonts :', external.length, external.slice(0, 3));
console.log('woff2 requests           :', woff2.length, 'from our origin:', ownWoff2.length);
console.log('computed font-family     :', computed.body);
console.log('  on a rendered element  :', computed.sample);

const ok = external.length === 0 && ownWoff2.length > 0 && /Cairo/i.test(computed.body);
console.log(ok ? '\nPASS: self-hosted, and the typeface still arrives' : '\nFAIL');
await browser.close();
process.exit(ok ? 0 : 1);
