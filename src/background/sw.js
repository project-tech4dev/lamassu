// Service worker: authentication, identity, caching and classification.
// Holds the only code path that talks to the network (drive-api.js).
importScripts(
  '../shared/strings.js',
  '../shared/levels.js',
  '../shared/domain.js',
  '../shared/classify.js',
  '../shared/settings.js',
  './drive-api.js'
);

const { DriveError, driveErrorCode } = DV;
const CACHE_PREFIX = 'perm:';
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
  if (!token) throw new DriveError('auth_required');
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

const folderInflight = new Map();

async function writeCache(key, entry) {
  await chrome.storage.session.set({ [key]: entry });
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length > MAX_CACHE_ENTRIES) {
    keys.sort((a, b) => (all[a].fetchedAt || 0) - (all[b].fetchedAt || 0));
    await chrome.storage.session.remove(keys.slice(0, keys.length - MAX_CACHE_ENTRIES));
  }
}

async function getFolderData(folderId, resourceKey, identity, settings, force) {
  const key = CACHE_PREFIX + folderId;
  const ttl = settings.cacheMinutes * 60 * 1000;

  if (!force && ttl > 0) {
    const hit = (await chrome.storage.session.get(key))[key];
    if (hit && hit.account === identity.email && Date.now() - hit.fetchedAt < ttl) {
      return { permissions: hit.permissions, fetchedAt: hit.fetchedAt, fromCache: true };
    }
  }

  const flightKey = identity.email + '|' + folderId;
  if (!force && folderInflight.has(flightKey)) return folderInflight.get(flightKey);

  const p = (async () => {
    const permissions = await api.fetchFolderPermissions(folderId, resourceKey);
    const entry = { account: identity.email, fetchedAt: Date.now(), permissions };
    if (ttl > 0) await writeCache(key, entry);
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
  const levelName = DV.strings.levelName(level);
  const reasonText = DV.strings.describeReason(reason);
  return Object.assign({
    level,
    levelName,
    reasonText,
    code: reason && reason.key && reason.key.startsWith('error.') ? reason.key.slice(6) : null,
    colors: DV.levels.colorsFor(level, settings),
    emphasis: DV.levels.isEmphasized(level, settings),
    icon: DV.levels.iconFor(level),
    checkedAt: Date.now(),
    fetchedAt: null,
    fromCache: false,
    accountEmail: null,
    driveEmail: null,
    userDomain: null,
    entries: [],
  }, extra || {});
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
    return unknown(driveErrorCode(e) === 'auth_required' ? 'auth_required' : 'identity_failed', settings, { driveEmail });
  }
  const base = { accountEmail: identity.email, driveEmail, userDomain: identity.domain };

  // U3: personal accounts never get an internal domain.
  if (DV.domain.isPersonalDomain(identity.domain)) return unknown('personal_account', settings, base);
  // U4: never show a level computed for a different account than Drive shows.
  if (!driveEmail) return unknown('account_unconfirmed', settings, base);
  if (driveEmail !== identity.email) return unknown('account_mismatch', settings, base);

  let data;
  try {
    data = await getFolderData(folderId, resourceKey, identity, settings, !!msg.force);
  } catch (e) {
    await chrome.storage.session.remove(CACHE_PREFIX + folderId);
    return unknown(driveErrorCode(e), settings, base);
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

function fromDrive(sender) {
  return sender.id === chrome.runtime.id && !!sender.tab && typeof sender.url === 'string' &&
    sender.url.startsWith(DRIVE_ORIGIN);
}

function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(''));
}

function reply(promise, sendResponse, fallback) {
  promise.then(sendResponse, () => sendResponse(fallback()));
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'dv:getStatus' && fromDrive(sender)) {
    const tabId = sender.tab.id;
    return reply(
      getStatus(msg).then((r) => { setBadge(tabId, r); return r; }),
      sendResponse,
      () => unknown('internal_error', null)
    );
  }
  if (msg.type === 'dv:clear' && fromDrive(sender)) {
    setBadge(sender.tab.id, null);
    return false;
  }
  if (msg.type === 'dv:signIn' && fromExtensionPage(sender)) {
    return reply(signIn(), sendResponse, () => ({ ok: false, code: 'internal_error' }));
  }
  return false;
});

// U2 / acceptance test 20: a Chrome sign-in change discards the domain and cache.
chrome.identity.onSignInChanged.addListener(() => {
  clearAccountData();
});
