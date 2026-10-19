/*
 * options.js - extension options (stored in chrome.storage.sync).
 * The interface language and the anonymous-statistics switch apply immediately
 * when changed; the other options are applied with "Save".
 */
'use strict';

const C = self.TxCommon;
const L = self.TxLanguages;
const $ = (id) => document.getElementById(id);
let statusTimer = 0;

function fillUiLanguages() {
  const sel = $('uiLang');
  // keep the first option ("same as browser language"), rebuild the rest
  while (sel.options.length > 1) sel.remove(1);
  C.UI_LANGS.forEach((code) => {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = C.UI_LANG_NAMES[code];
    o.lang = C.uiTag(code);
    sel.appendChild(o);
  });
}

function fillLanguages(selected) {
  const sel = $('targetLang');
  sel.replaceChildren();
  L.sorted(C.uiCode()).forEach((l) => {
    const o = document.createElement('option');
    o.value = l.code;
    o.textContent = l.name;
    sel.appendChild(o);
  });
  sel.value = selected || C.DEFAULTS.targetLang;
}

function showValues(s) {
  fillLanguages(s.targetLang);
  const radio = document.querySelector(`input[name="popupMode"][value="${s.popupMode}"]`) ||
                document.querySelector('input[name="popupMode"][value="icon"]');
  radio.checked = true;
  $('alwaysShowIcon').checked = !!s.alwaysShowIcon;
  $('uiLang').value = C.UI_LANGS.indexOf(s.uiLang) !== -1 ? s.uiLang : 'auto';
  $('analytics').checked = s.analytics !== false;
  updateTips();
}

function readValues() {
  const mode = document.querySelector('input[name="popupMode"]:checked');
  return {
    targetLang: $('targetLang').value || C.DEFAULTS.targetLang,
    popupMode: mode ? mode.value : C.DEFAULTS.popupMode,
    alwaysShowIcon: $('alwaysShowIcon').checked,
    uiLang: $('uiLang').value || C.DEFAULTS.uiLang,
    analytics: $('analytics').checked
  };
}

function updateTips() {
  const mode = (document.querySelector('input[name="popupMode"]:checked') || {}).value;
  $('tipNone').hidden = mode !== 'none';
  $('alwaysShowIcon').disabled = mode === 'none';
}

function flash(key) {
  $('status').textContent = C.t(key);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('status').textContent = ''; }, 2500);
}

async function render(s) {
  await C.loadLocale(s.uiLang);
  C.applyI18n(document);
  document.title = C.t('optionsPageTitle');
  showValues(s);
}

async function init() {
  C.track('options_open');
  fillUiLanguages();
  await render(await C.getSettings());

  document.querySelectorAll('input[name="popupMode"]').forEach((r) => r.addEventListener('change', updateTips));

  // Interface language: apply + store immediately (popup and in-page bubble
  // pick it up through chrome.storage.onChanged).
  $('uiLang').addEventListener('change', async () => {
    const values = readValues();
    await C.saveSettings({ uiLang: values.uiLang });
    await render(values);
  });

  // Anonymous usage statistics: opt-out takes effect right away.
  $('analytics').addEventListener('change', async () => {
    await C.saveSettings({ analytics: $('analytics').checked });
    flash('saved');
  });

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = readValues();
    await C.saveSettings(values);
    await render(values);
    flash('saved');
  });

  $('reset').addEventListener('click', async () => {
    // "Reset" never re-enables statistics the user switched off.
    const defaults = Object.assign({}, C.DEFAULTS, { analytics: $('analytics').checked });
    await C.saveSettings(defaults);
    await render(defaults);
    flash('resetDone');
  });

  // Reflect changes made elsewhere (e.g. "Turn off pop-up" in the bubble, the
  // target language in the toolbar popup) without losing unsaved edits.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync') return;
    const cur = readValues();
    let changed = false;
    Object.keys(changes).forEach((k) => {
      if (!(k in C.DEFAULTS)) return;
      const v = changes[k].newValue === undefined ? C.DEFAULTS[k] : changes[k].newValue;
      if (cur[k] !== v) { cur[k] = v; changed = true; }
    });
    if (changed) await render(cur);
  });
}

init();
