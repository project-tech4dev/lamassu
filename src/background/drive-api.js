// Drive API v3 client. GET only, fixed base URL, pagination,
// one token renewal on 401, backoff on 429 / rate-limit 403 / 5xx,
// and an overall time budget per folder lookup.
(function (root) {
  'use strict';
  const DV = root.DV || (root.DV = {});

  const API_BASE = 'https://www.googleapis.com/drive/v3';
  const PERMISSION_FIELDS = 'nextPageToken,permissions(id,type,role,emailAddress,domain,allowFileDiscovery,deleted,permissionDetails)';
  const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'sharingRateLimitExceeded']);
  const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
  const MAX_PAGES = 50;

  class DriveError extends Error {
    constructor(code, status) {
      super(code);
      this.code = code;
      this.status = status || 0;
    }
  }

  function codeOf(err) {
    return err && typeof err.code === 'string' ? err.code : 'internal_error';
  }

  function createDriveApi(deps) {
    const fetchFn = deps.fetch;
    const getToken = deps.getToken;
    const removeCachedToken = deps.removeCachedToken;
    const sleep = deps.sleep;
    const random = deps.random || Math.random;
    const now = deps.now || Date.now;
    const timeoutMs = deps.timeoutMs || 10000;
    const budgetMs = deps.budgetMs || 8000;
    const maxRetries = deps.maxRetries === undefined ? 4 : deps.maxRetries;

    function buildUrl(path, params) {
      if (!/^\/[A-Za-z0-9_\-/]+$/.test(path)) throw new DriveError('bad_request');
      const url = new URL(API_BASE + path);
      for (const k of Object.keys(params || {})) {
        if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, String(params[k]));
      }
      if (!url.href.startsWith(API_BASE + '/')) throw new DriveError('bad_request');
      return url.href;
    }

    async function fetchOnce(url, token, resourceKeys, limitMs) {
      const headers = { Authorization: 'Bearer ' + token };
      if (resourceKeys) headers['X-Goog-Drive-Resource-Keys'] = resourceKeys;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), limitMs);
      try {
        return await fetchFn(url, {
          method: 'GET',
          headers,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: ctl.signal,
        });
      } catch (e) {
        throw new DriveError(ctl.signal.aborted ? 'timeout' : 'network');
      } finally {
        clearTimeout(timer);
      }
    }

    async function errorReason(res) {
      try {
        const body = await res.json();
        const err = body && body.error;
        return (err && err.errors && err.errors[0] && err.errors[0].reason) || '';
      } catch (e) {
        return '';
      }
    }

    function backoffMs(attempt, retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 16000);
      return Math.min(500 * Math.pow(2, attempt), 8000) + Math.floor(random() * 250);
    }

    // opts: { resourceKeys, deadline (epoch ms), retries }
    async function get(path, params, opts) {
      const o = opts || {};
      const deadline = o.deadline || now() + budgetMs;
      const retries = o.retries === undefined ? maxRetries : o.retries;
      const url = buildUrl(path, params);
      let token = await getToken();
      let renewed = false;
      let attempt = 0;
      for (;;) {
        const remaining = deadline - now();
        if (remaining <= 0) throw new DriveError('timeout');
        const res = await fetchOnce(url, token, o.resourceKeys, Math.min(timeoutMs, remaining));
        if (res.ok) {
          try {
            return await res.json();
          } catch (e) {
            throw new DriveError('bad_response', res.status);
          }
        }
        const reason = await errorReason(res);
        if (res.status === 401) {
          if (renewed) throw new DriveError('auth_expired', 401);
          renewed = true;
          await removeCachedToken(token);
          token = await getToken();
          continue;
        }
        const rateLimited = res.status === 429 || (res.status === 403 && RATE_LIMIT_REASONS.has(reason));
        if ((rateLimited || res.status >= 500) && attempt < retries) {
          const delay = backoffMs(attempt, res.headers && res.headers.get('Retry-After'));
          // Do not start a wait that would end after the budget.
          if (now() + delay < deadline) {
            await sleep(delay);
            attempt++;
            continue;
          }
        }
        if (rateLimited) throw new DriveError('rate_limited', res.status);
        if (res.status === 403) throw new DriveError('forbidden', 403);
        if (res.status === 404) throw new DriveError('not_found', 404);
        throw new DriveError('http_error', res.status);
      }
    }

    async function getUserEmail() {
      const body = await get('/about', { fields: 'user(emailAddress)' });
      const email = body && body.user && body.user.emailAddress;
      if (typeof email !== 'string' || !email) throw new DriveError('identity_failed');
      return email.toLowerCase();
    }

    function slimPermission(p) {
      return {
        id: typeof p.id === 'string' ? p.id : '',
        type: p.type,
        role: p.role,
        emailAddress: p.emailAddress,
        domain: p.domain,
        allowFileDiscovery: p.allowFileDiscovery,
        deleted: p.deleted,
        details: Array.isArray(p.permissionDetails)
          ? p.permissionDetails.map((d) => ({ inherited: !!(d && d.inherited) }))
          : null,
      };
    }

    async function listPermissions(fileId, opts) {
      if (!ID_RE.test(fileId)) throw new DriveError('bad_request');
      const out = [];
      let pageToken;
      let pages = 0;
      do {
        if (++pages > MAX_PAGES) throw new DriveError('too_many_pages');
        const body = await get('/files/' + fileId + '/permissions', {
          supportsAllDrives: 'true',
          pageSize: 100,
          fields: PERMISSION_FIELDS,
          pageToken,
        }, opts);
        if (!body || (body.permissions !== undefined && !Array.isArray(body.permissions))) {
          throw new DriveError('bad_response');
        }
        for (const p of body.permissions || []) {
          if (p && typeof p === 'object') out.push(slimPermission(p));
        }
        pageToken = body.nextPageToken;
      } while (pageToken);
      return out;
    }

    async function getParents(fileId, opts) {
      if (!ID_RE.test(fileId)) throw new DriveError('bad_request');
      const body = await get('/files/' + fileId, { fields: 'parents', supportsAllDrives: 'true' }, opts);
      return Array.isArray(body && body.parents) ? body.parents.filter((id) => ID_RE.test(id)) : [];
    }

    function sourceFromDetails(details) {
      if (!details || !details.length) return 'unknown';
      const inherited = details.some((d) => d.inherited);
      const direct = details.some((d) => !d.inherited);
      return inherited && direct ? 'both' : inherited ? 'inherited' : 'direct';
    }

    // Reads every permission on the folder and marks each one direct or
    // inherited. Drive returns permissionDetails for shared-drive items.
    // When it is absent (My Drive), inheritance is inferred: a permission is
    // treated as inherited if the parent folder holds the same permission ID
    // with the same role, and is flagged `sourceInferred` so the UI can say so.
    async function fetchFolderPermissions(folderId, resourceKey) {
      const rk = resourceKey ? folderId + '/' + resourceKey : null;
      const deadline = now() + budgetMs;
      // Started in parallel so My Drive folders cost two round trips, not three.
      // The parent lookup is best-effort: one attempt, no retries.
      const parentsP = getParents(folderId, { resourceKeys: rk, deadline, retries: 0 }).catch(() => null);
      const perms = await listPermissions(folderId, { resourceKeys: rk, deadline });

      if (perms.some((p) => p.details && p.details.length)) {
        for (const p of perms) p.source = sourceFromDetails(p.details);
      } else {
        let parentRoles = null;
        try {
          const parents = await parentsP;
          if (parents) {
            parentRoles = new Map();
            if (parents.length) {
              const parentPerms = await listPermissions(parents[0], { deadline, retries: 0 });
              for (const pp of parentPerms) parentRoles.set(pp.id, pp.role);
            }
          }
        } catch (e) {
          parentRoles = null;
        }
        for (const p of perms) {
          if (!parentRoles) {
            p.source = 'unknown';
          } else if (p.role === 'owner') {
            p.source = 'direct';
          } else {
            p.source = p.id && parentRoles.get(p.id) === p.role ? 'inherited' : 'direct';
            p.sourceInferred = true;
          }
        }
      }
      for (const p of perms) delete p.details;
      return perms;
    }

    return { get, getUserEmail, listPermissions, getParents, fetchFolderPermissions, buildUrl };
  }

  DV.DriveError = DriveError;
  DV.createDriveApi = createDriveApi;
  DV.driveErrorCode = codeOf;

  if (typeof module === 'object' && module.exports) module.exports = { DriveError, createDriveApi, codeOf, API_BASE };
})(globalThis);
