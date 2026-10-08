// End-to-end checks in a real Chromium (npm run e2e).
//
// Copies the extension to a temporary folder, prepends test-only stubs that
// fake chrome.identity and the Drive API (sw-stub.js) and point the popup at a
// given tab (popup-stub.js), then serves a fake drive.google.com page through
// request interception. Nothing here is shipped: scripts/files.mjs packages
// only manifest.json, managed_schema.json, LICENSE, src/ and icons/.
//
// Requires: npm install, then npx playwright install chromium.
// Screenshots are written to the temporary folder printed at the end.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'lamassu-e2e-'));
const EXT = path.join(WORK, 'ext');
const SHOTS = path.join(WORK, 'shots');

function prepareExtension() {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const p of ['manifest.json', 'managed_schema.json', 'src', 'icons']) {
    fs.cpSync(path.join(ROOT, p), path.join(EXT, p), { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, 'sw-stub.js'), path.join(EXT, 'src/background/sw-stub.js'));
  const swPath = path.join(EXT, 'src/background/sw.js');
  fs.writeFileSync(swPath, "importScripts('./sw-stub.js');\n" + fs.readFileSync(swPath, 'utf8'));
  fs.copyFileSync(path.join(__dirname, 'popup-stub.js'), path.join(EXT, 'src/popup/popup-stub.js'));
  const popPath = path.join(EXT, 'src/popup/popup.html');
  fs.writeFileSync(popPath, fs.readFileSync(popPath, 'utf8')
    .replace('<script src="popup.js">', '<script src="popup-stub.js"></script>\n  <script src="popup.js">'));
}

const DRIVE_HTML = (email) => `<!doctype html><html><head><meta charset="utf-8"><title>Drive</title><style>
 body{margin:0;font-family:Arial} header{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:#f8fafd}
 nav{position:fixed;top:64px;left:0;width:256px;bottom:0;background:#f8fafd}
 #main{position:fixed;top:64px;left:256px;right:0;bottom:0;padding:16px;background:#fff;border-radius:16px}
 h2{margin:0 0 16px;font-weight:400}</style></head><body>
 <header><b>Drive</b><input placeholder="Search in Drive" style="width:600px;padding:10px;border-radius:20px;border:0;background:#e9eef6">
 <a id="acct" href="https://accounts.google.com/SignOutOptions?hl=en" aria-label="Google Account: Me  (${email})">ME</a></header>
 <nav>My Drive</nav><div id="main" role="main"><h2>My Drive &gt; Folder</h2><div>file rows</div></div></body></html>`;

