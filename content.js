/*
 * content.js - selection icon + in-page translation bubble.
 * Runs in every frame. UI lives in a closed Shadow DOM so page CSS can't
 * affect it. The bubble shows ONLY the translation (never the source text)
 * and handles long selections (chunked by the service worker).
 */
(function () {
  'use strict';

  // If an older copy of this script is running in this frame (extension was
  // reloaded / re-injected), tear it down first.
  if (typeof window.__quickTxCleanup === 'function') {
    try { window.__quickTxCleanup(); } catch (e) { /* ignore */ }
  }

  const C = self.TxCommon;
  const L = self.TxLanguages;
  if (!C || !L) return;

  let settings = Object.assign({}, C.DEFAULTS);
  let host = null;       // <quick-tx-root> element
  let shadow = null;     // closed shadow root
  let iconEl = null;
  let bubbleEl = null;
  let pending = null;    // {text, anchor} for the icon
  let port = null;
  let speaking = false;
  let resizeObs = null;
  let lastAutoText = '';
  const cleanups = [];

  // ---------------------------------------------------------------- helpers

  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  function contextAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  function svg(paths, size) {
    size = size || 18;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  }
  const ICONS = {
    logo: '<rect x="1" y="1" width="22" height="22" rx="5" fill="#1a73e8"/><path d="M6.5 6.5h11v2.6h-4.2V18h-2.6V9.1H6.5z" fill="#fff"/>',
    speaker: '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"/>',
    stop: '<path fill="currentColor" d="M6 6h12v12H6z"/>',
    copy: '<path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/>',
    check: '<path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
    close: '<path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>'
  };

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .icon {
      position: absolute; width: 28px; height: 28px; padding: 2px; margin: 0;
      border: 0; border-radius: 6px; background: #fff; cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center;
      animation: pop .12s ease-out; pointer-events: auto;
    }
    .icon:hover { box-shadow: 0 2px 8px rgba(0,0,0,.45); }
    .bubble {
      position: absolute; display: flex; flex-direction: column;
      min-width: 240px; max-width: min(460px, calc(100vw - 16px));
      background: #fff; color: #202124; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.06);
      font: 14px/1.5 "Segoe UI", Roboto, Arial, "Noto Sans", sans-serif;
      text-align: start; animation: pop .12s ease-out; pointer-events: auto;
      cursor: auto; user-select: text;
    }
    .bubble.wide { width: 460px; }
    .head {
      display: flex; align-items: center; gap: 8px; padding: 8px 8px 4px 12px;
      font-size: 12px; color: #5f6368; flex: none;
    }
    .head .lang { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btn {
      all: unset; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      min-width: 28px; height: 28px; padding: 0 6px; border-radius: 14px; cursor: pointer;
      color: #5f6368; font: 12px/1 "Segoe UI", Roboto, Arial, sans-serif;
    }
    .btn:hover { background: #f1f3f4; color: #202124; }
    .btn:focus-visible { outline: 2px solid #1a73e8; }
    .btn[disabled] { opacity: .4; pointer-events: none; }
    .body {
      padding: 2px 12px 8px; overflow-y: auto; overflow-x: hidden; flex: 1 1 auto;
      overscroll-behavior: contain; max-height: 420px;
    }
    .result { white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere; font-size: 15px; color: #202124; }
    .status { color: #5f6368; font-size: 13px; padding: 4px 0; display: flex; align-items: center; gap: 8px; }
    .status.error { color: #c5221f; }
    .spinner {
      width: 14px; height: 14px; border: 2px solid #c6dafc; border-top-color: #1a73e8;
      border-radius: 50%; animation: spin .8s linear infinite; flex: none;
    }
    .tools { display: flex; align-items: center; gap: 2px; padding: 2px 6px; border-top: 1px solid #ececec; flex: none; }
    .tools .spacer { flex: 1; }
    .foot { display: flex; justify-content: space-between; gap: 12px; padding: 6px 12px 8px; flex: none; }
    .link {
      all: unset; cursor: pointer; color: #1a73e8; font: 600 11px/1.4 "Segoe UI", Roboto, Arial, sans-serif;
      letter-spacing: .3px; text-transform: none;
    }
    .link:hover { text-decoration: underline; }
    .link.muted { color: #5f6368; }
    .notice { padding: 10px 12px; font-size: 13px; color: #202124; }
    @keyframes pop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-color-scheme: dark) {
      .bubble { background: #292a2d; color: #e8eaed; box-shadow: 0 4px 16px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08); }
      .result, .notice { color: #e8eaed; }
      .head, .status, .btn, .link.muted { color: #9aa0a6; }
      .btn:hover { background: #3c4043; color: #e8eaed; }
      .tools { border-top-color: #3c4043; }
      .link { color: #8ab4f8; }
      .icon { background: #292a2d; }
    }
  `;

  // ---------------------------------------------------------------- host

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('quick-tx-root');
    const st = host.style;
    const imp = (k, v) => st.setProperty(k, v, 'important');
    imp('all', 'initial');
    imp('position', 'absolute');
    imp('top', '0');
    imp('left', '0');
    imp('width', '0');
    imp('height', '0');
    imp('margin', '0');
    imp('padding', '0');
    imp('border', '0');
    imp('overflow', 'visible');
    imp('z-index', '2147483647');
    imp('display', 'block');
    imp('pointer-events', 'none');
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);
    (document.documentElement || document.body).appendChild(host);
  }

  // Convert viewport coordinates to coordinates inside the host.
  function hostOrigin() {
    const r = host.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  function isInsideUi(event) {
    if (!host) return false;
    const path = event.composedPath ? event.composedPath() : [];
    return path.indexOf(host) !== -1;
  }

  // ---------------------------------------------------------------- selection

  function deepActiveElement() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  /** @returns {{text:string, anchor:{x:number, top:number, bottom:number}} | null} (viewport coords) */
  function getSelectionInfo(mouse) {
    const ae = deepActiveElement();
    if (ae && ae !== host && (ae.tagName === 'TEXTAREA' ||
        (ae.tagName === 'INPUT' && /^(text|search|url|email|tel)$/i.test(ae.type || 'text')))) {
      try {
        const s = ae.selectionStart, e = ae.selectionEnd;
        if (s != null && e > s) {
          const text = ae.value.slice(s, e);
          if (!text.trim()) return null;
          const r = ae.getBoundingClientRect();
          const y = mouse ? mouse.y : r.bottom;
          return { text, anchor: { x: mouse ? mouse.x : r.left + 10, top: mouse ? y - 10 : r.top, bottom: mouse ? y + 10 : r.bottom } };
        }
      } catch (err) { /* some inputs don't support selection */ }
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString();
    if (!text || !text.trim()) return null;

    // Anchor to the line where the selection ends (or where the mouse is).
    const range = sel.getRangeAt(sel.rangeCount - 1);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
    let line = null;
    if (mouse && rects.length) {
      line = rects.find((r) => mouse.y >= r.top - 2 && mouse.y <= r.bottom + 2) || null;
    }
    if (!line) {
      // focus end of selection: last rect if selected forward, first if backward
      const backward = isBackward(sel);
      line = rects.length ? (backward ? rects[0] : rects[rects.length - 1]) : range.getBoundingClientRect();
    }
    if (!line || (line.width === 0 && line.height === 0 && !mouse)) return null;
    const x = mouse ? mouse.x : line.right;
    return { text, anchor: { x, top: line.top, bottom: line.bottom } };
  }

  function isBackward(sel) {
    try {
      if (!sel.anchorNode || !sel.focusNode) return false;
      if (sel.anchorNode === sel.focusNode) return sel.focusOffset < sel.anchorOffset;
      return !!(sel.anchorNode.compareDocumentPosition(sel.focusNode) & Node.DOCUMENT_POSITION_PRECEDING);
    } catch (e) { return false; }
  }

  function pageLang() {
    const l = (document.documentElement && document.documentElement.lang) || '';
    return l.toLowerCase().split(/[-_]/)[0];
  }

  function sameLanguage(a, b) {
    if (!a || !b) return false;
    const norm = (x) => ({ he: 'iw', jv: 'jw', nb: 'no', fil: 'tl' }[x] || x);
    return norm(String(a).toLowerCase().split(/[-_]/)[0]) === norm(String(b).toLowerCase().split(/[-_]/)[0]);
  }

  // ---------------------------------------------------------------- icon

  function showIcon(info) {
    ensureHost();
    hideIcon();
    pending = info;
    iconEl = document.createElement('button');
    iconEl.className = 'icon';
    iconEl.type = 'button';
    iconEl.title = C.t('openBubble');
    iconEl.setAttribute('aria-label', C.t('openBubble'));
    iconEl.innerHTML = svg(ICONS.logo, 22);
    shadow.appendChild(iconEl);

    const o = hostOrigin();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    let x = info.anchor.x + 6;
    let y = info.anchor.bottom + 4;
    if (y + 32 > vh) y = info.anchor.top - 32;
    x = Math.max(4, Math.min(x, vw - 32));
    y = Math.max(4, y);
    iconEl.style.left = (x - o.x) + 'px';
    iconEl.style.top = (y - o.y) + 'px';

    // Keep the page selection when pressing the icon.
    iconEl.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    iconEl.addEventListener('mouseup', (e) => { e.stopPropagation(); });
    iconEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = pending;
      hideIcon();
      if (p) openBubble(p.text, p.anchor, { auto: false });
    });
  }

  function hideIcon() {
    if (iconEl) { iconEl.remove(); iconEl = null; }
    pending = null;
  }

  // ---------------------------------------------------------------- bubble

  function closeBubble() {
    if (port) { try { port.disconnect(); } catch (e) { /* ignore */ } port = null; }
    if (speaking) stopSpeaking();
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (bubbleEl) { bubbleEl.remove(); bubbleEl = null; }
  }

  function closeAll() {
    hideIcon();
    closeBubble();
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function iconButton(icon, label) {
    const b = el('button', 'btn', svg(icon));
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  }

  /**
   * Open the in-page bubble and translate `text`.
   * @param {object} anchor viewport coords {x, top, bottom}
   * @param {{auto:boolean}} opts auto=true when opened automatically on selection
   */
  function openBubble(text, anchor, opts) {
    opts = opts || {};
    closeAll();
    ensureHost();

    const tl = settings.targetLang || 'tr';
    const ui = C.uiCode();

    const bubble = el('div', 'bubble');
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('dir', C.uiDir());      // UI direction (e.g. RTL for Arabic)
    bubble.setAttribute('lang', C.uiTag());
    bubble.setAttribute('aria-label', C.t('extName'));
    if (text.length > 160) bubble.classList.add('wide');

    // header: detected language + close
    const head = el('div', 'head');
    const logo = el('span', '', svg(ICONS.logo, 16));
    logo.style.display = 'inline-flex';
    const langLabel = el('span', 'lang');
    langLabel.textContent = L.name(tl, ui);
    const closeBtn = iconButton(ICONS.close, C.t('close'));
    head.append(logo, langLabel, closeBtn);

    // body: status + translation ONLY (the source text is never shown)
    const body = el('div', 'body');
    const status = el('div', 'status');
    status.append(el('span', 'spinner'), document.createTextNode(C.t('translating')));
    const result = el('div', 'result');
    result.setAttribute('dir', L.isRtl(tl) ? 'rtl' : 'auto');
    result.setAttribute('lang', tl);
    body.append(status, result);

    // tools: listen, copy
    const tools = el('div', 'tools');
    const listenBtn = iconButton(ICONS.speaker, C.t('listen'));
    const copyBtn = iconButton(ICONS.copy, C.t('copy'));
    listenBtn.disabled = true;
    copyBtn.disabled = true;
    tools.append(listenBtn, copyBtn, el('span', 'spacer'));

    // footer links
    const foot = el('div', 'foot');
    const openLink = el('button', 'link');
    openLink.type = 'button';
    openLink.textContent = C.t('openInTranslate');
    const offLink = el('button', 'link muted');
    offLink.type = 'button';
    offLink.textContent = C.t('turnOffPopup');
    foot.append(openLink, offLink);

    bubble.append(head, body, tools, foot);
    shadow.appendChild(bubble);
    bubbleEl = bubble;

    // Don't let interactions inside the bubble reach the page (which could
    // clear/alter the selection or trigger page handlers).
    ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'contextmenu'].forEach((type) => {
      bubble.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Escape') closeAll();
      });
    });

    // ---- positioning
    const o0 = hostOrigin();
    const a = { x: anchor.x - o0.x, top: anchor.top - o0.y, bottom: anchor.bottom - o0.y }; // host coords
    let side = null;
    const place = () => {
      if (!bubbleEl) return;
      const o = hostOrigin();
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      const top = a.top + o.y, bottom = a.bottom + o.y, x = a.x + o.x; // viewport
      const gap = 8, margin = 8;
      const spaceBelow = vh - bottom - gap - margin;
      const spaceAbove = top - gap - margin;
      if (!side) side = (spaceBelow >= 260 || spaceBelow >= spaceAbove) ? 'below' : 'above';
      const avail = Math.max(160, side === 'below' ? spaceBelow : spaceAbove);
      const fixedH = head.offsetHeight + tools.offsetHeight + foot.offsetHeight;
      body.style.maxHeight = Math.max(80, Math.min(420, avail - fixedH)) + 'px';

      const w = bubble.offsetWidth, h = bubble.offsetHeight;
      let left = Math.max(margin, Math.min(x - 24, vw - w - margin));
      let y = side === 'below' ? bottom + gap : top - gap - h;
      y = Math.max(margin, Math.min(y, vh - h - margin));
      bubble.style.left = (left - o.x) + 'px';
      bubble.style.top = (y - o.y) + 'px';
    };
    place();
    if (typeof ResizeObserver === 'function') {
      resizeObs = new ResizeObserver(() => place());
      resizeObs.observe(result);
    }

    // ---- actions
    let translation = '';
    closeBtn.addEventListener('click', closeAll);
    openLink.addEventListener('click', () => {
      sendMsg({ type: 'tx-open-tab', url: C.openInTranslateUrl(text, tl) });
    });
    offLink.addEventListener('click', () => {
      C.saveSettings({ popupMode: 'none' }).catch(() => {});
      body.replaceChildren(el('div', 'notice'));
      body.firstChild.textContent = C.t('popupTurnedOff');
      tools.remove(); foot.remove();
      setTimeout(() => { if (bubbleEl === bubble) closeAll(); }, 2500);
    });
    copyBtn.addEventListener('click', async () => {
      if (!translation) return;
      const ok = await copyText(translation);
      if (ok) {
        sendMsg({ type: 'tx-track', name: 'copy_translation', params: { surface: 'bubble' } });
        copyBtn.innerHTML = svg(ICONS.check);
        copyBtn.title = C.t('copied');
        setTimeout(() => { copyBtn.innerHTML = svg(ICONS.copy); copyBtn.title = C.t('copy'); }, 1500);
      }
    });
    listenBtn.addEventListener('click', () => {
      if (!translation) return;
      if (speaking) { stopSpeaking(); return; }
      speaking = true;
      setListenState(listenBtn, true);
      sendMsg({ type: 'tx-speak', text: translation, lang: tl });
    });
    bubble._listenBtn = listenBtn;

    // ---- translate (via service worker, chunked for long text)
    const showError = (code) => {
      status.className = 'status error';
      status.replaceChildren(document.createTextNode(C.t(C.errorMessageKey(code))));
      status.style.display = '';
    };

    if (!contextAlive()) { showError('CONTEXT_INVALIDATED'); return; }
    try {
      port = chrome.runtime.connect({ name: 'tx-translate' });
    } catch (e) {
      showError('CONTEXT_INVALIDATED');
      return;
    }
    const myPort = port;
    myPort.onMessage.addListener((m) => {
      if (bubbleEl !== bubble) return;
      if (m.type === 'progress') {
        if (m.total > 1) {
          status.replaceChildren(el('span', 'spinner'), document.createTextNode(C.t('progress', [m.done, m.total])));
        }
        if (typeof m.partial === 'string') result.textContent = m.partial;
      } else if (m.type === 'result') {
        if (opts.auto && !settings.alwaysShowIcon && sameLanguage(m.src, tl)) {
          // Text is already in the target language: nothing to show.
          closeAll();
          return;
        }
        translation = m.text;
        result.textContent = m.text;
        status.style.display = 'none';
        if (m.src) {
          langLabel.textContent = L.name(m.src, ui) + (C.uiDir() === 'rtl' ? '  ←  ' : '  →  ') + L.name(tl, ui);
          langLabel.title = C.t('fromLang', [L.name(m.src, ui)]);
        }
        listenBtn.disabled = !m.text;
        copyBtn.disabled = !m.text;
        try { myPort.disconnect(); } catch (e) { /* ignore */ }
        if (port === myPort) port = null;
        place();
      } else if (m.type === 'error') {
        showError(m.code);
        place();
      }
    });
    myPort.onDisconnect.addListener(() => {
      if (port === myPort) port = null;
      if (bubbleEl === bubble && !translation && status.className.indexOf('error') === -1) {
        void chrome.runtime.lastError;
        showError(contextAlive() ? 'NETWORK' : 'CONTEXT_INVALIDATED');
      }
    });
    myPort.postMessage({ type: 'translate', text, tl, surface: opts.surface === 'context_menu' ? 'context_menu' : 'bubble' });
  }

  function setListenState(btn, on) {
    if (!btn) return;
    btn.innerHTML = svg(on ? ICONS.stop : ICONS.speaker);
    btn.title = C.t(on ? 'stop' : 'listen');
    btn.setAttribute('aria-label', btn.title);
  }

  function stopSpeaking() {
    speaking = false;
    if (bubbleEl) setListenState(bubbleEl._listenBtn, false);
    sendMsg({ type: 'tx-stop-speaking' });
  }

  function sendMsg(msg) {
    if (!contextAlive()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for non-secure pages / missing focus.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        shadow.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  // ---------------------------------------------------------------- events

  let selTimer = 0;

  function handleSelection(mouse) {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      if (!contextAlive()) return;
      const mode = settings.popupMode;
      if (mode === 'none') return;
      const info = getSelectionInfo(mouse);
      if (!info) { hideIcon(); lastAutoText = ''; return; }
      if (bubbleEl && info.text === lastAutoText) return; // same selection, bubble already open
      if (!settings.alwaysShowIcon && sameLanguage(pageLang(), settings.targetLang)) return;
      lastAutoText = info.text;
      if (mode === 'immediate') openBubble(info.text, info.anchor, { auto: true });
      else showIcon(info);
    }, 10);
  }

  function onMouseUp(e) {
    if (e.button !== 0 || isInsideUi(e)) return;
    handleSelection({ x: e.clientX, y: e.clientY });
  }

  function onKeyUp(e) {
    if (isInsideUi(e)) return;
    // Keyboard selection (Shift+arrows) on page text only - never while the
    // user is editing (inputs, textareas, contenteditable) and not Ctrl+A.
    const t = deepActiveElement();
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'Shift' && !e.ctrlKey && !e.metaKey) handleSelection(null);
  }

  function onMouseDown(e) {
    if (isInsideUi(e)) return;
    if (iconEl || bubbleEl) { closeAll(); lastAutoText = ''; }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && (iconEl || bubbleEl)) closeAll();
  }

  function onRuntimeMessage(msg, _sender, sendResponse) {
    if (!msg) return false;
    if (msg.type === 'tx-show') {
      // Prefer the live selection (keeps line breaks); fall back to menu text.
      let info = getSelectionInfo(null);
      if (!info || !info.text.trim()) {
        const vw = document.documentElement.clientWidth || window.innerWidth;
        info = { text: msg.text || '', anchor: { x: vw / 2 - 200, top: 40, bottom: 60 } };
      }
      if (info.text.trim()) openBubble(info.text, info.anchor, { auto: false, surface: msg.surface });
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'tx-tts-ended') {
      speaking = false;
      if (bubbleEl) setListenState(bubbleEl._listenBtn, false);
      return false;
    }
    return false;
  }

  // ---------------------------------------------------------------- init

  function onStorageChanged(changes, area) {
    if (area !== 'sync') return;
    Object.keys(changes).forEach((k) => {
      if (k in C.DEFAULTS) settings[k] = changes[k].newValue === undefined ? C.DEFAULTS[k] : changes[k].newValue;
    });
    if (changes.uiLang) {
      // Apply the new interface language right away: drop UI built with the
      // old strings; the next icon/bubble uses the new language.
      closeAll();
      C.loadLocale(settings.uiLang);
    }
    if (changes.popupMode && settings.popupMode === 'none') hideIcon();
  }

  listen(document, 'mouseup', onMouseUp, true);
  listen(document, 'keyup', onKeyUp, true);
  listen(document, 'mousedown', onMouseDown, true);
  listen(document, 'keydown', onKeyDown, true);
  listen(window, 'resize', () => hideIcon(), { passive: true });

  try {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    chrome.storage.onChanged.addListener(onStorageChanged);
    cleanups.push(() => {
      try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (e) { /* ignore */ }
      try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch (e) { /* ignore */ }
    });
  } catch (e) { /* context invalidated */ }

  window.__quickTxCleanup = function () {
    closeAll();
    cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    if (host) { host.remove(); host = null; }
  };

  C.getSettings().then((s) => {
    settings = s;
    return C.loadLocale(s.uiLang);
  }).catch(() => {});
})();
