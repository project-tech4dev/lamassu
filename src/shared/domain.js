// Email-domain extraction and allowed-domain matching.
(function (root) {
  'use strict';
  const DV = root.DV || (root.DV = {});

  const PERSONAL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
  const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
  const DOMAIN_RE = new RegExp('^(?:' + LABEL + '\\.)+' + LABEL + '$');

  function normalizeDomain(d) {
    if (typeof d !== 'string') return null;
    const s = d.trim().toLowerCase().replace(/\.$/, '');
    return s.length <= 253 && DOMAIN_RE.test(s) ? s : null;
  }

  // Domain is the part after the final "@", lowercased.
  function domainOfEmail(email) {
    if (typeof email !== 'string') return null;
    const i = email.lastIndexOf('@');
    if (i <= 0) return null;
    return normalizeDomain(email.slice(i + 1));
  }

  function isPersonalDomain(d) {
    return PERSONAL_DOMAINS.has(d);
  }

  // Accepts "example.org" or "*.example.org". Returns the normalized pattern or
  // null if it is invalid. Rejects personal domains (no Gmail address is ever
  // internal) and wildcards over a single label such as "*.com".
  function normalizePattern(p) {
    if (typeof p !== 'string') return null;
    const s = p.trim().toLowerCase();
    if (s.startsWith('*.')) {
      const base = normalizeDomain(s.slice(2));
      if (!base || base.indexOf('.') < 0 || isPersonalDomain(base)) return null;
      return '*.' + base;
    }
    const d = normalizeDomain(s);
    if (!d || isPersonalDomain(d)) return null;
    return d;
  }

  // "*.example.org" matches strict subdomains only, not example.org itself.
  function compileAllowList(patterns) {
    const exact = new Set();
    const suffixes = [];
    for (const raw of patterns || []) {
      const p = normalizePattern(raw);
      if (!p) continue;
      if (p.startsWith('*.')) suffixes.push(p.slice(1));
      else exact.add(p);
    }
    return function isAllowed(domain) {
      if (!domain) return false;
      if (exact.has(domain)) return true;
      return suffixes.some((s) => domain.endsWith(s) && domain.length > s.length);
    };
  }

  DV.domain = { normalizeDomain, domainOfEmail, isPersonalDomain, normalizePattern, compileAllowList, PERSONAL_DOMAINS };

  if (typeof module === 'object' && module.exports) module.exports = DV.domain;
})(globalThis);