(async () => {
  prepareExtension();
  const ctx = await chromium.launchPersistentContext(path.join(WORK, 'profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1400, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let driveEmail = 'me@example.org';
  await ctx.route('https://drive.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: DRIVE_HTML(driveEmail) }));
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const pageErrors = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const results = [];
  const record = (ok, label, info) => results.push({ ok, line: `${ok ? 'PASS' : 'FAIL'}  ${label}${info ? ': ' + info : ''}` });
  const details = () => sw.evaluate(async () => chrome.tabs.sendMessage(globalThis.__lastTabId, { type: 'dv:getDetails' }));
  const badge = () => sw.evaluate(async () => chrome.action.getBadgeText({ tabId: globalThis.__lastTabId }));
  const nav = (p) => page.evaluate((p) => history.pushState({}, '', p), p);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

  async function expectLevel(label, level, re) {
    let r = null;
    for (let i = 0; i < 40; i++) {
      const d = await details().catch(() => null);
      r = d && d.result;
      if (r && r.level === level && (!re || re.test(r.reasonText))) break;
      await page.waitForTimeout(150);
    }
    const ok = !!r && r.level === level && (!re || re.test(r.reasonText));
    record(ok, label, r ? `${r.levelName}: ${r.reasonText}` : 'no result');
    return r;
  }

  await page.goto('https://drive.google.com/drive/folders/privateFolder1');
  await expectLevel('1 owner only', 'PRIVATE');
  await shot('01-private');

  await nav('/drive/folders/internalFolder1');
  await expectLevel('2 internal, after in-page navigation', 'INTERNAL');

  await nav('/drive/u/0/folders/externalFolder1');
  await expectLevel('3/4 external user and group', 'EXTERNAL', /2 addresses outside example\.org/);
  record((await badge()) === 'EXT', 'toolbar badge for external', await badge());
  await shot('03-external');

  await nav('/drive/folders/orgFolder1');
  await expectLevel('5 organization-wide (discoverable)', 'ORG_WIDE', /find and open/);

  await nav('/drive/folders/publicChild1');
  await expectLevel('6/8 public link, inherited (inferred in My Drive)', 'PUBLIC_LINK', /likely inherited/);

  await nav('/drive/folders/discoverable1');
  await expectLevel('7 public discoverable', 'PUBLIC_DISCOVERABLE');
  await shot('07-discoverable');

  await page.goBack();
  await expectLevel('11 browser Back', 'PUBLIC_LINK');

  await nav('/drive/folders/bigFolder1');
  await expectLevel('10 more than 100 permissions', 'INTERNAL', /250 people/);

  await nav('/drive/my-drive');
  await page.waitForTimeout(800);
  const display = await page.evaluate(() => getComputedStyle(document.querySelector('[data-lamassu-banner]')).display);
  record(display === 'none' && (await badge()) === '', 'F3 no banner or badge on non-folder pages', `display=${display}`);

  // 18: allow-list a partner domain, then remove it.
  await nav('/drive/folders/externalFolder1');
  await expectLevel('18 before allow-listing', 'EXTERNAL');
  await sw.evaluate(() => chrome.storage.local.set({ settings: { allowedDomains: ['other.com'] } }));
  await expectLevel('18 allow-listed partner becomes internal', 'INTERNAL', /allowed/);
  await sw.evaluate(() => chrome.storage.local.remove('settings'));
  await expectLevel('18 removed again becomes external', 'EXTERNAL');

  // 12: offline + manual refresh never shows a stale safe level.
  await sw.evaluate(() => { globalThis.__offline = true; });
  await nav('/drive/folders/discoverable1');
  await sw.evaluate(() => chrome.tabs.sendMessage(globalThis.__lastTabId, { type: 'dv:refresh' }));
  await expectLevel('12 network blocked shows Unknown', 'UNKNOWN', /could not reach/);
  await shot('12-offline');
  await sw.evaluate(() => { globalThis.__offline = false; });

  // Regression: A -> B, refresh, back to A within one poll interval.
  await nav('/drive/folders/externalFolder1');
  await expectLevel('11 quick return to previous folder after refresh', 'EXTERNAL');

  // Popup renders the permission list for the Drive tab.
  const tabId = await sw.evaluate(() => globalThis.__lastTabId);
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 600, height: 420 });
  await pop.goto(`chrome-extension://${extId}/src/popup/popup.html?tab=${tabId}`);
  await pop.waitForTimeout(800);
  await pop.screenshot({ path: path.join(SHOTS, 'popup.png'), fullPage: true });
  const rows = await pop.$$eval('#rows tr', (rs) => rs.map((r) => r.cells[3].innerText));
  record(rows.join(',') === 'External,External,Internal', 'F16/F17 popup lists external entries first', rows.join(','));
  record(await pop.$eval('#drive-row', (e) => e.hidden), 'popup hides the Drive account row when it matches');
  await pop.close();

  // Options page rejects invalid domains.
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
  await opt.fill('#allowedDomains', 'partner.org\nnot_a_domain');
  await opt.click('button[type=submit]');
  const status = await opt.textContent('#status');
  record(/not_a_domain/.test(status), 'options page rejects invalid domains', status);
  await opt.close();

  // 17: Drive shows a different account than the extension uses.
  driveEmail = 'someone@other-account.org';
  await page.goto('https://drive.google.com/drive/folders/internalFolder1');
  await expectLevel('17 account mismatch shows Unknown', 'UNKNOWN', /different account/);

  // 20 / 15: the extension's account changes; old domain and cache are discarded.
  driveEmail = 'new@second.org';
  await sw.evaluate(() => { globalThis.__token = 'tok2'; globalThis.__aboutEmail = 'new@second.org'; });
  await page.goto('https://drive.google.com/drive/folders/externalFolder1');
  await expectLevel('20/15 new account classifies against its own domain', 'EXTERNAL', /outside second\.org/);
  const session = await sw.evaluate(() => chrome.storage.session.get('identity'));
  record(session.identity && session.identity.domain === 'second.org', '20 stored domain replaced', session.identity && session.identity.domain);

  // 16: personal account.
  driveEmail = 'me@gmail.com';
  await sw.evaluate(() => { globalThis.__token = 'tok3'; globalThis.__aboutEmail = 'me@gmail.com'; });
  await page.goto('https://drive.google.com/drive/folders/internalFolder1');
  await expectLevel('16 personal account shows Unknown', 'UNKNOWN', /personal account/);

  // F15: no [role=main] anchor -> floating corner badge.
  driveEmail = 'me@example.org';
  await sw.evaluate(() => { globalThis.__token = 'tok4'; globalThis.__aboutEmail = 'me@example.org'; });
  await page.goto('https://drive.google.com/drive/folders/externalFolder1');
  await expectLevel('F15 before removing the anchor', 'EXTERNAL');
  await page.evaluate(() => document.getElementById('main').removeAttribute('role'));
  await page.waitForTimeout(1300);
  const pos = await page.evaluate(() => {
    const s = document.querySelector('[data-lamassu-banner]').style;
    return s.right + ' ' + s.bottom;
  });
  record(pos === '16px 16px', 'F15 falls back to a corner badge', pos);
  await shot('f15-fallback');

  // 13: every request was a GET to the Drive v3 API.
  const log = await sw.evaluate(() => globalThis.__fetchLog);
  const bad = log.filter((l) => !l.url.startsWith('https://www.googleapis.com/drive/v3/') || l.method !== 'GET');
  record(bad.length === 0 && log.length > 0, `13 all ${log.length} requests are GETs to drive/v3`, bad.length ? JSON.stringify(bad) : '');
  record(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));

  await ctx.close();
  console.log(results.map((r) => r.line).join('\n'));
  console.log(`\nScreenshots: ${SHOTS}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
