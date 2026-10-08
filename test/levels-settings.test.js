const test = require('node:test');
const assert = require('node:assert/strict');
const DV = require('./helpers.js');
const L = DV.levels;
const S = DV.settings;

test('every default level color meets WCAG AA with its text color (F13)', () => {
  for (const level of L.ORDER) {
    const { bg, fg } = L.colorsFor(level, S.DEFAULTS);
    assert.ok(L.contrast(bg, fg) >= 4.5, `${level} ${bg}/${fg} = ${L.contrast(bg, fg).toFixed(2)}`);
  }
});

test('any custom color still gets AA text', () => {
  for (const bg of ['#ffff00', '#00ff00', '#777777', '#767676', '#808080', '#0000ff', '#ff0000', '#000000', '#ffffff']) {
    assert.ok(L.contrast(bg, L.textColorFor(bg)) >= 4.5, bg);
  }
});

test('Unknown is always neutral gray regardless of configuration (F19)', () => {
  const s = { colors: { UNKNOWN: '#00ff00', INTERNAL: '#00ff00' } };
  assert.equal(L.colorsFor('UNKNOWN', s).bg, L.NEUTRAL_COLOR);
  assert.equal(L.colorsFor('INTERNAL', s).bg, '#00ff00');
});

test('levels are ordered by risk', () => {
  assert.equal(L.higher('INTERNAL', 'EXTERNAL'), 'EXTERNAL');
  assert.equal(L.higher('PUBLIC_DISCOVERABLE', 'PUBLIC_LINK'), 'PUBLIC_DISCOVERABLE');
  assert.equal(L.higher('ORG_WIDE', 'UNKNOWN'), 'UNKNOWN');
  assert.equal(L.higher('UNKNOWN', 'EXTERNAL'), 'EXTERNAL');
});

test('publicLinkSameAsDiscoverable gives Public (link) the severe color and emphasis', () => {
  const off = Object.assign({}, S.DEFAULTS);
  const on = Object.assign({}, S.DEFAULTS, { publicLinkSameAsDiscoverable: true });
  assert.notEqual(L.colorsFor('PUBLIC_LINK', off).bg, L.colorsFor('PUBLIC_DISCOVERABLE', off).bg);
  assert.equal(L.colorsFor('PUBLIC_LINK', on).bg, L.colorsFor('PUBLIC_DISCOVERABLE', on).bg);
  assert.ok(!L.isEmphasized('PUBLIC_LINK', off));
  assert.ok(L.isEmphasized('PUBLIC_LINK', on));
  assert.ok(L.isEmphasized('PUBLIC_DISCOVERABLE', off));
});

test('settings sanitize valid values and report invalid ones', () => {
  const r = S.sanitize({
    allowedDomains: ['Partner.org', 'partner.org', '*.example.org', 'gmail.com', 'nope', ''],
    cacheMinutes: 10,
    colors: { EXTERNAL: '#ABCDEF', INTERNAL: 'green', UNKNOWN: '#000000' },
    publicLinkSameAsDiscoverable: true,
    somethingElse: 1,
  });
  assert.deepEqual(r.values.allowedDomains, ['partner.org', '*.example.org']);
  assert.deepEqual(r.invalidDomains, ['gmail.com', 'nope']);
  assert.equal(r.values.cacheMinutes, 10);
  assert.deepEqual(r.values.colors, { EXTERNAL: '#abcdef' });
  assert.equal(r.values.publicLinkSameAsDiscoverable, true);
  assert.ok(!('somethingElse' in r.values));
  assert.ok(S.sanitize({ cacheMinutes: -1 }).invalidCache);
  assert.ok(S.sanitize({ cacheMinutes: 2.5 }).invalidCache);
  assert.ok(S.sanitize({ cacheMinutes: 5000 }).invalidCache);
});

test('managed values override local values, which override defaults (C1, C3)', () => {
  const m = S.merge(
    { allowedDomains: ['admin.org'], colors: { EXTERNAL: '#111111' } },
    { allowedDomains: ['user.org'], cacheMinutes: 1, colors: { EXTERNAL: '#222222', INTERNAL: '#333333' } }
  );
  assert.deepEqual(m.allowedDomains, ['admin.org']);
  assert.equal(m.cacheMinutes, 1);
  assert.equal(m.colors.EXTERNAL, '#111111');
  assert.equal(m.colors.INTERNAL, '#333333');
  assert.equal(m.colors.PRIVATE, L.DEFAULT_COLORS.PRIVATE);
  assert.equal(m.publicLinkSameAsDiscoverable, false);
  assert.deepEqual(S.merge({}, {}).allowedDomains, [], 'allowed list is empty by default');
  assert.equal(S.merge({}, {}).cacheMinutes, 5, 'cache defaults to 5 minutes');
});

test('every result has the same shape', () => {
  const r = L.makeResult('EXTERNAL', 'shared with 1 address outside example.org', S.DEFAULTS, { code: null });
  for (const k of ['level', 'levelName', 'reasonText', 'code', 'detail', 'colors', 'emphasis', 'icon', 'loading',
    'checkedAt', 'fetchedAt', 'fromCache', 'accountEmail', 'driveEmail', 'userDomain', 'entries']) {
    assert.ok(k in r, k);
  }
  assert.equal(r.levelName, 'External');
  assert.equal(L.makeResult('LOADING', 'x', null).loading, true);
  assert.equal(L.makeResult('UNKNOWN', 'x', S.DEFAULTS).colors.bg, L.NEUTRAL_COLOR);
});
