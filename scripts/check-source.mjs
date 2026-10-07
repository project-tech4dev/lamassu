// Static checks over the packaged source for the security requirements
// (S3, S4, S5, S8 and acceptance test 14). Exits non-zero on any violation.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, packagedFiles } from './files.mjs';

const problems = [];
const fail = (file, msg) => problems.push(`${file}: ${msg}`);

// URLs allowed to appear anywhere in shipped source, each with its reason.
const ALLOWED_URLS = [
  'https://www.googleapis.com/drive/v3', // the only API endpoint (S3)
  'https://www.googleapis.com/drive/v3/', // CSP connect-src and host permission
  'https://www.googleapis.com/drive/v3/*', // host permission (S4)
  'https://www.googleapis.com/auth/drive.metadata.readonly', // OAuth scope identifier (S1)
  'https://drive.google.com', // origin check of the current page, never fetched
  'https://drive.google.com/', // sender origin check, never fetched
  'https://drive.google.com/*', // content script match pattern (S4)
  'http://www.w3.org/2000/svg', // SVG XML namespace identifier, never fetched
];

const FORBIDDEN = [
  [/\beval\s*\(/, 'eval('],
  [/new\s+Function\b/, 'new Function'],
  [/\bFunction\s*\(\s*['"`]/, 'Function constructor'],
  [/sendBeacon/, 'sendBeacon'],
  [/WebSocket/, 'WebSocket'],
  [/EventSource/, 'EventSource'],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/, 'HTML string injection'],
  [/setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/, 'string timer'],
  [/chrome\.storage\.sync/, 'chrome.storage.sync'],
  [/console\.(log|info|warn|error|debug)/, 'console logging (S7)'],
  [/\bimport\s*\(/, 'dynamic import'],
  [/method\s*:\s*['"`](?!GET['"`])/i, 'non-GET HTTP method (S8)'],
];

const files = packagedFiles();
for (const rel of files) {
  if (!/\.(js|json|html|css)$/.test(rel)) continue;
  const text = readFileSync(join(ROOT, rel), 'utf8');

  for (const [re, label] of FORBIDDEN) {
    if (re.test(text)) fail(rel, `forbidden: ${label}`);
  }
  for (const m of text.match(/\b(?:https?|wss?|ftp):\/\/[^\s"'`)<>\\;,]*/g) || []) {
    if (!ALLOWED_URLS.includes(m)) fail(rel, `URL not on allow list: ${m}`);
  }
  if (rel.endsWith('.html')) {
    if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(text)) fail(rel, 'inline <script>');
    if (/\son[a-z]+\s*=/i.test(text)) fail(rel, 'inline event handler');
    if (/\sstyle\s*=/i.test(text)) fail(rel, 'inline style attribute');
    for (const m of text.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/gi)) {
      if (/^[a-z]+:|^\/\//i.test(m[1])) fail(rel, `remote resource: ${m[1]}`);
    }
  }
  if (rel.endsWith('.js') && /\bfetch\s*\(/.test(text) && !['src/background/sw.js', 'src/background/drive-api.js'].includes(rel)) {
    fail(rel, 'fetch() outside the service worker');
  }
}

// Manifest shape (S4, S5).
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (manifest.manifest_version !== 3) fail('manifest.json', 'must be Manifest V3');
if (!same([...manifest.permissions].sort(), ['identity', 'storage'])) fail('manifest.json', `permissions must be exactly identity, storage (got ${manifest.permissions})`);
if (manifest.optional_permissions || manifest.optional_host_permissions) fail('manifest.json', 'no optional permissions allowed');
if (!same(manifest.host_permissions, ['https://www.googleapis.com/drive/v3/*'])) fail('manifest.json', 'host_permissions must be the Drive v3 API only');
if (!same(manifest.oauth2 && manifest.oauth2.scopes, ['https://www.googleapis.com/auth/drive.metadata.readonly'])) fail('manifest.json', 'OAuth scope must be drive.metadata.readonly only');
for (const cs of manifest.content_scripts || []) {
  if (!same(cs.matches, ['https://drive.google.com/*'])) fail('manifest.json', 'content script must match drive.google.com only');
  if (cs.all_frames) fail('manifest.json', 'content script must not run in all frames');
}
if (manifest.externally_connectable) fail('manifest.json', 'externally_connectable not allowed');
if (manifest.web_accessible_resources) fail('manifest.json', 'web_accessible_resources not allowed');
const csp = manifest.content_security_policy && manifest.content_security_policy.extension_pages;
if (!csp || !/script-src 'self'(;|$)/.test(csp) || /unsafe|wasm/.test(csp)) fail('manifest.json', 'CSP must be strict (script-src \'self\' only)');
if (/oauth2/.test(JSON.stringify(manifest)) && /REPLACE_WITH/.test(manifest.oauth2.client_id) && process.argv.includes('--release')) {
  fail('manifest.json', 'oauth2.client_id is still the placeholder');
}

if (problems.length) {
  process.stderr.write(problems.map((p) => '  x ' + p).join('\n') + '\n');
  process.stderr.write(`\n${problems.length} problem(s) found.\n`);
  process.exit(1);
}
process.stdout.write(`Source checks passed (${files.length} packaged files).\n`);
