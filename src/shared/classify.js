// Folder classification (section 3.3). Pure function of the permission list,
// the signed-in user's domain and the allowed-domains list.
(function (root) {
  'use strict';
  const DV = root.DV || (root.DV = {});
  const { domainOfEmail, normalizeDomain, isPersonalDomain, compileAllowList } = DV.domain;
  const { rank, higher } = DV.levels;

  const ROLE_ORDER = ['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'];

  function str(v) {
    return typeof v === 'string' ? v : '';
  }

  function classifyOne(p, userDomain, isAllowed) {
    const e = {
      id: str(p.id),
      type: str(p.type),
      role: str(p.role),
      emailAddress: str(p.emailAddress) || null,
      domain: null,
      allowFileDiscovery: p.allowFileDiscovery === true,
      deleted: p.deleted === true,
      source: ['direct', 'inherited', 'both'].includes(p.source) ? p.source : 'unknown',
      level: 'UNKNOWN',
      access: 'unknown',
    };

    if (e.type === 'anyone') {
      e.level = e.allowFileDiscovery ? 'PUBLIC_DISCOVERABLE' : 'PUBLIC_LINK';
      e.access = e.allowFileDiscovery ? 'public_discoverable' : 'public_link';
    } else if (e.type === 'user' || e.type === 'group') {
      // Groups are classified by the group's own address (F10).
      const d = domainOfEmail(e.emailAddress);
      e.domain = d;
      if (d && (d === userDomain || isAllowed(d))) {
        e.access = d === userDomain ? 'internal' : 'allowed';
        e.level = e.role === 'owner' ? 'PRIVATE' : 'INTERNAL';
      } else if (d) {
        e.access = 'external';
        e.level = 'EXTERNAL';
      }
    } else if (e.type === 'domain') {
      const d = normalizeDomain(p.domain);
      e.domain = d;
      if (d && (d === userDomain || isAllowed(d))) {
        e.access = d === userDomain ? 'organization' : 'allowed';
        e.level = 'ORG_WIDE';
      } else if (d) {
        e.access = 'external';
        e.level = 'EXTERNAL';
      }
    }

    // A deleted account's permission grants no access; it is listed but not counted.
    if (e.deleted) e.access = 'deleted';
    return e;
  }

  function buildReason(level, active, decisive, userDomain) {
    switch (level) {
      case 'PUBLIC_DISCOVERABLE':
        return { key: 'reason.publicDiscoverable' };
      case 'PUBLIC_LINK':
        return { key: 'reason.publicLink' };
      case 'EXTERNAL':
        return {
          key: 'reason.external',
          vars: {
            addresses: decisive.filter((e) => e.type === 'user' || e.type === 'group').length,
            domains: decisive.filter((e) => e.type === 'domain').length,
            domain: userDomain,
          },
        };
      case 'UNKNOWN':
        return { key: 'reason.unclassified', vars: { count: decisive.length } };
      case 'ORG_WIDE': {
        const own = decisive.filter((e) => e.access === 'organization');
        if (own.length) {
          const key = own.some((e) => e.allowFileDiscovery) ? 'reason.orgWideDiscoverable' : 'reason.orgWide';
          return { key, vars: { domain: userDomain } };
        }
        const domains = Array.from(new Set(decisive.map((e) => e.domain))).sort();
        return { key: 'reason.orgWideAllowed', vars: { domains: domains.join(', ') } };
      }
      case 'INTERNAL': {
        const anyAllowed = active.some((e) => e.access === 'allowed');
        return { key: anyAllowed ? 'reason.internalAllowed' : 'reason.internal', vars: { count: decisive.length, domain: userDomain } };
      }
      default:
        return { key: 'reason.private' };
    }
  }

  function compareEntries(a, b) {
    if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
    const r = rank(b.level) - rank(a.level);
    if (r) return r;
    const ra = ROLE_ORDER.indexOf(a.role);
    const rb = ROLE_ORDER.indexOf(b.role);
    if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    const la = a.emailAddress || a.domain || a.type;
    const lb = b.emailAddress || b.domain || b.type;
    return la < lb ? -1 : la > lb ? 1 : 0;
  }

  // permissions: raw Drive permission objects, optionally with `source`
  //   ('direct' | 'inherited' | 'both' | 'unknown') attached.
  // ctx: { userDomain, allowedDomains }
  // Returns { level, reason: {key, vars, inherited}, entries } with entries sorted
  // external and public first (F17).
  function classify(permissions, ctx) {
    const userDomain = normalizeDomain(ctx && ctx.userDomain);
    if (!userDomain) {
      return { level: 'UNKNOWN', reason: { key: 'error.identity_failed' }, entries: [] };
    }
    if (isPersonalDomain(userDomain)) {
      return { level: 'UNKNOWN', reason: { key: 'error.personal_account' }, entries: [] };
    }

    const isAllowed = compileAllowList(ctx.allowedDomains);
    const entries = (Array.isArray(permissions) ? permissions : [])
      .filter((p) => p && typeof p === 'object')
      .map((p) => classifyOne(p, userDomain, isAllowed))
      .sort(compareEntries);
    const active = entries.filter((e) => !e.deleted);

    if (!active.length) {
      return { level: 'UNKNOWN', reason: { key: 'error.no_permissions' }, entries };
    }

    const level = active.reduce((acc, e) => higher(acc, e.level), 'PRIVATE');
    const decisive = active.filter((e) => e.level === level);
    const reason = buildReason(level, active, decisive, userDomain);
    reason.inherited = level !== 'PRIVATE' && decisive.every((e) => e.source === 'inherited');
    return { level, reason, entries };
  }

  DV.classify = classify;

  if (typeof module === 'object' && module.exports) module.exports = classify;
})(globalThis);
