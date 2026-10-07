// The exact set of files shipped in the extension package.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function packagedFiles() {
  return [
    join(ROOT, 'manifest.json'),
    join(ROOT, 'managed_schema.json'),
    join(ROOT, 'LICENSE'),
    ...walk(join(ROOT, 'src')),
    ...walk(join(ROOT, 'icons')),
  ].map((p) => relative(ROOT, p).split('\\').join('/')).sort();
}
