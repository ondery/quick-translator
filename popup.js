/*
 * popup.js - toolbar popup: translate typed/pasted text or the current
 * selection of the active tab; translate whole page; open options.
 */
'use strict';

const C = self.TxCommon;
const L = self.TxLanguages;
const $ = (id) => document.getElementById(id);

const SVG = {
  speaker: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"/></svg>',
  stop: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
};

let settings = Object.assign({}, C.DEFAULTS);
let activeTab = null;
let port = null;
let translation = '';
let lastTranslated = { text: null, tl: null };
let speaking = false;
let debounce = 0;

function updateCount() {
  const n = $('input').value.length;
  $('count').textContent = n ? C.t('charCount', [n.toLocaleString(C.uiTag())]) : '';
}

function setStatus(kind, text) {
  const st = $('status');
  if (!kind) { st.hidden = true; return; }
  st.hidden = false;
  st.className = 'status' + (kind === 'error' ? ' error' : '');
  st.replaceChildren();
  if (kind === 'loading') {
    const sp = document.createElement('span');
    sp.className = 'spinner';
    st.appendChild(sp);
  }
  st.appendChild(document.createTextNode(text));
}

function setListen(on) {
  speaking = on;
  $('listenBtn').innerHTML = on ? SVG.stop : SVG.speaker;
  $('listenBtn').title = C.t(on ? 'stop' : 'listen');
}

function translate(force) {
  const text = $('input').value;
  const tl = $('target').value;
  if (!text.trim()) {
    $('output').hidden = false;
    $('result').textContent = '';
    $('detected').textContent = '';
    setStatus('error', C.t('errorEmpty'));
    return;
  }
  if (!force && lastTranslated.text === text && lastTranslated.tl === tl) return;
  lastTranslated = { text, tl };

  if (port) { try { port.disconnect(); } catch (e) { /* ignore */ } }
  if (speaking) { chrome.runtime.sendMessage({ type: 'tx-stop-speaking' }).catch(() => {}); setListen(false); }
  translation = '';
  $('output').hidden = false;
  $('result').textContent = '';
  $('result').setAttribute('lang', tl);
  $('result').setAttribute('dir', L.isRtl(tl) ? 'rtl' : 'auto');
  $('detected').textContent = L.name(tl, C.uiCode());
  $('listenBtn').disabled = true;
  $('copyBtn').disabled = true;
  $('translateBtn').disabled = true;
  setStatus('loading', C.t('translating'));

  const myPort = chrome.runtime.connect({ name: 'tx-translate' });
  port = myPort;
  myPort.onMessage.addListener((m) => {
    if (port !== myPort) return;
    if (m.type === 'progress') {
      if (m.total > 1) setStatus('loading', C.t('progress', [m.done, m.total]));
      if (typeof m.partial === 'string') $('result').textContent = m.partial;
    } else if (m.type === 'result') {
      translation = m.text;
      $('result').textContent = m.text;
      setStatus(null);
      const ui = C.uiCode();
      $('detected').textContent = m.src ? L.name(m.src, ui) + (C.uiDir() === 'rtl' ? ' ← ' : ' → ') + L.name(tl, ui) : L.name(tl, ui);
      $('listenBtn').disabled = !m.text;
      $('copyBtn').disabled = !m.text;
      $('translateBtn').disabled = false;
      myPort.disconnect();
      port = null;
    } else if (m.type === 'error') {
      setStatus('error', C.t(C.errorMessageKey(m.code)));
      $('translateBtn').disabled = false;
      lastTranslated = { text: null, tl: null };
    }
  });
  myPort.onDisconnect.addListener(() => {
    if (port === myPort) {
      port = null;
      $('translateBtn').disabled = false;
      if (!translation) setStatus('error', C.t('errorFetch'));
    }
  });
  myPort.postMessage({ type: 'translate', text, tl, surface: 'popup' });
}

