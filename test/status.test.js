// Account checks (U3, U4), cache rules (F7, S7) and error-code handling used by
// the service worker's getStatus.
const test = require('node:test');
const assert = require('node:assert/strict');
const DV = require('./helpers.js');
const { accountBlock, isCacheHit, keysToEvict, knownErrorCode } = DV.status;

const me = { email: 'me@example.org', domain: 'example.org' };

test('U4: matching Drive account proceeds, case-insensitively', () => {
  assert.equal(accountBlock(me, 'me@example.org'), null);
  assert.equal(accountBlock(me, 'Me@Example.ORG'), null);
});

test('U4 / test 17: a different Drive account is blocked', () => {
  assert.equal(accountBlock(me, 'other@example.org'), 'account_mismatch');
  assert.equal(accountBlock(me, 'me@example.org.evil.com'), 'account_mismatch');
});

test('U4: an unknown Drive account is blocked, never assumed', () => {
  assert.equal(accountBlock(me, null), 'account_unconfirmed');
  assert.equal(accountBlock(me, ''), 'account_unconfirmed');
  assert.equal(accountBlock(me, undefined), 'account_unconfirmed');
});

test('U3 / test 16: personal accounts are blocked before anything else', () => {
  assert.equal(accountBlock({ email: 'me@gmail.com', domain: 'gmail.com' }, 'me@gmail.com'), 'personal_account');
  assert.equal(accountBlock({ email: 'me@googlemail.com', domain: 'googlemail.com' }, 'me@googlemail.com'), 'personal_account');
});

test('missing identity is blocked', () => {
  assert.equal(accountBlock(null, 'me@example.org'), 'identity_failed');
  assert.equal(accountBlock({ email: 'me@example.org' }, 'me@example.org'), 'identity_failed');
});

test('test 20: cached results are served only to the account that fetched them', () => {
  const entry = { account: 'me@example.org', fetchedAt: 1000, permissions: [] };
  assert.ok(isCacheHit(entry, 'me@example.org', 60000, 2000));
  assert.ok(!isCacheHit(entry, 'new@second.org', 60000, 2000));
});

test('cache entries expire, and caching can be turned off', () => {
  const entry = { account: 'me@example.org', fetchedAt: 1000, permissions: [] };
  assert.ok(!isCacheHit(entry, 'me@example.org', 60000, 61000));
  assert.ok(!isCacheHit(entry, 'me@example.org', 0, 1000));
  assert.ok(!isCacheHit(undefined, 'me@example.org', 60000, 1000));
  assert.ok(!isCacheHit({ account: 'me@example.org', fetchedAt: 1000 }, 'me@example.org', 60000, 2000), 'malformed entry');
});

test('S7: eviction removes expired entries and the oldest beyond the limit', () => {
  const index = { 'perm:a': 100, 'perm:b': 9000, 'perm:c': 9500, 'perm:d': 9900 };
  assert.deepEqual(keysToEvict(index, 5000, 10, 10000), ['perm:a']);
  assert.deepEqual(keysToEvict(index, 5000, 2, 10000).sort(), ['perm:a', 'perm:b']);
  assert.deepEqual(keysToEvict({}, 5000, 2, 10000), []);
});

test('known error codes pass through, unknown ones fall back', () => {
  assert.equal(knownErrorCode('network', 'identity_failed'), 'network');
  assert.equal(knownErrorCode('rate_limited', 'identity_failed'), 'rate_limited');
  assert.equal(knownErrorCode('something_new', 'identity_failed'), 'identity_failed');
});
