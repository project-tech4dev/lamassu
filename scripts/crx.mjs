// Builds a signed CRX and its update manifest for self-hosting and
// force-install from the Admin console, bypassing the Chrome Web Store.
//
//   npm run crx -- https://example.org/lamassu/
//
// Writes dist/lamassu-visibility-guardian-<version>.crx and dist/updates.xml.
// Upload both to that URL. In the Admin console, add the extension by ID with
// the update URL <base>/updates.xml.
//
// The private key is read from $LAMASSU_KEY, or ~/.lamassu/extension-key.pem.
// It must match the "key" in manifest.json so the ID stays the same.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './files.mjs';
import { buildPackageZip, readVersion } from './lib/zip.mjs';
import { buildCrx, extensionId, publicKeyDer, updateManifest } from './lib/crx.mjs';

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const base = process.argv[2];
if (!base || !/^https:\/\/[^\s'"<>]+$/.test(base)) {
  die('Usage: npm run crx -- https://<host>/<path>/\nThe URL where the .crx and updates.xml will be hosted (HTTPS).');
}
const baseUrl = base.endsWith('/') ? base : base + '/';

const keyPath = process.env.LAMASSU_KEY || join(homedir(), '.lamassu', 'extension-key.pem');
let pem;
try {
  pem = readFileSync(keyPath, 'utf8');
} catch {
  die(`Private key not found at ${keyPath}. Set LAMASSU_KEY to its path.`);
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const expectedId = extensionId(Buffer.from(manifest.key, 'base64'));
if (!publicKeyDer(pem).equals(Buffer.from(manifest.key, 'base64'))) {
  die(`${keyPath} does not match the "key" in manifest.json (ID ${expectedId}).`);
}

const version = readVersion();
const { zip, count } = buildPackageZip();
const { crx, id } = buildCrx(zip, pem);
const crxName = `lamassu-visibility-guardian-${version}.crx`;

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist', crxName), crx);
writeFileSync(join(ROOT, 'dist', 'updates.xml'), updateManifest(id, version, baseUrl + crxName));

console.log(`dist/${crxName}  ${count} files  ${crx.length} bytes`);
console.log(`sha256 ${createHash('sha256').update(crx).digest('hex')}`);
console.log('dist/updates.xml');
console.log(`\nExtension ID: ${id}`);
console.log(`Update URL:   ${baseUrl}updates.xml`);
