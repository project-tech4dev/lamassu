// Options page (C3). Managed policy values win and are shown read-only.
(() => {
  'use strict';
  const { t, levelName } = DV.strings;
  const S = DV.settings;
  const L = DV.levels;
  const $ = (id) => document.getElementById(id);

  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  document.title = t('options.title');

  let managed = { keys: [], colorLevels: [] };
  const colorInputs = {};

  function buildColorRows() {
    const box = $('colors');
    for (const level of L.CONFIGURABLE) {
      const row = document.createElement('div');
      row.className = 'color-row';
      const id = 'color-' + level;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = levelName(level);
      const input = document.createElement('input');
      input.type = 'color';
      input.id = id;
      const preview = document.createElement('div');
      preview.className = 'preview';
      preview.setAttribute('aria-label', t('options.preview'));
      preview.textContent = levelName(level);
      input.addEventListener('input', () => paintPreview(level));
      row.append(label, input, preview);
      box.append(row);
      colorInputs[level] = { input, preview };
    }
  }

  function paintPreview(level) {
    const { input, preview } = colorInputs[level];
    const bg = L.isHexColor(input.value) ? input.value : L.DEFAULT_COLORS[level];
    preview.style.background = bg;
    preview.style.color = L.textColorFor(bg);
  }

  function setManaged(key, isManaged) {
    const field = $('field-' + key);
    field.querySelector('.managed').hidden = !isManaged;
    $(key).disabled = isManaged;
  }

  function fill(values) {
    $('allowedDomains').value = values.allowedDomains.join('\n');
    $('cacheMinutes').value = String(values.cacheMinutes);
    $('publicLinkSameAsDiscoverable').checked = values.publicLinkSameAsDiscoverable;
    for (const level of L.CONFIGURABLE) {
      colorInputs[level].input.value = values.colors[level];
      colorInputs[level].input.disabled = managed.colorLevels.includes(level);
      colorInputs[level].input.title = colorInputs[level].input.disabled ? t('options.managed') : '';
      paintPreview(level);
    }
    for (const key of ['allowedDomains', 'cacheMinutes', 'publicLinkSameAsDiscoverable']) {
      setManaged(key, managed.keys.includes(key));
    }
  }

  function showStatus(text, isError) {
    const s = $('status');
    s.textContent = text;
    s.classList.toggle('error', !!isError);
  }

  async function load() {
    const loaded = await S.load();
    managed = loaded.managed;
    fill(loaded.values);
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const raw = {
      allowedDomains: $('allowedDomains').value.split(/[\s,]+/).filter(Boolean),
      cacheMinutes: $('cacheMinutes').value === '' ? undefined : Number($('cacheMinutes').value),
      publicLinkSameAsDiscoverable: $('publicLinkSameAsDiscoverable').checked,
      colors: {},
    };
    for (const level of L.CONFIGURABLE) {
      if (!colorInputs[level].input.disabled) raw.colors[level] = colorInputs[level].input.value;
    }
    const { values, invalidDomains, invalidCache } = S.sanitize(raw);
    if (invalidDomains.length) return showStatus(t('options.invalidDomains', { list: invalidDomains.join(', ') }), true);
    if (invalidCache) return showStatus(t('options.invalidCache'), true);
    // Do not persist values for keys the administrator controls.
    for (const key of managed.keys) delete values[key];
    await S.saveLocal(values);
    await load();
    showStatus(t('options.saved'), false);
  });

  $('reset').addEventListener('click', async () => {
    await S.resetLocal();
    await load();
    showStatus(t('options.resetDone'), false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'managed') load();
  });

  buildColorRows();
  load();
})();
