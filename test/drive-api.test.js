// Drive API client: pagination, errors, retries, GET-only. Uses a fake fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const DV = require('./helpers.js');

function response(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headers || {})[k] || null },
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  };
}

function setup(handler, opts) {
  const calls = [];
  const sleeps = [];
  const removed = [];
  let tokenN = 0;
  const api = DV.createDriveApi(Object.assign({
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return handler(new URL(url), init, calls.length);
    },
    getToken: async () => 'token' + ++tokenN,
    removeCachedToken: async (t) => { removed.push(t); },
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0,
  }, opts));
  return { api, calls, sleeps, removed };
}

const perm = (i, extra) => Object.assign({ id: 'p' + i, type: 'user', role: 'reader', emailAddress: `u${i}@example.org` }, extra);

test('10. reads every page of a folder with more than 100 permissions (F5)', async () => {
  const all = Array.from({ length: 250 }, (_, i) => perm(i, { permissionDetails: [{ inherited: false }] }));
  const { api, calls } = setup((url) => {
    const start = Number(url.searchParams.get('pageToken') || 0);
    const page = all.slice(start, start + 100);
    const next = start + 100 < all.length ? String(start + 100) : undefined;
    return response(200, { permissions: page, nextPageToken: next });
  });
  const perms = await api.fetchFolderPermissions('folder123');
  assert.equal(perms.length, 250);
  const permCalls = calls.filter((c) => c.url.pathname.endsWith('/permissions'));
  assert.equal(permCalls.length, 3);
  const first = permCalls[0].url;
  assert.equal(first.origin + first.pathname, 'https://www.googleapis.com/drive/v3/files/folder123/permissions');
  assert.equal(first.searchParams.get('supportsAllDrives'), 'true');
  assert.equal(first.searchParams.get('fields'),
    'nextPageToken,permissions(id,type,role,emailAddress,domain,allowFileDiscovery,deleted,permissionDetails)');
});

test('every request is GET to the Drive v3 API with no credentials or referrer (S3, S8)', async () => {
  const { api, calls } = setup(() => response(200, { user: { emailAddress: 'Me@Example.org' } }));
  assert.equal(await api.getUserEmail(), 'me@example.org');
  const c = calls[0];
  assert.equal(c.url.href, 'https://www.googleapis.com/drive/v3/about?fields=user%28emailAddress%29');
  assert.equal(c.init.method, 'GET');
  assert.equal(c.init.credentials, 'omit');
  assert.equal(c.init.redirect, 'error');
  assert.equal(c.init.referrerPolicy, 'no-referrer');
  assert.equal(c.init.headers.Authorization, 'Bearer token1');
});

test('resource keys are sent in the documented header', async () => {
  const { api, calls } = setup(() => response(200, { permissions: [perm(1, { permissionDetails: [] })] }));
  await api.listPermissions('folder123', { resourceKeys: 'folder123/0-key' });
  assert.equal(calls[0].init.headers['X-Goog-Drive-Resource-Keys'], 'folder123/0-key');
});

test('inheritance comes from permissionDetails when present (F6)', async () => {
  const { api } = setup(() => response(200, { permissions: [
    perm(1, { permissionDetails: [{ inherited: true }] }),
    perm(2, { permissionDetails: [{ inherited: false }] }),
    perm(3, { permissionDetails: [{ inherited: true }, { inherited: false }] }),
  ] }));
  const perms = await api.fetchFolderPermissions('folder123');
  assert.deepEqual(perms.map((p) => p.source), ['inherited', 'direct', 'both']);
  assert.ok(perms.every((p) => !p.sourceInferred));
  assert.ok(perms.every((p) => !('details' in p)));
});

test('without permissionDetails, inheritance is inferred from the parent folder', async () => {
  const { api, calls } = setup((url) => {
    if (url.pathname.endsWith('/files/child1/permissions')) {
      return response(200, { permissions: [
        { id: 'o', type: 'user', role: 'owner', emailAddress: 'o@example.org' },
        { id: 'anyoneWithLink', type: 'anyone', role: 'reader' },
        { id: 'p1', type: 'user', role: 'writer', emailAddress: 'a@example.org' },
      ] });
    }
    if (url.pathname.endsWith('/files/child1')) return response(200, { parents: ['parent1'] });
    if (url.pathname.endsWith('/files/parent1/permissions')) {
      return response(200, { permissions: [
        { id: 'o', type: 'user', role: 'owner' },
        { id: 'anyoneWithLink', type: 'anyone', role: 'reader' },
        { id: 'p1', type: 'user', role: 'reader' },
      ] });
    }
    return response(404, { error: {} });
  });
  const perms = await api.fetchFolderPermissions('child1');
  assert.deepEqual(perms.map((p) => [p.id, p.source]), [['o', 'direct'], ['anyoneWithLink', 'inherited'], ['p1', 'direct']]);
  assert.deepEqual(perms.map((p) => !!p.sourceInferred), [false, true, true], 'inferred sources are flagged');
  assert.ok(calls.every((c) => c.init.method === 'GET'));
});

