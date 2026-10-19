/*
 * analytics.js - privacy-safe usage statistics via the GA4 Measurement Protocol.
 * Runs in the service worker only (MV3: no remote code, no gtag.js).
 * Exposes self.TxAnalytics = { create, sanitize, charBucket, isConfigured, ... }.
 *
 * Guarantees:
 *  - silent no-op while lib/analytics-config.js still holds the placeholders;
 *  - nothing is sent when the user turned off "Send anonymous usage statistics"
 *    (setting `analytics` in chrome.storage.sync, default true);
 *  - every event goes through a strict allowlist schema: unknown events and
 *    parameters are dropped and every value must match an enum / language-code
 *    / version / small-integer pattern, so selected text, translations, page
 *    URLs or titles can never end up in a payload;
 *  - fire-and-forget: batched, errors swallowed, never blocks translation.
 */
(function (root) {
  'use strict';

  var ENDPOINT = 'https://www.google-analytics.com/mp/collect';
  var PLACEHOLDER_ID = 'G-XXXXXXXXXX';
  var PLACEHOLDER_SECRET = 'REPLACE_ME';
  var SESSION_TIMEOUT_MS = 30 * 60 * 1000; // GA4 default session timeout
  var ENGAGEMENT_TIME_MSEC = 100;           // >0 so GA4 counts active users / engaged sessions
  var MAX_BATCH = 25;                       // Measurement Protocol limit per request
  var FLUSH_DELAY_MS = 1000;
  var CLIENT_ID_KEY = 'gaClientId';         // chrome.storage.local
  var SESSION_KEY = 'gaSession';            // chrome.storage.session

  var SURFACES = ['bubble', 'popup', 'context_menu'];
  var BUCKETS = ['0-100', '100-500', '500-2000', '2000+'];
  var ERRORS = ['network', 'rate_limit', 'bad_response', 'context_invalidated', 'unknown'];
  var MODES = ['icon', 'immediate', 'none'];
  var UI_CODES = ['auto', 'en', 'tr', 'de', 'fr', 'es', 'it', 'pt_BR', 'ru', 'ar', 'ja', 'zh_CN'];
  var LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/;   // Google codes: en, zh-CN, mni-Mtei, haw ...
  var VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

  function isLang(v) { return typeof v === 'string' && v.length <= 8 && LANG_RE.test(v); }
  function oneOf(list) { return function (v) { return list.indexOf(v) !== -1; }; }

  var V = {
    surface: oneOf(SURFACES),
    lang: isLang,
    version: function (v) { return typeof v === 'string' && VERSION_RE.test(v); },
    bucket: oneOf(BUCKETS),
    count: function (v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100000 && Math.floor(v) === v; },
    bool: function (v) { return v === true || v === false; },
    error: oneOf(ERRORS),
    setting: oneOf(['target_lang', 'display_mode', 'ui_language'])
  };

  /** Allowed events and their parameters (name -> validator). */
  var SCHEMA = {
    extension_installed: { version: V.version },
    extension_updated: { version: V.version, previous_version: V.version },
    translate: { surface: V.surface, source_lang: V.lang, target_lang: V.lang, char_count: V.bucket,
                 chunk_count: V.count, success: V.bool, error_type: V.error },
    tts_play: { surface: V.surface, target_lang: V.lang },
    copy_translation: { surface: V.surface },
    open_google_translate: { surface: V.surface },
    translate_page: { surface: V.surface, target_lang: V.lang },
    settings_changed: { setting: V.setting, value: function () { return true; } }, // checked per setting below
    popup_open: {},
    options_open: {}
  };
  var SETTING_VALUE = { target_lang: isLang, display_mode: oneOf(MODES), ui_language: oneOf(UI_CODES) };

  /** Events extension pages / the content script may report through 'tx-track'. */
  var PAGE_EVENTS = ['copy_translation', 'open_google_translate', 'translate_page', 'popup_open', 'options_open'];

  function charBucket(n) {
    n = Number(n) || 0;
    if (n <= 100) return '0-100';
    if (n <= 500) return '100-500';
    if (n <= 2000) return '500-2000';
    return '2000+';
  }

  function errorType(code) {
    var c = String(code || '').toLowerCase();
    return ERRORS.indexOf(c) !== -1 ? c : 'unknown';
  }

  /**
   * Return a clean copy of the params for an allowed event, or null.
   * Booleans are sent as the strings "true"/"false" (GA4 params are strings or numbers).
   */
  function sanitize(name, params) {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(SCHEMA, name)) return null;
    var schema = SCHEMA[name];
    var out = {};
    params = params && typeof params === 'object' ? params : {};
    Object.keys(schema).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) return;
      var v = params[k];
      if (!schema[k](v)) return;
      out[k] = typeof v === 'boolean' ? String(v) : v;
    });
    if (name === 'settings_changed') {
      if (!out.setting || !SETTING_VALUE[out.setting](params.value)) return null;
      out.value = params.value;
    }
    return out;
  }

  function isConfigured(id, secret) {
    return typeof id === 'string' && /^G-[A-Z0-9]{4,20}$/.test(id) && id !== PLACEHOLDER_ID &&
      typeof secret === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(secret) && secret !== PLACEHOLDER_SECRET;
  }

  function uuid() {
    var c = typeof crypto !== 'undefined' ? crypto : root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /**
   * deps: { measurementId, apiSecret, fetch, storageLocal, storageSession,
   *         isEnabled():Promise<bool>, version():string, uiLanguage():string,
   *         now():number, setTimeout }
   * storage*: chrome.storage.local / chrome.storage.session (promise API).
   */
  function create(deps) {
    deps = deps || {};
    var configured = isConfigured(deps.measurementId, deps.apiSecret);
    var now = deps.now || Date.now;
    var timer = deps.setTimeout || setTimeout;
    var queue = [];
    var flushTimer = null;
    var chain = Promise.resolve();
    var memSession = null;

    function serial(fn) {
      var p = chain.then(fn, fn);
      chain = p.catch(function () {});
      return p;
    }

    async function enabled() {
      if (!configured) return false;
      try { return (await deps.isEnabled()) !== false; } catch (e) { return false; }
    }

    async function clientId() {
      var got = await deps.storageLocal.get(CLIENT_ID_KEY);
      var id = got && got[CLIENT_ID_KEY];
      if (typeof id !== 'string' || !id) {
        id = uuid();
        var o = {}; o[CLIENT_ID_KEY] = id;
        await deps.storageLocal.set(o);
      }
      return id;
    }

    async function sessionId() {
      var t = now();
      var s = memSession;
      if (deps.storageSession) {
        try { var got = await deps.storageSession.get(SESSION_KEY); s = got && got[SESSION_KEY]; } catch (e) { /* ignore */ }
      }
      if (!s || !s.id || t - s.last > SESSION_TIMEOUT_MS) s = { id: String(Math.floor(t / 1000)), last: t };
      s.last = t;
      memSession = s;
      if (deps.storageSession) {
        var o = {}; o[SESSION_KEY] = s;
        try { await deps.storageSession.set(o); } catch (e) { /* ignore */ }
      }
      return s.id;
    }

    /** Queue an event. Never throws; resolves to true if queued. */
    function track(name, params) {
      if (!configured) return Promise.resolve(false); // placeholders: complete no-op
      var clean = sanitize(name, params);
      if (!clean) return Promise.resolve(false);
      return serial(async function () {
        if (!(await enabled())) return false;
        clean.session_id = await sessionId();
        clean.engagement_time_msec = ENGAGEMENT_TIME_MSEC;
        try { clean.ui_language = String(deps.uiLanguage() || ''); } catch (e) { clean.ui_language = ''; }
        if (UI_CODES.indexOf(clean.ui_language) === -1) delete clean.ui_language;
        try { clean.extension_version = String(deps.version() || ''); } catch (e) { clean.extension_version = ''; }
        if (!VERSION_RE.test(clean.extension_version)) delete clean.extension_version;
        queue.push({ name: name, params: clean });
        schedule();
        return true;
      }).catch(function () { return false; });
    }

    function schedule() {
      if (queue.length >= MAX_BATCH) { flush(); return; }
      if (!flushTimer) flushTimer = timer(function () { flushTimer = null; flush(); }, FLUSH_DELAY_MS);
    }

    /** Send queued events (batches of <= 25). Never throws. */
    function flush() {
      return serial(async function () {
        while (queue.length) {
          var batch = queue.splice(0, MAX_BATCH);
          if (!(await enabled())) { queue.length = 0; return; }
          var body = JSON.stringify({ client_id: await clientId(), non_personalized_ads: true, events: batch });
          var url = ENDPOINT + '?measurement_id=' + encodeURIComponent(deps.measurementId) +
            '&api_secret=' + encodeURIComponent(deps.apiSecret);
          try {
            await deps.fetch(url, { method: 'POST', body: body, keepalive: true, credentials: 'omit', cache: 'no-store' });
          } catch (e) { /* fire-and-forget */ }
        }
      }).catch(function () {});
    }

    /** User turned statistics off: drop pending events and forget the client id. */
    function optOut() {
      queue.length = 0;
      memSession = null;
      return serial(async function () {
        try { await deps.storageLocal.remove(CLIENT_ID_KEY); } catch (e) { /* ignore */ }
        if (deps.storageSession) { try { await deps.storageSession.remove(SESSION_KEY); } catch (e) { /* ignore */ } }
      }).catch(function () {});
    }

    return {
      configured: configured,
      track: track,
      flush: flush,
      optOut: optOut,
      pending: function () { return queue.slice(); }
    };
  }

  var api = {
    ENDPOINT: ENDPOINT,
    SCHEMA: SCHEMA,
    PAGE_EVENTS: PAGE_EVENTS,
    SURFACES: SURFACES,
    create: create,
    sanitize: sanitize,
    charBucket: charBucket,
    errorType: errorType,
    isConfigured: isConfigured
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TxAnalytics = api;
})(typeof self !== 'undefined' ? self : this);
