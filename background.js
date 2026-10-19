/*
 * background.js - Manifest V3 service worker.
 *  - performs all network requests to the translation endpoint (so page CSP
 *    never interferes), with chunking for long texts
 *  - context menu items (translate selection / translate page)
 *  - text-to-speech through an offscreen document (Google TTS audio, with the
 *    Web Speech API inside the offscreen document as fallback)
 *  - anonymous usage statistics (GA4 Measurement Protocol, see lib/analytics.js;
 *    no-op until lib/analytics-config.js is filled in, opt-out in the options)
 */
'use strict';

importScripts('lib/chunker.js', 'lib/languages.js', 'lib/common.js', 'lib/analytics-config.js', 'lib/analytics.js');

const C = self.TxCommon;
const K = self.TxChunker;

// ---------------------------------------------------------------------------
// Anonymous usage statistics (fire-and-forget; never blocks or breaks anything)
// ---------------------------------------------------------------------------

let uiLangSetting = 'auto';
const analytics = self.TxAnalytics.create({
  measurementId: self.GA_MEASUREMENT_ID,
  apiSecret: self.GA_API_SECRET,
  fetch: (url, init) => self.fetch(url, init),
  storageLocal: chrome.storage.local,
  storageSession: chrome.storage.session,
  isEnabled: async () => (await C.getSettings()).analytics !== false,
  version: () => chrome.runtime.getManifest().version,
  uiLanguage: () => C.resolveUiLang(uiLangSetting)
});
C.getSettings().then((s) => { uiLangSetting = s.uiLang; }, () => {});

function track(name, params) {
  try { return analytics.track(name, params); } catch (e) { return Promise.resolve(false); }
}
const surfaceOf = (sender) => (sender && sender.tab ? 'bubble' : 'popup');

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const TTS_ENDPOINT = 'https://translate.googleapis.com/translate_tts';
const CHUNK_SIZE = 1700;     // characters per request
const CONCURRENCY = 3;       // parallel requests for long texts
const MAX_GET_URL = 7500;    // longer requests are sent as POST
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

const cache = new Map(); // `${tl}\u0000${text}` -> {text, src}
const CACHE_MAX = 300;

function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key); cache.set(key, v); // LRU bump
  return v;
}
function cachePut(key, v) {
  cache.set(key, v);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TxError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

async function requestOnce(text, tl) {
  const base = `${ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t`;
  const q = encodeURIComponent(text);
  const init = { credentials: 'omit', cache: 'no-store' };
  let res;
  if (base.length + 3 + q.length <= MAX_GET_URL) {
    res = await fetch(`${base}&q=${q}`, init);
  } else {
    res = await fetch(base, {
      ...init,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `q=${q}`
    });
  }
  return res;
}

const inFlight = new Map(); // identical concurrent requests share one fetch

/** Translate one chunk (<= CHUNK_SIZE chars) with retries; de-duplicated. */
function translateChunk(text, tl) {
  const key = `${tl}\u0000${text}`;
  const hit = cacheGet(key);
  if (hit) return Promise.resolve(hit);
  if (inFlight.has(key)) return inFlight.get(key);
  const p = fetchChunk(text, tl, key).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// Not abortable on purpose: the promise may be shared by several callers;
// callers stop scheduling new chunks once they are cancelled instead.
async function fetchChunk(text, tl, key) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await requestOnce(text, tl);
    } catch (e) {
      if (attempt < MAX_RETRIES) { await sleep(500 * 2 ** attempt); continue; }
      throw new TxError('NETWORK', String(e && e.message || e));
    }

    if (res.ok) {
      let data;
      try { data = await res.json(); } catch (e) { throw new TxError('BAD_RESPONSE'); }
      const parsed = K.parseSingleResponse(data);
      cachePut(key, parsed);
      return parsed;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt < MAX_RETRIES) { await sleep(800 * 2 ** attempt + Math.random() * 300); continue; }
      throw new TxError(res.status === 429 ? 'RATE_LIMIT' : 'NETWORK', 'HTTP ' + res.status);
    }

    // 400/413/414 etc: the request was too large for the server -> split smaller.
    if (text.length > 200) {
      const sub = K.chunkText(text, Math.max(150, Math.floor(text.length / 3)));
      if (sub.length > 1) {
        const parts = [];
        let src = '';
        for (const s of sub) {
          const r = await translateChunk(s.text, tl);
          parts.push(r.text);
          src = src || r.src;
        }
        const joined = { text: K.joinChunks(sub, parts), src };
        cachePut(key, joined);
        return joined;
      }
    }
    throw new TxError('NETWORK', 'HTTP ' + res.status);
  }
}

/**
 * Translate text of any length.
 * @param {(p:{done:number,total:number,partial:string})=>void} [onProgress]
 */
