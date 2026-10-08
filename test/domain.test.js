const test = require('node:test');
const assert = require('node:assert/strict');
const DV = require('./helpers.js');
const { domainOfEmail, normalizePattern, compileAllowList, isPersonalDomain } = DV.domain;

test('domain is the lowercased part after the final @', () => {
  assert.equal(domainOfEmail('Alice@Example.ORG'), 'example.org');
  assert.equal(domainOfEmail('"weird@local"@partner.org'), 'partner.org');
  assert.equal(domainOfEmail('bob@example.org.'), 'example.org');
  assert.equal(domainOfEmail('no-at-sign'), null);
  assert.equal(domainOfEmail('@example.org'), null);
  assert.equal(domainOfEmail('a@'), null);
  assert.equal(domainOfEmail('a@localhost'), null);
  assert.equal(domainOfEmail(undefined), null);
});

test('personal domains are recognised', () => {
  assert.ok(isPersonalDomain('gmail.com'));
  assert.ok(isPersonalDomain('googlemail.com'));
  assert.ok(!isPersonalDomain('example.org'));
});

test('allow-list patterns are normalised and validated', () => {
  assert.equal(normalizePattern(' Partner.ORG '), 'partner.org');
  assert.equal(normalizePattern('*.Example.org'), '*.example.org');
  assert.equal(normalizePattern('*.com'), null, 'single-label wildcard rejected');
  assert.equal(normalizePattern('gmail.com'), null, 'personal domain rejected');
  assert.equal(normalizePattern('*.gmail.com'), null);
  assert.equal(normalizePattern('not a domain'), null);
  assert.equal(normalizePattern('*'), null);
  assert.equal(normalizePattern('user@partner.org'), null);
});

test('exact entries match only that domain; wildcards match strict subdomains', () => {
  const allowed = compileAllowList(['partner.org', '*.example.org']);
  assert.ok(allowed('partner.org'));
  assert.ok(!allowed('team.partner.org'));
  assert.ok(allowed('team.example.org'));
  assert.ok(allowed('a.b.example.org'));
  assert.ok(!allowed('example.org'));
  assert.ok(!allowed('badexample.org'));
  assert.ok(!allowed('other.org'));
});

test('empty allow list matches nothing', () => {
  const allowed = compileAllowList([]);
  assert.ok(!allowed('example.org'));
  assert.ok(!allowed(null));
});
