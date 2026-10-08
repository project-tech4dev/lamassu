// Content script for drive.google.com: detects folder navigation, reads which
// account Drive is showing, and renders the banner. It never makes network
// requests and never puts email addresses into the page's DOM.
(() => {
  'use strict';
  if (window.top !== window || window.__driveVisibilityLoaded) return;
  window.__driveVisibilityLoaded = true;

  const { t } = DV.strings;
  const L = DV.levels;
  const P = DV.drivePage;

  const POLL_MS = 300;
  const ACCOUNT_WAIT_MS = 5000;
  const ANCHOR_CHECK_MS = 1000;
  const LOADING_DELAY_MS = 150;

  let current = null; // { folderId, resourceKey }
  let lastResult = null; // full result from the service worker, kept in memory only
  let seq = 0;
  let pending = null;
  let lastHref = location.href;
  let alive = true;
  // Set after the first time Drive's account label could not be found, so
  // later navigations show Unknown at once instead of waiting again.
  let accountWaitUsed = false;

  const banner = createBanner();

  // ---- Messaging ---------------------------------------------------------

  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  async function send(msg) {
    if (!contextAlive()) {
      teardown();
      return null;
    }
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      if (!contextAlive()) teardown();
      return null;
    }
  }

  // ---- Account shown by Drive --------------------------------------------

  function readDriveAccount() {
    const labels = [];
    for (const n of document.querySelectorAll(P.ACCOUNT_SELECTOR)) labels.push(n.getAttribute('aria-label') || '');
    return P.extractAccountEmail(labels);
  }

  async function waitForAccount() {
    if (accountWaitUsed) return readDriveAccount();
    const deadline = Date.now() + ACCOUNT_WAIT_MS;
    for (;;) {
      const email = readDriveAccount();
      if (email) return email;
      if (Date.now() >= deadline) {
        accountWaitUsed = true;
        return null;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // ---- Status updates ----------------------------------------------------

  function sameFolder(a, b) {
    return !!a && !!b && a.folderId === b.folderId && a.resourceKey === b.resourceKey;
  }

  function localResult(level, reasonKey) {
    return L.makeResult(level, t(reasonKey), null);
  }

  function update(force, showLoadingNow) {
    if (!alive) return Promise.resolve();
    // Record the URL this check is for, so a later navigation away and back is
    // still noticed even if it happens between two polls.
    lastHref = location.href;
    const loc = P.parseFolderUrl(lastHref);
    const mySeq = ++seq;

    if (!loc) {
      if (current) send({ type: 'dv:clear' });
      current = null;
      lastResult = null;
      pending = null;
      banner.hide();
      return Promise.resolve();
    }

    if (!sameFolder(loc, current)) lastResult = null;
    current = loc;

    // Never leave a previous folder's level on screen while checking a new one.
    const loadingTimer = setTimeout(() => {
      if (mySeq === seq) banner.render(localResult('LOADING', 'banner.loading'));
    }, showLoadingNow ? 0 : LOADING_DELAY_MS);

    const p = (async () => {
      const driveEmail = readDriveAccount() || await waitForAccount();
      if (mySeq !== seq) return;
      const res = await send({
        type: 'dv:getStatus',
        folderId: loc.folderId,
        resourceKey: loc.resourceKey,
        driveEmail,
        force: !!force,
      });
      if (mySeq !== seq || !alive) return;
      clearTimeout(loadingTimer);
      lastResult = res && res.level ? res : localResult('UNKNOWN', 'error.internal_error');
      banner.render(lastResult);
    })();

    pending = p;
    p.finally(() => {
      if (pending === p) pending = null;
    });
    return p;
  }

  // ---- Navigation --------------------------------------------------------
  // Drive is a single-page app and content scripts cannot hook the page's
  // history calls, so the URL is compared on a short timer and on popstate.

  function onLocationMaybeChanged() {
    if (!alive || location.href === lastHref) return;
    lastHref = location.href;
    const loc = P.parseFolderUrl(location.href);
    if (sameFolder(loc, current) || (!loc && !current)) return;
    update(false, true);
  }

  const pollTimer = setInterval(onLocationMaybeChanged, POLL_MS);
  window.addEventListener('popstate', onLocationMaybeChanged);

  // Settings changes (options page or admin policy) and account changes (the
  // service worker bumps "epoch") re-run the check; classification is redone
  // from the cache, so this is cheap.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (alive && current && (area === 'local' || area === 'managed')) update(false, false);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || sender.id !== chrome.runtime.id || !String(sender.url || '').startsWith(chrome.runtime.getURL(''))) return false;
    if (msg.type === 'dv:getDetails') {
      (async () => {
        if (pending) await pending;
        if (current && !lastResult) await update(false, false);
        sendResponse({ folder: !!current, result: lastResult });
      })();
      return true;
    }
    if (msg.type === 'dv:refresh') {
      (async () => {
        if (!current) return sendResponse({ folder: false, result: null });
        await update(true, true);
        sendResponse({ folder: true, result: lastResult });
      })();
      return true;
    }
    return false;
  });

  function teardown() {
    if (!alive) return;
    alive = false;
    clearInterval(pollTimer);
    window.removeEventListener('popstate', onLocationMaybeChanged);
    banner.destroy();
  }

  // ---- Banner ------------------------------------------------------------

  function createBanner() {
    const CSS = `
      :host { all: initial; }
      .bar {
        box-sizing: border-box; display: flex; align-items: center; gap: 8px;
        min-height: 32px; padding: 3px 4px 3px 12px; border-radius: 16px;
        background: var(--dv-bg); color: var(--dv-fg);
        font-family: "Google Sans Text", "Google Sans", Roboto, Arial, sans-serif;
        font-size: 13px; line-height: 18px; font-weight: 400;
        box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 2px 6px 2px rgba(0,0,0,.15);
      }
      .bar.emphasis { outline: 3px solid var(--dv-bg); outline-offset: 2px; }
      .icon { flex: none; display: inline-flex; }
      .icon svg, .btn svg { width: 18px; height: 18px; display: block; }
      .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .level { font-weight: 700; }
      .level::after { content: ":"; }
      .btn {
        all: unset; box-sizing: border-box; flex: none; width: 28px; height: 28px;
        border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer; color: inherit;
      }
      .btn:hover { background: rgba(127,127,127,.35); }
      .btn:focus-visible { outline: 2px solid currentColor; outline-offset: -3px; }
      .btn[disabled] { opacity: .5; cursor: default; }
      .minimized .reason, .minimized .refresh { display: none; }
      .minimized .level::after { content: ""; }
      @media (prefers-reduced-motion: no-preference) {
        .loading .icon svg { animation: dv-pulse 1.2s ease-in-out infinite; }
        @keyframes dv-pulse { 50% { opacity: .4; } }
      }
    `;

    const host = document.createElement('div');
    host.setAttribute('data-lamassu-banner', '');
    Object.assign(host.style, {
      position: 'fixed', zIndex: '2147483000', display: 'none', width: 'max-content', margin: '0',
    });
    const shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      // Without styles the banner is still readable plain text.
    }

    const bar = document.createElement('div');
    bar.className = 'bar';
    const icon = document.createElement('span');
    icon.className = 'icon';
    const text = document.createElement('span');
    text.className = 'text';
    text.setAttribute('role', 'status');
    text.setAttribute('aria-live', 'polite');
    text.setAttribute('aria-atomic', 'true');
    const level = document.createElement('strong');
    level.className = 'level';
    const reason = document.createElement('span');
    reason.className = 'reason';
    text.append(level, reason);

    const refreshBtn = makeButton('refresh', 'refresh', t('banner.refresh'));
    const toggleBtn = makeButton('toggle', 'minimize', t('banner.minimize'));
    toggleBtn.setAttribute('aria-expanded', 'true');
    bar.append(icon, text, refreshBtn, toggleBtn);
    shadow.append(bar);

    let minimized = false;
    let visible = false;
    let observed = null;
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => position()) : null;

    refreshBtn.addEventListener('click', () => update(true, true));
    toggleBtn.addEventListener('click', () => {
      minimized = !minimized;
      bar.classList.toggle('minimized', minimized);
      toggleBtn.setAttribute('aria-expanded', String(!minimized));
      toggleBtn.setAttribute('aria-label', t(minimized ? 'banner.expand' : 'banner.minimize'));
      toggleBtn.replaceChildren(DV.icons.create(minimized ? 'expand' : 'minimize'));
      position();
    });

    const anchorTimer = setInterval(() => {
      if (!visible) return;
      if (!host.isConnected) attach();
      position();
    }, ANCHOR_CHECK_MS);
    window.addEventListener('resize', position, { passive: true });

    function makeButton(cls, iconName, label) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + cls;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.append(DV.icons.create(iconName));
      return b;
    }

    function attach() {
      (document.body || document.documentElement).append(host);
    }

    // The anchor is Drive's main landmark, which is part of its accessibility
    // contract and far more stable than its generated class names.
    function findAnchor() {
      let best = null;
      let bestArea = 0;
      for (const m of document.querySelectorAll('[role="main"]')) {
        const r = m.getBoundingClientRect();
        const area = r.width * r.height;
        if (r.width >= 320 && r.height >= 150 && area > bestArea) {
          best = m;
          bestArea = area;
        }
      }
      return best;
    }

    function position() {
      if (!visible) return;
      const anchor = minimized ? null : findAnchor();
      if (anchor !== observed && resizeObserver) {
        if (observed) resizeObserver.unobserve(observed);
        if (anchor) resizeObserver.observe(anchor);
        observed = anchor;
      }
      const s = host.style;
      if (anchor) {
        // Compact pill centred at the top of the content area, overlaying
        // rather than pushing Drive's layout.
        const r = anchor.getBoundingClientRect();
        s.top = Math.max(0, Math.round(r.top + 6)) + 'px';
        s.left = Math.round(r.left + r.width / 2) + 'px';
        s.right = 'auto';
        s.bottom = 'auto';
        s.transform = 'translateX(-50%)';
        s.maxWidth = Math.max(200, Math.round(Math.min(r.width - 32, 760))) + 'px';
      } else {
        // Fallback (and minimized state): floating badge in a corner.
        s.top = 'auto';
        s.left = 'auto';
        s.right = '16px';
        s.bottom = '16px';
        s.transform = 'none';
        s.maxWidth = 'min(480px, calc(100vw - 32px))';
      }
    }

    function render(result) {
      host.style.setProperty('--dv-bg', result.colors.bg);
      host.style.setProperty('--dv-fg', result.colors.fg);
      bar.classList.toggle('emphasis', !!result.emphasis);
      bar.classList.toggle('loading', !!result.loading);
      icon.replaceChildren(DV.icons.create(result.icon));
      level.textContent = result.levelName;
      reason.textContent = ' ' + result.reasonText;
      bar.title = result.levelName + ': ' + result.reasonText;
      refreshBtn.disabled = !!result.loading;
      if (!host.isConnected) attach();
      host.style.display = 'block';
      visible = true;
      position();
    }

    function hide() {
      visible = false;
      host.style.display = 'none';
    }

    function destroy() {
      visible = false;
      clearInterval(anchorTimer);
      window.removeEventListener('resize', position);
      if (resizeObserver) resizeObserver.disconnect();
      host.remove();
    }

    return { render, hide, destroy };
  }

  update(false, true);
})();
