// Classification of folders by who can access them.
const test = require('node:test');
const assert = require('node:assert/strict');
const DV = require('./helpers.js');
const { classify } = DV;
const { describeReason } = DV.strings;

const ctx = { userDomain: 'example.org', allowedDomains: [] };
const owner = { id: 'o1', type: 'user', role: 'owner', emailAddress: 'owner@example.org', source: 'direct' };
const user = (email, extra) => Object.assign({ id: email, type: 'user', role: 'writer', emailAddress: email, source: 'direct' }, extra);
const text = (r) => DV.strings.levelName(r.level) + ': ' + describeReason(r.reason);

test('owner only is Private', () => {
  const r = classify([owner], ctx);
  assert.equal(r.level, 'PRIVATE');
  assert.equal(text(r), 'Private: only the owner has access');
});

test('one address on own domain is Internal', () => {
  const r = classify([owner, user('a@example.org')], ctx);
  assert.equal(r.level, 'INTERNAL');
  assert.equal(text(r), 'Internal: shared with 1 person or group at example.org');
});

test('one address on a different domain is External', () => {
  const r = classify([owner, user('a@example.org'), user('x@other.com'), user('y@other.com')], ctx);
  assert.equal(r.level, 'EXTERNAL');
  assert.equal(text(r), 'External: shared with 2 addresses outside example.org');
});

test('group on a different domain is External', () => {
  const r = classify([owner, { id: 'g', type: 'group', role: 'reader', emailAddress: 'team@partner.org' }], ctx);
  assert.equal(r.level, 'EXTERNAL');
});

test('whole organization, by link and discoverable, is Organization-wide', () => {
  const link = classify([owner, { id: 'd', type: 'domain', role: 'reader', domain: 'example.org', allowFileDiscovery: false }], ctx);
  assert.equal(link.level, 'ORG_WIDE');
  assert.equal(text(link), 'Organization-wide: everyone at example.org can open this folder');
  const disc = classify([owner, { id: 'd', type: 'domain', role: 'reader', domain: 'Example.org', allowFileDiscovery: true }], ctx);
  assert.equal(disc.level, 'ORG_WIDE');
  assert.match(text(disc), /can find and open/);
});

test('anyone with the link is Public (link)', () => {
  const r = classify([owner, { id: 'anyoneWithLink', type: 'anyone', role: 'reader', allowFileDiscovery: false }], ctx);
  assert.equal(r.level, 'PUBLIC_LINK');
});

test('discoverable by anyone is Public (discoverable)', () => {
  const r = classify([owner, { id: 'anyone', type: 'anyone', role: 'reader', allowFileDiscovery: true }], ctx);
  assert.equal(r.level, 'PUBLIC_DISCOVERABLE');
});

test('inherited public access is reported as inherited', () => {
  const r = classify([owner, { id: 'anyoneWithLink', type: 'anyone', role: 'reader', source: 'inherited' }], ctx);
  assert.equal(r.level, 'PUBLIC_LINK');
  assert.ok(r.reason.inherited);
  assert.match(text(r), /inherited from a parent folder/);
  const anyoneEntry = r.entries.find((e) => e.type === 'anyone');
  assert.equal(anyoneEntry.source, 'inherited');
});

test('not marked inherited when the deciding permission is also direct', () => {
  const r = classify([owner,
    { id: 'anyoneWithLink', type: 'anyone', role: 'reader', source: 'inherited' },
    { id: 'anyone2', type: 'anyone', role: 'reader', source: 'direct' }], ctx);
  assert.ok(!r.reason.inherited);
});

test('shared drive members (no owner) classify normally', () => {
  const r = classify([
    { id: '1', type: 'user', role: 'organizer', emailAddress: 'm@example.org', source: 'inherited' },
    { id: '2', type: 'group', role: 'fileOrganizer', emailAddress: 'staff@example.org', source: 'inherited' },
  ], ctx);
  assert.equal(r.level, 'INTERNAL');
  assert.equal(text(r), 'Internal: shared with 2 people or groups at example.org (inherited from a parent folder)');
});

test('highest-risk level wins', () => {
  const r = classify([owner, user('a@example.org'), user('x@other.com'),
    { id: 'd', type: 'domain', role: 'reader', domain: 'example.org' },
    { id: 'anyone', type: 'anyone', role: 'reader', allowFileDiscovery: true }], ctx);
  assert.equal(r.level, 'PUBLIC_DISCOVERABLE');
  assert.equal(r.entries[0].type, 'anyone', 'public entries sort first');
  assert.equal(r.entries[1].access, 'external', 'then external');
});

