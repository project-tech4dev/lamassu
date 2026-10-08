// Service worker: authentication, identity, caching and classification.
// Holds the only code path that talks to the network (drive-api.js).
importScripts(
  '../shared/strings.js',
  '../shared/levels.js',
  '../shared/domain.js',
  '../shared/classify.js',
  '../shared/settings.js',
  '../shared/status.js',
  './drive-api.js'
);

const { DriveError, driveErrorCode } = DV;
const CACHE_PREFIX = 'perm:';
const CACHE_INDEX_KEY = 'permIndex';
const IDENTITY_KEY = 'identity';
const MAX_CACHE_ENTRIES = 200;
const DRIVE_ORIGIN = 'https://drive.google.com/';
const FOLDER_ID_RE = /^[A-Za-z0-9_-]{5,200}$/;
const RESOURCE_KEY_RE = /^[A-Za-z0-9_-]{1,200}$/;

// ---- Auth ------------------------------------------------------------------

async function getToken(interactive) {
  let result;
  try {
    result = await chrome.identity.getAuthToken({ interactive: !!interactive });
  } catch (e) {
    // Keep Chrome's message (e.g. "bad client id", "The user is not signed in.")
    // so the popup can show why sign-in failed. It contains no email addresses.
    const err = new DriveError('auth_required');
    err.detail = String((e && e.message) || e).slice(0, 300);
    throw err;
  }
  const token = typeof result === 'string' ? result : result && result.token;
  if (!token) {
    const err = new DriveError('auth_required');
    err.detail = 'Chrome returned no token';
    throw err;
  }
  return token;
}

