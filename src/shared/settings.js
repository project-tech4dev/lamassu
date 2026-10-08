// Settings: defaults < options page (chrome.storage.local) < admin
// policy (chrome.storage.managed). No email addresses are ever stored here.
(function (root) {
  'use strict';
  const DV = root.DV || (root.DV = {});
  const { normalizePattern } = DV.domain;
  const { DEFAULT_COLORS, CONFIGURABLE, isHexColor } = DV.levels;

  const LOCAL_KEY = 'settings';
  const MAX_CACHE_MINUTES = 1440;

  const DEFAULTS = Object.freeze({
    allowedDomains: [],
    cacheMinutes: 5,
    colors: Object.assign({}, DEFAULT_COLORS),
    publicLinkSameAsDiscoverable: false,
  });

  // Returns { values, invalidDomains, invalidCache }. `values` only contains keys
  // that were present and valid, so absent keys fall through to the next layer.
  function sanitize(raw) {
    const values = {};
    const invalidDomains = [];
    let invalidCache = false;
    if (!raw || typeof raw !== 'object') return { values, invalidDomains, invalidCache };

    if (Array.isArray(raw.allowedDomains)) {
      const out = [];
      for (const item of raw.allowedDomains) {
        const p = normalizePattern(item);
        if (p) {
          if (!out.includes(p)) out.push(p);
        } else if (typeof item === 'string' && item.trim()) {
          invalidDomains.push(item.trim());
        }
      }
      values.allowedDomains = out;
    }

    if (raw.cacheMinutes !== undefined) {
      const n = Number(raw.cacheMinutes);
      if (Number.isInteger(n) && n >= 0 && n <= MAX_CACHE_MINUTES) values.cacheMinutes = n;
      else invalidCache = true;
    }

    if (raw.colors && typeof raw.colors === 'object') {
      const colors = {};
      for (const level of CONFIGURABLE) {
        if (isHexColor(raw.colors[level])) colors[level] = raw.colors[level].toLowerCase();
      }
      values.colors = colors;
    }

    if (typeof raw.publicLinkSameAsDiscoverable === 'boolean') {
      values.publicLinkSameAsDiscoverable = raw.publicLinkSameAsDiscoverable;
    }

    return { values, invalidDomains, invalidCache };
  }

  function merge(managed, local) {
    const pick = (k) => (managed[k] !== undefined ? managed[k] : local[k] !== undefined ? local[k] : DEFAULTS[k]);
    return {
      allowedDomains: pick('allowedDomains').slice(),
      cacheMinutes: pick('cacheMinutes'),
      colors: Object.assign({}, DEFAULTS.colors, local.colors || {}, managed.colors || {}),
      publicLinkSameAsDiscoverable: pick('publicLinkSameAsDiscoverable'),
    };
  }

  async function readManaged() {
    try {
      return (await chrome.storage.managed.get(null)) || {};
    } catch (e) {
      return {};
    }
  }

  async function readLocal() {
    try {
      const got = await chrome.storage.local.get(LOCAL_KEY);
      return (got && got[LOCAL_KEY]) || {};
    } catch (e) {
      return {};
    }
  }

  // Returns { values, managed: { keys: [...], colorLevels: [...] } }.
  async function load() {
    const [managedRaw, localRaw] = await Promise.all([readManaged(), readLocal()]);
    const managed = sanitize(managedRaw).values;
    const local = sanitize(localRaw).values;
    return {
      values: merge(managed, local),
      managed: {
        keys: Object.keys(managed).filter((k) => k !== 'colors'),
        colorLevels: Object.keys(managed.colors || {}),
      },
    };
  }

  async function saveLocal(values) {
    await chrome.storage.local.set({ [LOCAL_KEY]: values });
  }

  async function resetLocal() {
    await chrome.storage.local.remove(LOCAL_KEY);
  }

  DV.settings = { DEFAULTS, LOCAL_KEY, MAX_CACHE_MINUTES, sanitize, merge, load, saveLocal, resetLocal };

  if (typeof module === 'object' && module.exports) module.exports = DV.settings;
})(globalThis);