test('external domain permission counts as External', () => {
  const r = classify([owner, { id: 'd', type: 'domain', role: 'reader', domain: 'other.org' }, user('x@other.com')], ctx);
  assert.equal(r.level, 'EXTERNAL');
  assert.equal(text(r), 'External: shared with 1 address and 1 domain outside example.org');
});

test('external owner makes the folder External', () => {
  const r = classify([{ id: 'o', type: 'user', role: 'owner', emailAddress: 'boss@other.com' }, user('me@example.org')], ctx);
  assert.equal(r.level, 'EXTERNAL');
});

test('same folder classifies relative to each viewer’s own domain', () => {
  const perms = [{ id: 'o', type: 'user', role: 'owner', emailAddress: 'o@alpha.org' }, user('b@alpha.org')];
  assert.equal(classify(perms, { userDomain: 'alpha.org' }).level, 'INTERNAL');
  assert.equal(classify(perms, { userDomain: 'beta.org' }).level, 'EXTERNAL');
});

test('personal account is Unknown and never treats Gmail as internal', () => {
  const r = classify([user('friend@gmail.com')], { userDomain: 'gmail.com' });
  assert.equal(r.level, 'UNKNOWN');
  assert.equal(describeReason(r.reason), 'Signed in with a personal account');
  const r2 = classify([owner, user('friend@gmail.com')], { userDomain: 'example.org', allowedDomains: ['gmail.com'] });
  assert.equal(r2.level, 'EXTERNAL', 'gmail.com cannot be allow-listed');
});

test('allow-listing a partner domain moves it to Internal, removing reverses it', () => {
  const perms = [owner, user('p@partner.org')];
  assert.equal(classify(perms, ctx).level, 'EXTERNAL');
  const allowed = classify(perms, { userDomain: 'example.org', allowedDomains: ['partner.org'] });
  assert.equal(allowed.level, 'INTERNAL');
  assert.match(text(allowed), /allowed domain/);
  assert.equal(allowed.entries.find((e) => e.emailAddress === 'p@partner.org').access, 'allowed');
  assert.equal(classify(perms, ctx).level, 'EXTERNAL');
});

test('allow-listed partner domain permission is Organization-wide, not Internal', () => {
  const r = classify([owner, { id: 'd', type: 'domain', role: 'reader', domain: 'partner.org' }],
    { userDomain: 'example.org', allowedDomains: ['partner.org'] });
  assert.equal(r.level, 'ORG_WIDE');
  assert.equal(describeReason(r.reason), 'everyone at partner.org (allowed domain) can open this folder');
});

test('subdomain is External unless *.domain is allowed', () => {
  const perms = [owner, user('t@team.example.org')];
  assert.equal(classify(perms, ctx).level, 'EXTERNAL');
  assert.equal(classify(perms, { userDomain: 'example.org', allowedDomains: ['*.example.org'] }).level, 'INTERNAL');
});

test('unclassifiable permissions are Unknown, never green', () => {
  const r = classify([owner, user('a@example.org'), { id: 'x', type: 'user', role: 'reader' }], ctx);
  assert.equal(r.level, 'UNKNOWN');
  assert.equal(describeReason(r.reason), '1 permission could not be classified');
  assert.equal(classify([owner, { id: 'z', type: 'mystery', role: 'reader' }], ctx).level, 'UNKNOWN');
});

test('external still outranks unknown', () => {
  const r = classify([owner, user('x@other.com'), { id: 'x', type: 'user', role: 'reader' }], ctx);
  assert.equal(r.level, 'EXTERNAL');
});

test('deleted accounts are listed but do not affect the level', () => {
  const r = classify([owner, user('gone@other.com', { deleted: true })], ctx);
  assert.equal(r.level, 'PRIVATE');
  assert.equal(r.entries[r.entries.length - 1].access, 'deleted');
});

test('empty or missing permission list is Unknown', () => {
  assert.equal(classify([], ctx).level, 'UNKNOWN');
  assert.equal(classify(undefined, ctx).level, 'UNKNOWN');
  assert.equal(classify([owner], { userDomain: '' }).level, 'UNKNOWN');
});

test('inferred inheritance is described as likely, not as fact', () => {
  const r = classify([owner, { id: 'anyoneWithLink', type: 'anyone', role: 'reader', source: 'inherited', sourceInferred: true }], ctx);
  assert.ok(r.reason.inherited);
  assert.ok(r.reason.inheritedInferred);
  assert.match(text(r), /\(likely inherited from a parent folder\)$/);
  assert.equal(r.entries.find((e) => e.type === 'anyone').sourceInferred, true);
});