async function translateText(text, tl, { signal, onProgress } = {}) {
  const chunks = K.chunkText(text, CHUNK_SIZE);
  if (!chunks.length) return { text: '', src: '', chunks: 0 };

  const results = new Array(chunks.length);
  let next = 0;
  let done = 0;
  let reportedPrefix = 0;

  const report = () => {
    if (!onProgress) return;
    let prefix = 0;
    while (prefix < chunks.length && results[prefix] !== undefined) prefix++;
    if (prefix === reportedPrefix && done !== chunks.length) { onProgress({ done, total: chunks.length }); return; }
    reportedPrefix = prefix;
    const partial = K.joinChunks(chunks.slice(0, prefix), results.slice(0, prefix).map((r) => r.text));
    onProgress({ done, total: chunks.length, partial });
  };

  async function worker() {
    while (next < chunks.length) {
      if (signal && signal.aborted) throw new TxError('ABORTED');
      const i = next++;
      results[i] = await translateChunk(chunks[i].text, tl);
      done++;
      report();
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(CONCURRENCY, chunks.length); w++) workers.push(worker());
  await Promise.all(workers);

  // Most common detected source language across chunks.
  const counts = {};
  results.forEach((r, i) => { if (r.src) counts[r.src] = (counts[r.src] || 0) + chunks[i].text.length; });
  const src = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';

  return { text: K.joinChunks(chunks, results.map((r) => r.text)), src, chunks: chunks.length };
}

// Port-based protocol (supports progress for long texts):
//   client -> {type:'translate', text, tl}
//   worker -> {type:'progress', done, total, partial?} ... {type:'result', text, src, chunks}
//           | {type:'error', code, message}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'tx-translate') return;
  const controller = new AbortController();
  let closed = false;
  port.onDisconnect.addListener(() => { closed = true; controller.abort(); });
  const post = (m) => { if (!closed) { try { port.postMessage(m); } catch (e) { /* port gone */ } } };

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'translate') return;
    const text = String(msg.text || '');
    // Only metadata is reported - never the text, the translation or the page.
    const stats = { surface: msg.surface, char_count: self.TxAnalytics.charBucket(text.length) };
    let tl = msg.tl;
    try {
      tl = tl || (await C.getSettings()).targetLang;
      const r = await translateText(text, tl, {
        signal: controller.signal,
        onProgress: (p) => post({ type: 'progress', ...p })
      });
      post({ type: 'result', text: r.text, src: r.src, chunks: r.chunks, tl });
      track('translate', { ...stats, source_lang: r.src, target_lang: tl, chunk_count: r.chunks, success: true });
    } catch (e) {
      if (e && e.code === 'ABORTED') return;
      const code = (e && e.code) || 'NETWORK';
      post({ type: 'error', code, message: String(e && e.message || e) });
      track('translate', { ...stats, target_lang: tl, chunk_count: K.chunkText(text, CHUNK_SIZE).length,
        success: false, error_type: self.TxAnalytics.errorType(code) });
    }
  });
});

// ---------------------------------------------------------------------------
// Messages (one-shot)
// ---------------------------------------------------------------------------

const localeCache = {};
async function getLocaleJson(lang) {
  if (C.UI_LANGS.indexOf(lang) === -1) return null;
  if (!localeCache[lang]) {
    const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
    localeCache[lang] = await res.json();
  }
  return localeCache[lang];
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  switch (msg.type) {
    case 'tx-get-locale':
      getLocaleJson(msg.lang).then(sendResponse, () => sendResponse(null));
      return true;

    case 'tx-translate': // simple one-shot variant
      translateText(String(msg.text || ''), msg.tl || C.DEFAULTS.targetLang)
        .then((r) => sendResponse({ ok: true, ...r }))
        .catch((e) => sendResponse({ ok: false, code: (e && e.code) || 'NETWORK' }));
      return true;

    case 'tx-track': // anonymous usage event from the popup / options / bubble
      if (self.TxAnalytics.PAGE_EVENTS.indexOf(msg.name) !== -1) {
        const params = { ...(msg.params || {}) };
        if (sender.tab && 'surface' in params) params.surface = 'bubble'; // content scripts = bubble
        track(msg.name, params);
      }
      sendResponse({ ok: true });
      return false;

    case 'tx-speak':
      track('tts_play', { surface: surfaceOf(sender), target_lang: msg.lang });
      speak(String(msg.text || ''), msg.lang || 'en', sender);
      sendResponse({ ok: true });
      return false;

    case 'tx-stop-speaking':
      stopSpeaking();
      sendResponse({ ok: true });
      return false;

    case 'tx-open-tab':
      if (typeof msg.url === 'string' && /^https:\/\/translate\.google\.com\//.test(msg.url)) {
        const opts = { url: msg.url };
        if (sender.tab) { opts.index = sender.tab.index + 1; opts.openerTabId = sender.tab.id; }
        chrome.tabs.create(opts);
        track('open_google_translate', { surface: surfaceOf(sender) });
      }
      sendResponse({ ok: true });
      return false;

    case 'tx-open-options':
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;

    case 'tx-tts-ended': // from offscreen document
      if (msg.id === ttsState.id) finishSpeaking();
      return false;

    case 'tx-tts-error': // offscreen document could not speak at all
      if (msg.id === ttsState.id) finishSpeaking();
      return false;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------

const ttsState = { id: 0, text: '', lang: '', requester: null };
let creatingOffscreen = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen.html');
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (ctx.length) return;
  }
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play text-to-speech audio of translations.'
    }).catch((e) => { if (!/single offscreen/i.test(String(e))) throw e; })
      .finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

