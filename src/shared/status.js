// Pure decision logic used by the service worker, kept separate so it can be
// unit-tested: which account checks block a lookup (U3, U4), whether a cached
// entry may be served (F7), and which cache entries to evict (S7).
(function (root) {
  'use strict';
  const DV = root.DV || (root.DV = {});

  // Returns an error code that must stop the lookup, or null to proceed.
  // identity: { email, domain } from about.get; driveEmail: from Drive's page.
  function accountBlock(identity, driveEmail) {
    if (!identity || !identity.email || !identity.domain) return 'identity_failed';
    // U3: personal accounts never get an internal domain.
    if (DV.domain.isPersonalDomain(identity.domain)) return 'personal_account';
    // U4: never show a level computed for a different account than Drive shows.
    if (typeof driveEmail !== 'string' || !driveEmail) return 'account_unconfirmed';
    if (driveEmail.toLowerCase() !== identity.email.toLowerCase()) return 'account_mismatch';
    return null;
  }

  // A cached entry is served only for the same account and within the TTL.
  function isCacheHit(entry, accountEmail, ttlMs, now) {
    return !!entry && ttlMs > 0 && entry.account === accountEmail &&
      typeof entry.fetchedAt === 'number' && now - entry.fetchedAt < ttlMs && Array.isArray(entry.permissions);
  }

  // index: { cacheKey: fetchedAt }. Returns the keys to delete: everything
  // expired, plus the oldest entries beyond maxEntries.
  function keysToEvict(index, ttlMs, maxEntries, now) {
    const keys = Object.keys(index || {});
    const expired = keys.filter((k) => !(now - index[k] < ttlMs));
    const live = keys.filter((k) => now - index[k] < ttlMs).sort((a, b) => index[a] - index[b]);
    const overflow = live.slice(0, Math.max(0, live.length - maxEntries));
    return expired.concat(overflow);
  }

  // Error codes that have a user-facing reason; anything else is reported as
  // the given fallback so the banner never shows a raw key.
  function knownErrorCode(code, fallback) {
    return DV.strings && DV.strings.MESSAGES && Object.prototype.hasOwnProperty.call(DV.strings.MESSAGES, 'error.' + code)
      ? code : fallback;
  }

  DV.status = { accountBlock, isCacheHit, keysToEvict, knownErrorCode };

  if (typeof module === 'object' && module.exports) module.exports = DV.status;
})(globalThis);
