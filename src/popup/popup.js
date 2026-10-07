// Popup panel (F16 to F18). Talks to the content script in the active tab,
// which holds the latest result for the folder on screen.
(() => {
  'use strict';
  const { t } = DV.strings;
  const $ = (id) => document.getElementById(id);

  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  document.title = t('popup.title');

  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? tab.id : null;
  }

  async function ask(type) {
    const id = await activeTabId();
    if (id === null) return null;
    try {
      return await chrome.tabs.sendMessage(id, { type });
    } catch (e) {
      return null; // No content script: not a Drive tab.
    }
  }

  function setSummary(level, levelName, reasonText, colors, emphasis, iconName) {
    const s = $('summary');
    s.style.setProperty('--sum-bg', colors.bg);
    s.style.setProperty('--sum-fg', colors.fg);
    s.classList.toggle('emphasis', !!emphasis);
    $('summary-icon').replaceChildren(DV.icons.create(iconName));
    $('summary-level').textContent = levelName;
    $('summary-reason').textContent = reasonText;
    s.dataset.level = level;
  }

  function showMessage(key) {
    setSummary('UNKNOWN', DV.strings.levelName('UNKNOWN'), t(key), DV.levels.colorsFor('UNKNOWN'), false, 'help');
    $('meta').hidden = true;
    $('table-wrap').hidden = true;
    $('refresh').hidden = true;
    $('signin').hidden = true;
  }

  function formatTime(ts) {
    if (!ts) return t('popup.none');
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function whoText(e) {
    let s;
    if (e.type === 'anyone') s = t(e.allowFileDiscovery ? 'who.anyoneDiscoverable' : 'who.anyoneLink');
    else if (e.type === 'domain') s = t('who.domain', { domain: e.domain || t('who.unknown') });
    else s = e.emailAddress || t('who.unknown');
    return e.deleted ? s + t('who.deleted') : s;
  }

  function chipClass(access) {
    if (access === 'public_discoverable' || access === 'public_link') return 'public';
    if (access === 'external') return 'external';
    if (access === 'unknown') return 'unknown';
    return 'neutral';
  }

  function cell(text, cls) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  function lookup(prefix, value) {
    const key = prefix + value;
    const s = t(key);
    return s === key ? value || t('popup.none') : s;
  }

  function renderEntries(entries) {
    const rows = $('rows');
    rows.replaceChildren();
    for (const e of entries) {
      const tr = document.createElement('tr');
      if (e.deleted) tr.className = 'deleted';
      tr.append(cell(whoText(e), 'who'), cell(lookup('type.', e.type)), cell(lookup('role.', e.role)));
      const access = document.createElement('td');
      const chip = document.createElement('span');
      chip.className = 'chip ' + chipClass(e.access);
      chip.textContent = lookup('access.', e.access);
      access.append(chip);
      tr.append(access, cell(lookup('source.', e.source)));
      rows.append(tr);
    }
    $('caption').textContent = entries.length ? t('popup.tableCaption', { count: entries.length }) : t('popup.noEntries');
    $('table-wrap').hidden = entries.length === 0;
  }

  function render(result) {
    setSummary(result.level, result.levelName, result.reasonText, result.colors, result.emphasis, result.icon);
    $('message').hidden = true;
    $('meta').hidden = false;
    $('account').textContent = result.accountEmail || t('popup.none');
    const showDrive = !!result.driveEmail && result.driveEmail !== result.accountEmail;
    $('drive-row').hidden = !showDrive;
    $('drive-account').textContent = showDrive ? result.driveEmail : '';
    const time = formatTime(result.fetchedAt || result.checkedAt);
    $('checked').textContent = result.fromCache ? t('popup.cached', { time }) : time;
    $('refresh').hidden = false;
    $('signin').hidden = result.code !== 'auth_required';
    renderEntries(result.entries || []);
  }

  function handle(res) {
    if (!res) return showMessage('popup.noDrive');
    if (!res.folder) return showMessage('popup.notFolder');
    if (!res.result) return showMessage('popup.loading');
    render(res.result);
  }

  async function busy(button, fn) {
    button.disabled = true;
    try {
      await fn();
    } finally {
      button.disabled = false;
    }
  }

  $('refresh').addEventListener('click', () => busy($('refresh'), async () => {
    $('summary-reason').textContent = t('popup.loading');
    handle(await ask('dv:refresh'));
    $('refresh').focus();
  }));

  $('signin').addEventListener('click', () => busy($('signin'), async () => {
    const r = await chrome.runtime.sendMessage({ type: 'dv:signIn' });
    handle(await ask('dv:refresh'));
    if (!r || !r.ok) {
      const detail = (r && r.detail) || (r && r.code) || t('error.internal_error');
      $('message').textContent = t('popup.signInFailed', { detail });
      $('message').hidden = false;
    }
  }));

  $('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  showMessage('popup.loading');
  ask('dv:getDetails').then(handle);
})();