const api = DV.createDriveApi({
  fetch: (url, init) => fetch(url, init),
  getToken: () => getToken(false),
  removeCachedToken: (token) => chrome.identity.removeCachedAuthToken({ token }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

// ---- Identity (U1, U2) -----------------------------------------------------

// A short hash of the current token, so a new token (renewal or a different
// account) triggers a fresh about.get. The token itself is never stored.
async function tokenTag(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

let identityInflight = null;

async function ensureIdentity() {
  if (identityInflight) return identityInflight;
  identityInflight = (async () => {
    const token = await getToken(false);
    const tag = await tokenTag(token);
    const stored = (await chrome.storage.session.get(IDENTITY_KEY))[IDENTITY_KEY];
    if (stored && stored.tokenTag === tag) return stored;

    const email = await api.getUserEmail();
    const domain = DV.domain.domainOfEmail(email);
    if (!domain) throw new DriveError('identity_failed');
    if (stored && stored.email !== email) await clearAccountData();
    const identity = { email, domain, tokenTag: tag };
    await chrome.storage.session.set({ [IDENTITY_KEY]: identity });
    return identity;
  })();
  try {
    return await identityInflight;
  } finally {
    identityInflight = null;
  }
}

// Clears the stored domain and every cached result (U2, S7), then tells open
// Drive tabs to re-check by bumping a counter in local storage (no PII).
async function clearAccountData() {
  folderInflight.clear();
  await chrome.storage.session.clear();
  await chrome.storage.local.set({ epoch: Date.now() });
}

// ---- Cache (F7) ------------------------------------------------------------
// Caching is an optimisation: any storage failure is ignored so it can never
// turn a successful lookup into Unknown. A small index ({key: fetchedAt}) is
// kept so eviction never has to read every cached permission list.

const folderInflight = new Map();

async function writeCache(key, entry, ttlMs) {
  try {
    await chrome.storage.session.set({ [key]: entry });
    const index = (await chrome.storage.session.get(CACHE_INDEX_KEY))[CACHE_INDEX_KEY] || {};
    index[key] = entry.fetchedAt;
    const evict = DV.status.keysToEvict(index, ttlMs, MAX_CACHE_ENTRIES, Date.now());
    for (const k of evict) delete index[k];
    if (evict.length) await chrome.storage.session.remove(evict);
    await chrome.storage.session.set({ [CACHE_INDEX_KEY]: index });
  } catch (e) {
    // Quota or storage error: carry on without caching this folder.
  }
}

async function removeCache(key) {
  try {
    await chrome.storage.session.remove(key);
  } catch (e) {
    // Nothing else to do.
  }
}

async function getFolderData(folderId, resourceKey, identity, settings, force) {
  const key = CACHE_PREFIX + folderId;
  const ttl = settings.cacheMinutes * 60 * 1000;

  if (!force && ttl > 0) {
    const hit = (await chrome.storage.session.get(key))[key];
    if (DV.status.isCacheHit(hit, identity.email, ttl, Date.now())) {
      return { permissions: hit.permissions, fetchedAt: hit.fetchedAt, fromCache: true };
    }
    if (hit) await removeCache(key);
  }

  const flightKey = identity.email + '|' + folderId;
  if (!force && folderInflight.has(flightKey)) return folderInflight.get(flightKey);

  const p = (async () => {
    const permissions = await api.fetchFolderPermissions(folderId, resourceKey);
    const entry = { account: identity.email, fetchedAt: Date.now(), permissions };
    if (ttl > 0) await writeCache(key, entry, ttl);
    return { permissions, fetchedAt: entry.fetchedAt, fromCache: false };
  })();
  folderInflight.set(flightKey, p);
  try {
    return await p;
  } finally {
    if (folderInflight.get(flightKey) === p) folderInflight.delete(flightKey);
  }
}

// ---- Status ----------------------------------------------------------------

function buildResult(level, reason, settings, extra) {
  const code = reason && reason.key && reason.key.startsWith('error.') ? reason.key.slice(6) : null;
  return DV.levels.makeResult(level, DV.strings.describeReason(reason), settings, Object.assign({ code }, extra));
}

function unknown(code, settings, extra) {
  return buildResult('UNKNOWN', { key: 'error.' + code }, settings, extra);
}

async function getStatus(msg) {
  const settings = (await DV.settings.load()).values;
  const folderId = msg.folderId;
  const resourceKey = typeof msg.resourceKey === 'string' && RESOURCE_KEY_RE.test(msg.resourceKey) ? msg.resourceKey : null;
  const driveEmail = typeof msg.driveEmail === 'string' ? msg.driveEmail.toLowerCase() : null;
  if (typeof folderId !== 'string' || !FOLDER_ID_RE.test(folderId)) return unknown('bad_request', settings);

  let identity;
  try {
    identity = await ensureIdentity();
  } catch (e) {
    // Keep the real cause (offline, rate-limited, sign-in needed, ...).
    return unknown(DV.status.knownErrorCode(driveErrorCode(e), 'identity_failed'), settings,
      { driveEmail, detail: (e && e.detail) || '' });
  }
  const base = { accountEmail: identity.email, driveEmail, userDomain: identity.domain };

  const block = DV.status.accountBlock(identity, driveEmail);
  if (block) return unknown(block, settings, base);

  let data;
  try {
    data = await getFolderData(folderId, resourceKey, identity, settings, !!msg.force);
  } catch (e) {
    await removeCache(CACHE_PREFIX + folderId);
    return unknown(DV.status.knownErrorCode(driveErrorCode(e), 'internal_error'), settings, base);
  }

  const c = DV.classify(data.permissions, { userDomain: identity.domain, allowedDomains: settings.allowedDomains });
  return buildResult(c.level, c.reason, settings, Object.assign(base, {
    entries: c.entries,
    fetchedAt: data.fetchedAt,
    fromCache: data.fromCache,
  }));
}

async function signIn() {
  try {
    await getToken(true);
    await ensureIdentity();
    return { ok: true };
  } catch (e) {
    return { ok: false, code: driveErrorCode(e), detail: (e && e.detail) || '' };
  }
}

// ---- Toolbar badge ---------------------------------------------------------

async function setBadge(tabId, result) {
  try {
    const text = result ? DV.levels.badgeFor(result.level) : '';
    await chrome.action.setBadgeText({ tabId, text });
    if (result && text) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: result.colors.bg });
      await chrome.action.setBadgeTextColor({ tabId, color: result.colors.fg });
    }
    await chrome.action.setTitle({
      tabId,
      title: result ? result.levelName + ': ' + result.reasonText : DV.strings.t('popup.title'),
    });
  } catch (e) {
    // The tab may have closed; nothing to do.
  }
}

// ---- Messaging -------------------------------------------------------------
// Messages (all objects with a string `type`):
//   content -> sw     dv:getStatus {folderId, resourceKey, driveEmail, force} -> result
//   content -> sw     dv:clear                                              (no reply)
//   popup   -> sw     dv:signIn                                             -> {ok, code, detail}
//   popup   -> tab    dv:getDetails / dv:refresh                            -> {folder, result}
// `result` is always built by DV.levels.makeResult.

function fromDrive(sender) {
  return sender.id === chrome.runtime.id && !!sender.tab && typeof sender.url === 'string' &&
    sender.url.startsWith(DRIVE_ORIGIN);
}

function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(''));
}

// Unexpected exceptions are reported with their message (never an email
// address: none of this code puts one in an error) so they can be diagnosed
// from the popup, since S7 rules out logging.
function errorDetail(e) {
  return String((e && e.message) || e || '').slice(0, 200);
}

function reply(promise, sendResponse, fallback) {
  promise.then(sendResponse, (e) => sendResponse(fallback(errorDetail(e))));
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'dv:getStatus' && fromDrive(sender)) {
    const tabId = sender.tab.id;
    return reply(
      getStatus(msg).then((r) => { setBadge(tabId, r); return r; }),
      sendResponse,
      (detail) => unknown('internal_error', null, { detail })
    );
  }
  if (msg.type === 'dv:clear' && fromDrive(sender)) {
    setBadge(sender.tab.id, null);
    return false;
  }
  if (msg.type === 'dv:signIn' && fromExtensionPage(sender)) {
    return reply(signIn(), sendResponse, (detail) => ({ ok: false, code: 'internal_error', detail }));
  }
  return false;
});

// U2 / acceptance test 20: a Chrome sign-in change discards the domain and cache.
chrome.identity.onSignInChanged.addListener(() => {
  clearAccountData().catch(() => {});
});
