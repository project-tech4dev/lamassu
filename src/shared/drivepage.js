// Helpers for reading the Drive page: folder URL parsing and the
// account Drive is displaying.
(function (root) {
  'use strict';
  const DV = root.DV || (root.DV = {});

  // /drive/folders/<id>, /drive/u/<n>/folders/<id>, optionally /mobile/.
  const FOLDER_PATH_RE = /^\/drive\/(?:u\/\d+\/)?(?:mobile\/)?folders\/([A-Za-z0-9_-]{5,200})\/?$/;
  const RESOURCE_KEY_RE = /^[A-Za-z0-9_-]{1,200}$/;
  const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

  // The Google account menu in Drive's header links to the account sign-out
  // chooser, and its aria-label contains the signed-in address in every locale.
  const ACCOUNT_SELECTOR = 'a[href*="accounts.google.com/SignOutOptions"], [aria-label^="Google Account:"]';

  function parseFolderUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch (e) {
      return null;
    }
    if (url.origin !== 'https://drive.google.com') return null;
    const m = FOLDER_PATH_RE.exec(url.pathname);
    if (!m) return null;
    const rk = url.searchParams.get('resourcekey');
    return { folderId: m[1], resourceKey: rk && RESOURCE_KEY_RE.test(rk) ? rk : null };
  }

  // Returns the single address found in the account labels, or null when there
  // is none or more than one (ambiguous means "cannot be ruled out").
  function extractAccountEmail(labels) {
    const found = new Set();
    for (const label of labels || []) {
      if (typeof label !== 'string') continue;
      for (const m of label.match(EMAIL_RE) || []) found.add(m.toLowerCase());
    }
    return found.size === 1 ? found.values().next().value : null;
  }

  DV.drivePage = { parseFolderUrl, extractAccountEmail, ACCOUNT_SELECTOR, FOLDER_PATH_RE };

  if (typeof module === 'object' && module.exports) module.exports = DV.drivePage;
})(globalThis);
