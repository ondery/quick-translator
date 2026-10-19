/*
 * offscreen.js - plays text-to-speech audio for the service worker
 * (service workers cannot play audio themselves).
 * Primary: Google TTS audio clips. Fallback: Web Speech API (local voices).
 */
'use strict';

const audio = new Audio();
let queue = [];
let currentId = 0;
let current = { text: '', lang: '' };

function report(type, id) {
  chrome.runtime.sendMessage({ type, id }).catch(() => {});
}

function speakLocally(id) {
  if (id !== currentId) return;
  queue = [];
  try {
    if (!('speechSynthesis' in self) || !current.text) throw new Error('no speech');
    const u = new SpeechSynthesisUtterance(current.text.slice(0, 32000));
    u.lang = current.lang;
    u.onend = u.onerror = () => { if (id === currentId) report('tx-tts-ended', id); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {
    report('tx-tts-error', id);
  }
}

function playNext(id) {
  if (id !== currentId) return;
  const url = queue.shift();
  if (!url) { report('tx-tts-ended', id); return; }
  audio.src = url;
  audio.play().catch(() => speakLocally(id));
}

audio.addEventListener('ended', () => playNext(currentId));
audio.addEventListener('error', () => { if (audio.getAttribute('src')) speakLocally(currentId); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  if (msg.type === 'play') {
    currentId = msg.id;
    current = { text: String(msg.text || ''), lang: String(msg.lang || '') };
    queue = Array.isArray(msg.urls) ? msg.urls.slice() : [];
    playNext(currentId);
  } else if (msg.type === 'stop') {
    currentId = -1;
    queue = [];
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }
  sendResponse({ ok: true });
  return false;
});