function ttsUrls(text, lang) {
  const parts = K.chunkText(text, 180).map((c) => c.text);
  return parts.map((p, i) => `${TTS_ENDPOINT}?client=gtx&ie=UTF-8&tl=${encodeURIComponent(lang)}` +
    `&total=${parts.length}&idx=${i}&textlen=${p.length}&q=${encodeURIComponent(p)}`);
}

async function speak(text, lang, sender) {
  stopSpeaking(true);
  const id = ++ttsState.id;
  ttsState.text = text;
  ttsState.lang = lang;
  ttsState.requester = sender && sender.tab ? { tabId: sender.tab.id, frameId: sender.frameId } : null;
  if (!text.trim()) { finishSpeaking(); return; }
  try {
    await ensureOffscreen();
    if (id !== ttsState.id) return;
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'play', id, urls: ttsUrls(text, lang), text, lang });
  } catch (e) {
    finishSpeaking();
  }
}

function stopSpeaking(silent) {
  ttsState.id++;
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
  if (!silent) finishSpeaking(true);
}

function finishSpeaking(force) {
  const r = ttsState.requester;
  const msg = { type: 'tx-tts-ended' };
  if (r) chrome.tabs.sendMessage(r.tabId, msg, { frameId: r.frameId }).catch(() => {});
  else chrome.runtime.sendMessage(msg).catch(() => {});
  if (!force) ttsState.requester = null;
}

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

async function buildMenus() {
  const s = await C.getSettings();
  await C.loadLocale(s.uiLang);
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'tx-selection', title: C.t('menuTranslateSelection'), contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'tx-page', title: C.t('menuTranslatePage'), contexts: ['page'] });
  chrome.contextMenus.create({ id: 'tx-page-action', title: C.t('menuTranslatePage'), contexts: ['action'] });
}

chrome.runtime.onInstalled.addListener((details) => {
  buildMenus().catch(console.error);
  const version = chrome.runtime.getManifest().version;
  if (details && details.reason === 'install') {
    track('extension_installed', { version });
  } else if (details && details.reason === 'update' && details.previousVersion !== version) {
    track('extension_updated', { version, previous_version: details.previousVersion });
  }
});
chrome.runtime.onStartup.addListener(() => { buildMenus().catch(console.error); });

// Settings -> analytics names (only these three are ever reported).
const TRACKED_SETTINGS = { targetLang: 'target_lang', popupMode: 'display_mode', uiLang: 'ui_language' };

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.uiLang) {
    uiLangSetting = changes.uiLang.newValue || C.DEFAULTS.uiLang;
    buildMenus().catch(console.error);
  }
  if (changes.analytics && changes.analytics.newValue === false) {
    analytics.optOut(); // drop pending events + forget the anonymous client id
    return;
  }
  Object.keys(TRACKED_SETTINGS).forEach((k) => {
    if (!changes[k]) return;
    const value = changes[k].newValue === undefined ? C.DEFAULTS[k] : changes[k].newValue;
    if (value === (changes[k].oldValue === undefined ? C.DEFAULTS[k] : changes[k].oldValue)) return;
    track('settings_changed', { setting: TRACKED_SETTINGS[k], value });
  });
});

async function sendToFrame(tabId, frameId, msg) {
  return chrome.tabs.sendMessage(tabId, msg, { frameId: frameId || 0 });
}

async function showBubbleInTab(tab, frameId, text) {
  const msg = { type: 'tx-show', text, surface: 'context_menu' };
  try {
    await sendToFrame(tab.id, frameId, msg);
  } catch (e) {
    // Content script not present (page opened before install/reload) -> inject.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId || 0] },
        files: ['lib/languages.js', 'lib/common.js', 'content.js']
      });
      await sleep(150);
      await sendToFrame(tab.id, frameId, msg);
    } catch (e2) {
      console.warn('Cannot show bubble in this page:', e2);
    }
  }
}

function openPageTranslation(tab, tl) {
  if (!tab || !/^https?:/i.test(tab.url || '')) return;
  chrome.tabs.create({ url: C.pageTranslateUrl(tab.url, tl), index: tab.index + 1, openerTabId: tab.id });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const s = await C.getSettings();
  if (info.menuItemId === 'tx-selection' && tab) {
    showBubbleInTab(tab, info.frameId, info.selectionText || '');
  } else if (info.menuItemId === 'tx-page' || info.menuItemId === 'tx-page-action') {
    openPageTranslation(tab && info.pageUrl ? { ...tab, url: info.pageUrl } : tab, s.targetLang);
    track('translate_page', { surface: 'context_menu', target_lang: s.targetLang });
  }
});
