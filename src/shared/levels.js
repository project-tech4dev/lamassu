// Level definitions, risk ordering, default colors and contrast helpers.
(function (root) {
  'use strict';
  const DV = root.DV || (root.DV = {});

  // Lowest risk first. When several levels apply, the one with the highest index wins.
  // Unknown sits above Organization-wide so an unclassifiable permission can never
  // be hidden behind a green or amber state, but below External so a definite
  // external share is still reported as such.
  const ORDER = ['PRIVATE', 'INTERNAL', 'ORG_WIDE', 'UNKNOWN', 'EXTERNAL', 'PUBLIC_LINK', 'PUBLIC_DISCOVERABLE'];

  const META = {
    PUBLIC_DISCOVERABLE: { icon: 'globe', badge: 'PUB' },
    PUBLIC_LINK: { icon: 'link', badge: 'LINK' },
    EXTERNAL: { icon: 'alert', badge: 'EXT' },
    UNKNOWN: { icon: 'help', badge: '?' },
    ORG_WIDE: { icon: 'building', badge: 'ORG' },
    INTERNAL: { icon: 'people', badge: 'INT' },
    PRIVATE: { icon: 'lock', badge: '' },
    LOADING: { icon: 'clock', badge: '' },
  };

  // All defaults reach WCAG AA (4.5:1) against the automatically chosen text color.
  const DEFAULT_COLORS = {
    PUBLIC_DISCOVERABLE: '#5c0011',
    PUBLIC_LINK: '#8e0e1a',
    EXTERNAL: '#c5221f',
    ORG_WIDE: '#f9ab00',
    INTERNAL: '#188038',
    PRIVATE: '#1967d2',
  };

  // Unknown (and the loading state) is always neutral gray and not configurable.
  const NEUTRAL_COLOR = '#5f6368';

  const CONFIGURABLE = Object.keys(DEFAULT_COLORS);

  function rank(level) {
    const i = ORDER.indexOf(level);
    return i < 0 ? ORDER.indexOf('UNKNOWN') : i;
  }

  function higher(a, b) {
    return rank(b) > rank(a) ? b : a;
  }

  function isHexColor(s) {
    return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
  }

  function channel(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  }

  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Picks black or white text, whichever contrasts more. One of the two always
  // reaches at least 4.58:1, so any background color stays AA-compliant.
  function textColorFor(bg) {
    return contrast(bg, '#ffffff') >= contrast(bg, '#000000') ? '#ffffff' : '#000000';
  }

  function colorsFor(level, settings) {
    let bg;
    if (level === 'UNKNOWN' || level === 'LOADING' || !META[level]) {
      bg = NEUTRAL_COLOR;
    } else {
      const key = level === 'PUBLIC_LINK' && settings && settings.publicLinkSameAsDiscoverable
        ? 'PUBLIC_DISCOVERABLE' : level;
      const custom = settings && settings.colors && settings.colors[key];
      bg = isHexColor(custom) ? custom.toLowerCase() : DEFAULT_COLORS[key];
    }
    return { bg, fg: textColorFor(bg) };
  }

  // Public levels get an extra outline so they read as the most severe even
  // without color. Public (link) only gets it when configured to match.
  function isEmphasized(level, settings) {
    if (level === 'PUBLIC_DISCOVERABLE') return true;
    return level === 'PUBLIC_LINK' && !!(settings && settings.publicLinkSameAsDiscoverable);
  }

  function iconFor(level) {
    return (META[level] || META.UNKNOWN).icon;
  }

  function badgeFor(level) {
    return (META[level] || META.UNKNOWN).badge;
  }

  // The single shape for every result shown by the banner and popup, whether
  // built by the service worker, the content script or the popup itself.
  // Requires DV.strings, which every context loads first.
  function makeResult(level, reasonText, settings, extra) {
    return Object.assign({
      level,
      levelName: DV.strings.levelName(level),
      reasonText,
      code: null,
      detail: '',
      colors: colorsFor(level, settings),
      emphasis: isEmphasized(level, settings),
      icon: iconFor(level),
      loading: level === 'LOADING',
      checkedAt: Date.now(),
      fetchedAt: null,
      fromCache: false,
      accountEmail: null,
      driveEmail: null,
      userDomain: null,
      entries: [],
    }, extra || {});
  }

  DV.levels = {
    ORDER, META, DEFAULT_COLORS, NEUTRAL_COLOR, CONFIGURABLE,
    rank, higher, isHexColor, contrast, textColorFor, colorsFor, isEmphasized, iconFor, badgeFor, makeResult,
  };

  if (typeof module === 'object' && module.exports) module.exports = DV.levels;
})(globalThis);
