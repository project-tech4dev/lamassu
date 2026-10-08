// TEST ONLY: fake identity + fake Drive API for the E2E harness.
globalThis.__fetchLog = [];
globalThis.__token = 'tok1';
globalThis.__aboutEmail = 'me@example.org';
globalThis.__offline = false;
chrome.identity.getAuthToken = async () => ({ token: globalThis.__token, grantedScopes: [] });
chrome.identity.removeCachedAuthToken = async () => {};
chrome.runtime.onMessage.addListener((m, s) => { if (s.tab) globalThis.__lastTabId = s.tab.id; return false; });
const owner = { id: 'o', type: 'user', role: 'owner', emailAddress: 'me@example.org' };
const big = Array.from({ length: 250 }, (_, i) => ({ id: 'u' + i, type: 'user', role: 'reader', emailAddress: `u${i}@example.org` }));
const DATA = {
  privateFolder1: [owner],
  internalFolder1: [owner, { id: 'a', type: 'user', role: 'writer', emailAddress: 'colleague@example.org' }],
  externalFolder1: [owner, { id: 'x', type: 'user', role: 'writer', emailAddress: 'x@other.com' }, { id: 'y', type: 'group', role: 'reader', emailAddress: 'team@other.com' }],
  publicChild1: [owner, { id: 'anyoneWithLink', type: 'anyone', role: 'reader', allowFileDiscovery: false }],
  publicParent1: [owner, { id: 'anyoneWithLink', type: 'anyone', role: 'reader', allowFileDiscovery: false }],
  discoverable1: [owner, { id: 'anyone', type: 'anyone', role: 'reader', allowFileDiscovery: true }],
  orgFolder1: [owner, { id: 'd', type: 'domain', role: 'reader', domain: 'example.org', allowFileDiscovery: true }],
  bigFolder1: [owner, ...big],
};
const PARENTS = { publicChild1: ['publicParent1'] };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  globalThis.__fetchLog.push({ url: String(url), method: init && init.method });
  if (globalThis.__offline) throw new TypeError('Failed to fetch');
  const u = new URL(url);
  await new Promise((r) => setTimeout(r, 40));
  if (u.pathname === '/drive/v3/about') return json(200, { user: { emailAddress: globalThis.__aboutEmail } });
  let m = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(u.pathname);
  if (m) {
    const all = DATA[m[1]];
    if (!all) return json(404, { error: { errors: [{ reason: 'notFound' }] } });
    const start = Number(u.searchParams.get('pageToken') || 0);
    const size = Number(u.searchParams.get('pageSize'));
    const next = start + size < all.length ? String(start + size) : undefined;
    return json(200, { permissions: all.slice(start, start + size), nextPageToken: next });
  }
  m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if (m) return json(200, { parents: PARENTS[m[1]] || [] });
  return json(404, {});
};
