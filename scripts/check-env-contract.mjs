import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const root = process.cwd();
const extensions = new Set(['.ts', '.tsx', '.mjs']);
const ignored = new Set(['node_modules', '.next', '.git']);
const platformProvided = new Set([
  'CI',
  'NODE_ENV',
  'NEXT_RUNTIME',
  'VERCEL',
  'VERCEL_ENV',
]);
const used = new Set(['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN']);

function scan(directory) {
  for (const name of readdirSync(directory)) {
    if (ignored.has(name)) continue;
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      scan(path);
      continue;
    }
    if (!extensions.has(extname(name))) continue;
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      used.add(match[1]);
    }
  }
}

scan(resolve(root, 'src'));
scan(resolve(root, 'scripts'));
for (const file of ['next.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts']) {
  const source = readFileSync(resolve(root, file), 'utf8');
  for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    used.add(match[1]);
  }
}

const documented = new Set();
for (const line of readFileSync(resolve(root, '.env.example'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/);
  if (match) documented.add(match[1]);
}

const missing = [...used]
  .filter((name) => !platformProvided.has(name) && !documented.has(name))
  .sort();

if (missing.length) {
  console.error(`[env-contract] undocumented variables: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`[env-contract] ${used.size} referenced variables are documented`);
