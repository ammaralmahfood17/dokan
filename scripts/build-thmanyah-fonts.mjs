#!/usr/bin/env node
/**
 * Build the Thmanyah webfont CSS.
 *
 *   node scripts/build-thmanyah-fonts.mjs "/path/to/thmanyah typeface"
 *
 * WHY THIS SCRIPT EXISTS (read before changing it)
 * ------------------------------------------------
 * خط ثمانية licence (© 2026 شركة ثمانية للنشر والتوزيع) allows commercial use of
 * the font in logos, identity, websites and apps, and permits embedding it in a
 * website/app/software product **only as part of a bundled or compiled product**
 * ("كجزء من منتج مُجمَّع أو مُعمَّى"). It FORBIDS redistributing, sharing,
 * uploading, hosting, or making the font available for download on any website,
 * server, platform or file-sharing service — and forbids making it available in
 * any way that lets someone extract or reuse it as font files, web embedding
 * included. It also forbids modification, subsetting (which is a modification),
 * renaming, and derived works, and requires keeping the embedded notices.
 *
 * So: we never publish a .woff2 at a URL. The bytes go into the compiled CSS as
 * `data:` URIs — the bundled form the licence names — and the generator emits
 * exactly that. Do NOT "optimise" this into `url('/fonts/x.woff2')`: that turns
 * a permitted embedding into a forbidden download of the font software.
 *
 * The source .woff2 files are NOT in this repo (they are the licensed software);
 * this script reads them from a local directory and writes the generated CSS,
 * which IS committed so the build is deterministic and offline.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node scripts/build-thmanyah-fonts.mjs "<thmanyah typeface dir>"');
  process.exit(1);
}

/**
 * Which weights ship, and what each face covers.
 *
 * The family has five discrete weights (Light/Regular/Medium/Bold/Black), but the
 * UI asks for more: font-semibold (600) is used ~125 times and font-bold (700)
 * ~193. Missing weights would make the browser snap 600 to Bold and flatten the
 * whole hierarchy, so each shipped file declares a RANGE:
 *
 *   400        Regular
 *   500 600    Medium   ← font-medium and font-semibold both land here
 *   700 800    Bold     ← font-bold and font-extrabold both land here
 *
 * Ranges (not repeated @font-face rules) matter: two rules pointing at the same
 * file would inline the same ~100KB of base64 twice.
 */
const CORE = [
  { dir: 'thmanyahsans', file: 'thmanyahsans-Regular', family: 'thmanyah sans', weights: '400' },
  { dir: 'thmanyahsans', file: 'thmanyahsans-Medium', family: 'thmanyah sans', weights: '500 600' },
  { dir: 'thmanyahsans', file: 'thmanyahsans-Bold', family: 'thmanyah sans', weights: '700 800' },
];

/* The serif faces (thmanyah serif display, thmanyah serif text) are NO LONGER
 * shipped. Owner decision 2026-10-07: the whole product uses ONE family —
 * "thmanyah sans" — so no font on any page comes from a second family.
 *
 * This removes ~109KB of base64 (serif display, was render-blocking on every
 * route) and ~107KB (serif text, legal pages only) from the product.
 *
 * The files themselves are untouched in the typeface source directory and stay
 * licensed and unmodified — we simply do not embed them. Nothing is renamed or
 * subsetted, so the licence is unaffected.
 *
 * globals.css points --font-display and --font-serif at "thmanyah sans", so
 * every heading, the legal pages and the brand images all render in Thmanyah
 * sans and every one of those class names keeps working unchanged.
 */

const NOTICE = `/* ==========================================================================
   خط ثمانية (Thmanyah Typeface) — © 2026 شركة ثمانية للنشر والتوزيع، جميع الحقوق محفوظة.

   Embedded under the Thmanyah font licence, in the only form it permits for the
   web: as part of this compiled product. No font file is served from a URL, and
   the family names below are the font's own — nothing is renamed, modified or
   subsetted. Full text of the licence ships with the font (ترخيص خط ثمانية.pdf).

   GENERATED FILE — do not edit by hand.
   Rebuild with: node scripts/build-thmanyah-fonts.mjs "<thmanyah typeface dir>"
   ========================================================================== */`;

function face(entry, b64, order) {
  return `@font-face {
  font-family: '${entry.family}';
  font-style: normal;
  font-weight: ${entry.weights};
  font-display: swap;
  src: url(data:font/woff2;base64,${b64}) format('woff2');
}`;
}

function build(entries, outFile, title) {
  const parts = [NOTICE, '', `/* ${title} */`, ''];
  let raw = 0;
  for (const entry of entries) {
    const woff2 = join(SRC, entry.dir, 'woff2', `${entry.file}.woff2`);
    if (!existsSync(woff2)) {
      console.error(`missing: ${woff2}`);
      process.exit(1);
    }
    const bytes = readFileSync(woff2);
    raw += bytes.length;
    parts.push(face(entry, bytes.toString('base64')));
    parts.push('');
  }
  const css = parts.join('\n');
  writeFileSync(outFile, css, 'utf8');
  console.log(
    `${outFile}  — ${entries.length} faces, ${(raw / 1024).toFixed(1)} KB raw → ${(css.length / 1024).toFixed(1)} KB css`
  );
}

build(CORE, 'src/app/fonts/thmanyah.css', 'UI: sans 400/500-600/700-800 (one family)');