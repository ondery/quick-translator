/*
 * common.js - shared settings + i18n helpers for the service worker, the
 * content script, the toolbar popup and the options page.
 * Exposes self.TxCommon.
 *
 * i18n: the UI follows the "uiLang" option. Default "auto" = the browser's UI
 * language (chrome.i18n.getUILanguage()) if it is one of the 11 supported UI
 * languages, otherwise English. Strings live in _locales/<lang>/messages.json.
 * The UI language is independent of the translation target language.
 */
(function (root) {
  'use strict';

  /** Extension UI languages (folder names under _locales). */
  var UI_LANGS = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt_BR', 'ru', 'ar', 'ja', 'zh_CN'];
  var UI_LANG_NAMES = {
    en: 'English', tr: 'Türkçe', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano',
    pt_BR: 'Português (Brasil)', ru: 'Русский', ar: 'العربية', ja: '日本語', zh_CN: '中文（简体）'
  };
  var RTL_UI = ['ar'];

  var DEFAULTS = Object.freeze({
    targetLang: 'tr',        // translate into (independent of the UI language)
    popupMode: 'icon',       // 'icon' | 'immediate' | 'none'
    alwaysShowIcon: false,   // show even when the page is already in targetLang
    uiLang: 'auto',          // 'auto' (= browser language) or one of UI_LANGS
    analytics: true          // send anonymous usage statistics (opt-out on the options page)
  });

  /**
   * Map a browser/BCP-47 language tag (e.g. "pt-PT", "zh-CN", "de-AT") to one
   * of UI_LANGS; unsupported languages fall back to English.
   */
  function matchUiLang(tag) {
    var t = String(tag || '').replace(/_/g, '-').toLowerCase();
    if (!t) return 'en';
    var base = t.split('-')[0];
    if (base === 'pt') return 'pt_BR';
    if (base === 'zh') {
      // Simplified Chinese for zh, zh-CN, zh-SG, zh-Hans; Traditional variants fall back to English.
      return /^zh(-hans|-cn|-sg|-my)?(-|$)/.test(t) && !/-(hant|tw|hk|mo)(-|$)/.test(t) ? 'zh_CN' : 'en';
    }
    for (var i = 0; i < UI_LANGS.length; i++) if (UI_LANGS[i].toLowerCase() === base) return UI_LANGS[i];
    return 'en';
  }

  function browserUiLang() {
    var ui = '';
    try { ui = chrome.i18n.getUILanguage() || ''; } catch (e) { /* ignore */ }
    return matchUiLang(ui);
  }

  /** Resolve the uiLang setting ('auto' or a code) to a concrete UI_LANGS code. */
  function resolveUiLang(pref) {
    if (pref === 'pt') return 'pt_BR';
    if (pref === 'zh') return 'zh_CN';
    if (UI_LANGS.indexOf(pref) !== -1) return pref;
    return browserUiLang();
  }

  function getSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get(Object.assign({}, DEFAULTS), function (items) {
          if (chrome.runtime.lastError || !items) return resolve(Object.assign({}, DEFAULTS));
          resolve(Object.assign({}, DEFAULTS, items));
        });
      } catch (e) {
        resolve(Object.assign({}, DEFAULTS));
      }
    });
  }

  function saveSettings(patch) {
    return new Promise(function (resolve, reject) {
      chrome.storage.sync.set(patch, function () {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  // ---------- i18n ----------
  var dict = null;
  var dictLang = null;
  var current = 'en'; // resolved UI language code

  function isExtensionPage() {
    return typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
  }

  /** Load messages for the uiLang setting ('auto' or a UI_LANGS code). */
  async function loadLocale(pref) {
    var code = resolveUiLang(pref);
    current = code;
    if (dictLang === code && dict) return code;
    try {
      var json;
      if (isExtensionPage()) {
        var res = await fetch(chrome.runtime.getURL('_locales/' + code + '/messages.json'));
        json = await res.json();
      } else {
        // content scripts can't fetch extension files without exposing them;
        // ask the service worker instead.
        json = await chrome.runtime.sendMessage({ type: 'tx-get-locale', lang: code });
      }
      if (json && typeof json === 'object' && current === code) { dict = json; dictLang = code; }
    } catch (e) {
      if (current === code) { dict = null; dictLang = null; }
    }
    return code;
  }

  function t(key, subs) {
    subs = subs == null ? [] : [].concat(subs).map(String);
    var entry = dict && dict[key];
    if (entry && typeof entry.message === 'string') {
      var msg = entry.message;
      if (entry.placeholders) {
        msg = msg.replace(/\$([A-Za-z0-9_@]+)\$/g, function (m, name) {
          var p = entry.placeholders[name.toLowerCase()];
          return p ? p.content : m;
        });
      }
      return msg.replace(/\$(\d)/g, function (m, d) {
        var v = subs[Number(d) - 1];
        return v != null ? v : '';
      });
    }
    var fromChrome = '';
    try { fromChrome = chrome.i18n.getMessage(key, subs); } catch (e) { /* ignore */ }
    return fromChrome || key;
  }

  /** The UI language currently in effect, e.g. 'tr', 'pt_BR', 'ar'. */
  function uiCode() { return current; }

  /** BCP-47 tag for the UI language ('pt_BR' -> 'pt-BR'). */
  function uiTag(code) { return String(code || current).replace('_', '-'); }

  function uiDir(code) { return RTL_UI.indexOf(code || current) !== -1 ? 'rtl' : 'ltr'; }

  /** Fill [data-i18n], [data-i18n-placeholder], [data-i18n-title] in a DOM tree. */
  function applyI18n(rootNode) {
    rootNode = rootNode || document;
    rootNode.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    rootNode.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });
    rootNode.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
    if (rootNode.documentElement) {
      rootNode.documentElement.lang = uiTag();
      rootNode.documentElement.dir = uiDir();
    }
  }

  // ---------- URLs ----------
  function pageTranslateUrl(pageUrl, tl) {
    return 'https://translate.google.com/translate?sl=auto&tl=' + encodeURIComponent(tl) + '&u=' + encodeURIComponent(pageUrl);
  }

  function openInTranslateUrl(text, tl) {
    var q = String(text || '');
    if (q.length > 5000) q = q.slice(0, 5000); // translate.google.com input limit
    return 'https://translate.google.com/?sl=auto&tl=' + encodeURIComponent(tl) + '&text=' + encodeURIComponent(q) + '&op=translate';
  }

  /**
   * Report an anonymous usage event to the service worker (which validates it
   * against a strict schema and drops it if analytics is off or unconfigured).
   * Never send text, URLs or titles here. Never rejects.
   */
  function track(name, params) {
    try {
      return chrome.runtime.sendMessage({ type: 'tx-track', name: name, params: params || {} }).catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function errorMessageKey(code) {
    if (code === 'RATE_LIMIT') return 'errorRateLimit';
    if (code === 'CONTEXT_INVALIDATED') return 'errorReload';
    return 'errorFetch';
  }

  var api = {
    DEFAULTS: DEFAULTS,
    UI_LANGS: UI_LANGS,
    UI_LANG_NAMES: UI_LANG_NAMES,
    matchUiLang: matchUiLang,
    resolveUiLang: resolveUiLang,
    uiTag: uiTag,
    uiDir: uiDir,
    getSettings: getSettings,
    saveSettings: saveSettings,
    loadLocale: loadLocale,
    t: t,
    uiCode: uiCode,
    applyI18n: applyI18n,
    pageTranslateUrl: pageTranslateUrl,
    openInTranslateUrl: openInTranslateUrl,
    errorMessageKey: errorMessageKey,
    track: track
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TxCommon = api;
})(typeof self !== 'undefined' ? self : this);
