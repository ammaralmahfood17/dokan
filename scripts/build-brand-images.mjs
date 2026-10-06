/**
 * Render the Dokan social card and the PWA splash screens.
 *
 *   node scripts/build-brand-images.mjs
 *
 * These are RENDERED PAGES, not hand-drawn files: the HTML pulls the real
 * @font-face rules out of src/app/fonts/thmanyah.css (the same inlined data: URIs
 * the app ships) and the real artwork out of assets/brand/, so a regenerated card
 * can never drift from the product's typography or mark. Rendering offline needs
 * no dev server and no network — the fonts are already base64 in that CSS.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const FONT_CSS = readFileSync('src/app/fonts/thmanyah.css', 'utf8');
const markBlack = readFileSync('assets/brand/dokan-logo-black.svg', 'utf8');
const markWhite = readFileSync('assets/brand/dokan-logo-white.svg', 'utf8');

// Tokens copied from globals.css — keep them in step if the palette moves.
const BG = '#FAF9F6'; // --color-bg, the warm "Calm Surface"
const INK = '#1F2320'; // --color-text
const SECONDARY = '#6B6F68'; // --color-text-secondary
const PRIMARY = '#7047EB'; // --color-primary (the logo's own violet)

const page = (logo, { bg, size, logoW, extraBg = '', text = '' }) => `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
${FONT_CSS}
  html,body { margin:0; padding:0; }
  body {
    width:${size[0]}px; height:${size[1]}px; background:${bg};
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    font-family:'thmanyah sans', system-ui, sans-serif; color:${INK};
    -webkit-font-smoothing:antialiased; overflow:hidden; position:relative;
  }
  .glow { position:absolute; inset:0; ${extraBg} }
  .logo { position:relative; width:${logoW}px; }
  .logo svg { width:100%; height:auto; display:block; }
  .text { position:relative; text-align:center; }
</style></head>
<body>${extraBg ? '<div class="glow"></div>' : ''}
<div class="logo">${logo}</div>
${text}
</body></html>`;

/* Social card. 1024x576 is the 16:9 that every unfurler crops to; keep the logo
   and the one line of copy inside the middle 80% so no crop eats them. */
const og = page(markBlack, {
  bg: BG,
  size: [1024, 576],
  logoW: 425,
  extraBg:
    'background: radial-gradient(60% 70% at 50% 8%, rgba(112,71,235,0.13), rgba(112,71,235,0) 70%),' +
    ' radial-gradient(45% 55% at 88% 96%, rgba(255,155,83,0.13), rgba(255,155,83,0) 70%);',
  text: `
  <div class="text" style="margin-top:26px; font-size:29px; font-weight:600; letter-spacing:-0.2px;">
    من التسجيل إلى أول طلب في أقل من ٧ دقائق
  </div>
  <div class="text" style="margin-top:14px; font-size:20px; font-weight:500; color:${SECONDARY};">
    إدارة طلبات المطاعم والمقاهي وعربات الطعام
  </div>
  <div class="text" style="position:absolute; bottom:34px; font-size:18px; font-weight:600; color:${PRIMARY};">
    dokanstore.xyz
  </div>`,
});

/* Splash screens. The product has no dark mode, so the dark set is the same warm
   layout on a deep neutral with the white lockup — it is what a phone in dark mode
   should show, not a claim that the app has a dark theme. */
const SPLASH = [
  [1125, 2436],
  [1242, 2688],
  [1668, 2388],
  [2048, 2732],
];
const splashJobs = [];
for (const [w, h] of SPLASH) {
  splashJobs.push({
    out: `public/splash/light-${w}x${h}.png`,
    html: page(markBlack, { bg: BG, size: [w, h], logoW: Math.round(w * 0.34) }),
  });
  splashJobs.push({
    out: `public/splash/dark-${w}x${h}.png`,
    html: page(markWhite, { bg: '#111214', size: [w, h], logoW: Math.round(w * 0.34) }),
  });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const pg = await ctx.newPage();

const shoot = async (html, w, h, out) => {
  await pg.setViewportSize({ width: w, height: h });
  await pg.setContent(html, { waitUntil: 'load' });
  await pg.evaluate(() => document.fonts.ready); // never screenshot a fallback face
  await pg.screenshot({ path: out });
  console.log(`  ${out}  ${w}x${h}`);
};

await shoot(og, 1024, 576, 'public/og-image.png');
mkdirSync('public/splash', { recursive: true });
for (const job of splashJobs) {
  const [w, h] = job.out.match(/(\d+)x(\d+)\.png$/).slice(1).map(Number);
  await shoot(job.html, w, h, job.out);
}
await browser.close();
console.log('\nregenerate with: node scripts/build-brand-images.mjs');