test('if the parent cannot be read, inheritance is unknown rather than guessed', async () => {
  const { api } = setup((url) => {
    if (url.pathname.endsWith('/permissions')) return response(200, { permissions: [perm(1)] });
    return response(403, { error: { errors: [{ reason: 'insufficientFilePermissions' }] } });
  });
  const perms = await api.fetchFolderPermissions('child1');
  assert.equal(perms[0].source, 'unknown');
});

test('F20: 401 renews the token once, then fails as auth_expired', async () => {
  const ok = setup((u, init, n) => (n === 1 ? response(401, {}) : response(200, { user: { emailAddress: 'a@example.org' } })));
  assert.equal(await ok.api.getUserEmail(), 'a@example.org');
  assert.deepEqual(ok.removed, ['token1']);
  assert.equal(ok.calls[1].init.headers.Authorization, 'Bearer token2');

  const bad = setup(() => response(401, {}));
  await assert.rejects(bad.api.getUserEmail(), { code: 'auth_expired' });
  assert.equal(bad.calls.length, 2);
});

test('F21: 429 and rate-limit 403 back off exponentially, then succeed', async () => {
  const { api, sleeps } = setup((u, init, n) => {
    if (n === 1) return response(429, {});
    if (n === 2) return response(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } });
    if (n === 3) return response(503, {});
    return response(200, { user: { emailAddress: 'a@example.org' } });
  });
  await api.getUserEmail();
  assert.deepEqual(sleeps, [500, 1000, 2000]);
});

test('F21: Retry-After is honoured', async () => {
  const { api, sleeps } = setup((u, init, n) => (n === 1 ? response(429, {}, { 'Retry-After': '3' }) : response(200, { user: { emailAddress: 'a@example.org' } })));
  await api.getUserEmail();
  assert.deepEqual(sleeps, [3000]);
});

test('F21: persistent rate limiting gives up as rate_limited', async () => {
  const { api, calls } = setup(() => response(429, {}));
  await assert.rejects(api.getUserEmail(), { code: 'rate_limited' });
  assert.equal(calls.length, 5);
});

test('F21: 403 and 404 map to forbidden and not_found without retrying', async () => {
  const f = setup(() => response(403, { error: { errors: [{ reason: 'insufficientFilePermissions' }] } }));
  await assert.rejects(f.api.listPermissions('folder1'), { code: 'forbidden' });
  assert.equal(f.calls.length, 1);
  const n = setup(() => response(404, { error: { errors: [{ reason: 'notFound' }] } }));
  await assert.rejects(n.api.listPermissions('folder1'), { code: 'not_found' });
});

test('12. network failure is reported, never treated as success', async () => {
  const { api } = setup(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.listPermissions('folder1'), { code: 'network' });
});

test('timeouts abort the request', async () => {
  const { api } = setup((u, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), { timeoutMs: 20 });
  await assert.rejects(api.listPermissions('folder1'), { code: 'timeout' });
});

test('malformed IDs and paths are rejected before any request', async () => {
  const { api, calls } = setup(() => response(200, {}));
  await assert.rejects(api.listPermissions('../../evil'), { code: 'bad_request' });
  await assert.rejects(api.listPermissions('a?b=c'), { code: 'bad_request' });
  assert.throws(() => api.buildUrl('//evil.example/x'), { code: 'bad_request' });
  assert.equal(calls.length, 0);
});

test('unexpected response bodies are errors', async () => {
  const { api } = setup(() => response(200, { permissions: 'nope' }));
  await assert.rejects(api.listPermissions('folder1'), { code: 'bad_response' });
});

test('the parent lookup starts in parallel with the permission listing', async () => {
  const { api, calls } = setup((url) => {
    if (url.pathname.endsWith('/files/child1')) return response(200, { parents: [] });
    return response(200, { permissions: [perm(1)] });
  });
  await api.fetchFolderPermissions('child1');
  assert.ok(calls[0].url.pathname.endsWith('/files/child1'), 'files.get is issued first, without waiting');
  assert.ok(calls[1].url.pathname.endsWith('/files/child1/permissions'));
});

test('the parent lookup is a single attempt, never retried', async () => {
  const { api, calls, sleeps } = setup((url) => {
    if (url.pathname.endsWith('/files/child1/permissions')) return response(200, { permissions: [perm(1)] });
    return response(429, {});
  });
  const perms = await api.fetchFolderPermissions('child1');
  assert.equal(perms[0].source, 'unknown');
  assert.equal(calls.filter((c) => c.url.pathname.endsWith('/files/child1')).length, 1);
  assert.deepEqual(sleeps, []);
});

test('N1: retries stop at the overall time budget', async () => {
  let clock = 0;
  const { api, sleeps } = setup(() => response(503, {}), {
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    budgetMs: 2000,
  });
  await assert.rejects(api.getUserEmail(), { code: 'http_error' });
  assert.ok(clock < 2000, `waited ${clock} ms`);
});

test('N1: a request is never started after the budget has run out', async () => {
  let clock = 0;
  const { api, calls } = setup(() => { clock += 5000; return response(200, { permissions: [perm(1)], nextPageToken: 'n' }); }, {
    now: () => clock,
    budgetMs: 8000,
  });
  await assert.rejects(api.listPermissions('folder1', { deadline: 8000 }), { code: 'timeout' });
  assert.equal(calls.length, 2);
});