/** Selected text in the active tab (any accessible frame), via activeTab + scripting. */
async function getTabSelection(tab) {
  if (!tab || !/^(https?|file|ftp):/i.test(tab.url || '') && tab.url) return '';
  const func = () => {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) {
      try {
        if (a.selectionEnd > a.selectionStart) return a.value.slice(a.selectionStart, a.selectionEnd);
      } catch (e) { /* not a text input */ }
    }
    const s = window.getSelection();
    return s ? s.toString() : '';
  };
  const pick = (results) => {
    const list = (results || []).filter((r) => r && typeof r.result === 'string' && r.result.trim());
    list.sort((x, y) => (x.frameId === 0 ? -1 : 0) - (y.frameId === 0 ? -1 : 0));
    return list.length ? list[0].result : '';
  };
  try {
    return pick(await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func }));
  } catch (e) {
    try {
      return pick(await chrome.scripting.executeScript({ target: { tabId: tab.id }, func }));
    } catch (e2) {
      return '';
    }
  }
}

function fillLanguages() {
  const sel = $('target');
  sel.replaceChildren();
  L.sorted(C.uiCode()).forEach((l) => {
    const o = document.createElement('option');
    o.value = l.code;
    o.textContent = l.name;
    sel.appendChild(o);
  });
  sel.value = settings.targetLang;
  if (!sel.value) sel.value = 'tr';
}

async function applyUiLanguage() {
  await C.loadLocale(settings.uiLang);
  C.applyI18n(document);
  document.title = C.t('extName');
  fillLanguages();
  setListen(speaking);
  $('copyBtn').title = C.t('copy');
  updateCount();
}

async function init() {
  settings = await C.getSettings();
  C.track('popup_open');
  await applyUiLanguage();
  $('copyBtn').innerHTML = SVG.copy;
  // Interface language changed in the options page -> re-render right away.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.uiLang) return;
    settings.uiLang = changes.uiLang.newValue || C.DEFAULTS.uiLang;
    applyUiLanguage();
  });

  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageOk = activeTab && /^https?:/i.test(activeTab.url || '');
  if (!pageOk) {
    $('translatePage').classList.add('disabled');
    $('translatePage').title = C.t('pageNotTranslatable');
  }

  // Events
  $('translateBtn').addEventListener('click', () => translate(true));
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); translate(true); }
  });
  $('input').addEventListener('input', () => {
    updateCount();
    clearTimeout(debounce);
    if ($('input').value.length <= 3000) debounce = setTimeout(() => { if ($('input').value.trim()) translate(false); }, 800);
  });
  $('target').addEventListener('change', () => {
    settings.targetLang = $('target').value;
    C.saveSettings({ targetLang: settings.targetLang }).catch(() => {});
    if ($('input').value.trim()) translate(true);
  });
  $('copyBtn').addEventListener('click', async () => {
    if (!translation) return;
    try {
      await navigator.clipboard.writeText(translation);
      C.track('copy_translation', { surface: 'popup' });
      $('copyBtn').innerHTML = SVG.check;
      $('copyBtn').title = C.t('copied');
      setTimeout(() => { $('copyBtn').innerHTML = SVG.copy; $('copyBtn').title = C.t('copy'); }, 1500);
    } catch (e) { /* ignore */ }
  });
  $('listenBtn').addEventListener('click', () => {
    if (!translation) return;
    if (speaking) {
      chrome.runtime.sendMessage({ type: 'tx-stop-speaking' }).catch(() => {});
      setListen(false);
    } else {
      setListen(true);
      chrome.runtime.sendMessage({ type: 'tx-speak', text: translation, lang: $('target').value }).catch(() => setListen(false));
    }
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'tx-tts-ended') setListen(false);
  });
  $('openTranslate').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: C.openInTranslateUrl($('input').value, $('target').value) });
    C.track('open_google_translate', { surface: 'popup' });
  });
  $('translatePage').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!pageOk) return;
    chrome.tabs.create({ url: C.pageTranslateUrl(activeTab.url, $('target').value), index: activeTab.index + 1 });
    // let the (tiny) analytics message leave before the popup closes
    await Promise.race([C.track('translate_page', { surface: 'popup', target_lang: $('target').value }), new Promise((r) => setTimeout(r, 300))]);
    window.close();
  });
  $('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Pre-fill with the page selection and translate it right away.
  const selected = await getTabSelection(activeTab);
  if (selected && selected.trim()) {
    $('input').value = selected.trim();
    updateCount();
    translate(true);
  }
  $('input').focus();
}

init();
