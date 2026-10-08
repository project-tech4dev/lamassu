// All user-visible English strings live in this file. To translate, replace
// the MESSAGES table; keys ending in _one / _other are plural forms selected by
// the `count` variable.
(function (root) {
  'use strict';
  const DV = root.DV || (root.DV = {});

  const MESSAGES = {
    // Level names
    'level.PUBLIC_DISCOVERABLE': 'Public (discoverable)',
    'level.PUBLIC_LINK': 'Public (link)',
    'level.EXTERNAL': 'External',
    'level.UNKNOWN': 'Unknown',
    'level.ORG_WIDE': 'Organization-wide',
    'level.INTERNAL': 'Internal',
    'level.PRIVATE': 'Private',
    'level.LOADING': 'Checking',

    // Reasons (one line, shown after "<Level>: ")
    'reason.publicDiscoverable': 'anyone on the internet can find and open this folder',
    'reason.publicLink': 'anyone with the link can open this folder',
    'reason.external': 'shared with {parts} outside {domain}',
    'part.addresses_one': '{count} address',
    'part.addresses_other': '{count} addresses',
    'part.domains_one': '{count} domain',
    'part.domains_other': '{count} domains',
    'list.pair': '{a} and {b}',
    'reason.orgWide': 'everyone at {domain} can open this folder',
    'reason.orgWideDiscoverable': 'everyone at {domain} can find and open this folder',
    'reason.orgWideAllowed': 'everyone at {domains} (allowed domain) can open this folder',
    'reason.internal_one': 'shared with {count} person or group at {domain}',
    'reason.internal_other': 'shared with {count} people or groups at {domain}',
    'reason.internalAllowed_one': 'shared with {count} person or group at {domain} or an allowed domain',
    'reason.internalAllowed_other': 'shared with {count} people or groups at {domain} or allowed domains',
    'reason.private': 'only the owner has access',
    'reason.unclassified_one': '{count} permission could not be classified',
    'reason.unclassified_other': '{count} permissions could not be classified',
    'reason.inheritedSuffix': ' (inherited from a parent folder)',
    'reason.inheritedLikelySuffix': ' (likely inherited from a parent folder)',

    // Unknown-level reasons, keyed by error code
    'error.auth_required': 'sign-in needed. Click the extension icon to sign in',
    'error.auth_expired': 'your sign-in expired and could not be renewed',
    'error.identity_failed': 'could not determine your account',
    'error.personal_account': 'Signed in with a personal account',
    'error.account_unconfirmed': 'could not confirm which Google account Drive is showing',
    'error.account_mismatch': 'Drive is open as a different account from the one the extension checks with',
    'error.forbidden': 'you do not have permission to view this folder’s sharing',
    'error.not_found': 'folder not found, or not visible to your account',
    'error.rate_limited': 'Google Drive is limiting requests. Try again shortly',
    'error.network': 'could not reach Google Drive',
    'error.timeout': 'Google Drive took too long to respond',
    'error.http_error': 'Google Drive returned an error',
    'error.bad_response': 'Google Drive returned an unreadable response',
    'error.bad_request': 'this page’s folder ID is not valid',
    'error.too_many_pages': 'this folder has too many permissions to read completely',
    'error.no_permissions': 'no sharing information was returned',
    'error.internal_error': 'something went wrong while checking sharing',

    // Banner
    'banner.loading': 'checking who can access this folder…',
    'banner.refresh': 'Refresh sharing check',
    'banner.minimize': 'Minimize sharing banner',
    'banner.expand': 'Expand sharing banner',

    // Popup
    'popup.title': 'Folder sharing',
    'popup.checkedAs': 'Checked as',
    'popup.driveAccount': 'Drive is showing',
    'popup.lastChecked': 'Last checked',
    'popup.cached': '{time} (cached)',
    'popup.refresh': 'Refresh',
    'popup.signIn': 'Sign in',
    'popup.signInFailed': 'Sign-in failed: {detail}',
    'popup.errorDetail': 'Details: {detail}',
    'popup.options': 'Settings',
    'popup.noDrive': 'Open a folder in Google Drive to see who can access it.',
    'popup.notFolder': 'This Drive page is not a folder. Open a folder to see who can access it.',
    'popup.loading': 'Checking…',
    'popup.none': '—',
    'popup.tableCaption_one': '{count} permission',
    'popup.tableCaption_other': '{count} permissions',
    'popup.noEntries': 'No permissions to show.',
    'col.who': 'Who',
    'col.type': 'Type',
    'col.role': 'Role',
    'col.access': 'Access',
    'col.source': 'Source',

    'who.anyoneDiscoverable': 'Anyone on the internet (discoverable)',
    'who.anyoneLink': 'Anyone with the link',
    'who.domain': 'Everyone at {domain}',
    'who.unknown': '(no address returned)',
    'who.deleted': ' (deleted account)',

    'type.user': 'User',
    'type.group': 'Group',
    'type.domain': 'Domain',
    'type.anyone': 'Anyone',

    'role.owner': 'Owner',
    'role.organizer': 'Manager',
    'role.fileOrganizer': 'Content manager',
    'role.writer': 'Editor',
    'role.commenter': 'Commenter',
    'role.reader': 'Viewer',

    'access.public_discoverable': 'Public',
    'access.public_link': 'Public',
    'access.external': 'External',
    'access.organization': 'Organization',
    'access.allowed': 'Allowed domain',
    'access.internal': 'Internal',
    'access.unknown': 'Unknown',
    'access.deleted': 'Inactive',

    'source.direct': 'Direct',
    'source.inherited': 'Inherited',
    'source.both': 'Direct + inherited',
    'source.unknown': '—',
    'source.inferredSuffix': ' (inferred)',

    // Options page
    'options.title': 'Lamassu: Visibility Guardian settings',
    'options.intro': 'These settings apply only in this browser. Settings pushed by your Workspace administrator take priority and cannot be changed here.',
    'options.managed': 'Set by your administrator',
    'options.allowedDomains': 'Allowed domains',
    'options.allowedDomainsHelp': 'One per line. Addresses on these domains are treated as internal. Use *.example.org to include every subdomain of example.org (but not example.org itself). Personal email domains such as gmail.com are not accepted.',
    'options.cacheMinutes': 'Cache duration (minutes)',
    'options.cacheMinutesHelp': 'How long a folder’s sharing is remembered before it is checked again. 0 turns caching off. Maximum 1440.',
    'options.publicLinkSevere': 'Show “Public (link)” as severely as “Public (discoverable)”',
    'options.colors': 'Level colors',
    'options.colorsHelp': 'Text color is chosen automatically for readable contrast. The Unknown level is always gray.',
    'options.save': 'Save',
    'options.reset': 'Reset to defaults',
    'options.saved': 'Settings saved.',
    'options.resetDone': 'Settings reset to defaults.',
    'options.invalidDomains': 'These entries are not valid domains and were not saved: {list}',
    'options.invalidCache': 'Cache duration must be a whole number from 0 to 1440.',
    'options.preview': 'Sample banner text',
  };

  const pluralRules = typeof Intl !== 'undefined' ? new Intl.PluralRules('en') : null;

  function t(key, vars) {
    let k = key;
    if (vars && typeof vars.count === 'number') {
      const form = pluralRules ? pluralRules.select(vars.count) : (vars.count === 1 ? 'one' : 'other');
      const pk = key + '_' + (form === 'one' ? 'one' : 'other');
      if (Object.prototype.hasOwnProperty.call(MESSAGES, pk)) k = pk;
    }
    const s = MESSAGES[k];
    if (s === undefined) return key;
    return s.replace(/\{(\w+)\}/g, (m, name) =>
      vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m);
  }

  function levelName(level) {
    return t('level.' + level);
  }

  // Turns a classification or error reason {key, vars, inherited} into one line of text.
  function describeReason(reason) {
    if (!reason || !reason.key) return t('error.internal_error');
    let text;
    if (reason.key === 'reason.external') {
      const v = reason.vars || {};
      const parts = [];
      if (v.addresses) parts.push(t('part.addresses', { count: v.addresses }));
      if (v.domains) parts.push(t('part.domains', { count: v.domains }));
      const joined = parts.length === 2 ? t('list.pair', { a: parts[0], b: parts[1] }) : (parts[0] || '');
      text = t('reason.external', { parts: joined, domain: v.domain });
    } else {
      text = t(reason.key, reason.vars);
    }
    if (reason.inherited) text += t(reason.inheritedInferred ? 'reason.inheritedLikelySuffix' : 'reason.inheritedSuffix');
    return text;
  }

  DV.strings = { t, levelName, describeReason, MESSAGES };

  if (typeof module === 'object' && module.exports) module.exports = DV.strings;
})(globalThis);
