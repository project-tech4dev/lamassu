// Builds dist/lamassu-visibility-guardian-<version>.zip for the Chrome Web Store.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './files.mjs';
import { buildPackageZip, readVersion } from './lib/zip.mjs';

const { zip, count } = buildPackageZip();
const version = readVersion();
mkdirSync(join(ROOT, 'dist'), { recursive: true });
const name = `lamassu-visibility-guardian-${version}.zip`;
writeFileSync(join(ROOT, 'dist', name), zip);
console.log(`dist/${name}  ${count} files  ${zip.length} bytes`);
console.log(`sha256 ${createHash('sha256').update(zip).digest('hex')}`);
