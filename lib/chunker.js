/*
 * chunker.js - splits long text into translation-sized chunks and joins the
 * translated chunks back together while preserving the original separators
 * (paragraph breaks, line breaks, spaces).
 *
 * Works as a classic script (exposes self.TxChunker), via importScripts() in
 * the service worker, and as a CommonJS module for Node unit tests.
 */
(function (root) {
  'use strict';

  var DEFAULT_MAX = 1700;

  // Sentence end: . ! ? … 。 ！ ？ ؟ । followed by optional closing quotes/brackets and whitespace.
  var SENTENCE_RE = /[^.!?…。！？؟।]*(?:[.!?…。！？؟।]+["'”’»)\]]*\s*|$)/g;

  function splitSentences(text) {
    var out = [];
    var m;
    SENTENCE_RE.lastIndex = 0;
    while ((m = SENTENCE_RE.exec(text)) !== null) {
      if (m[0] === '') { // zero-length match at end
        if (SENTENCE_RE.lastIndex >= text.length) break;
        SENTENCE_RE.lastIndex++;
        continue;
      }
      out.push(m[0]);
      if (SENTENCE_RE.lastIndex >= text.length) break;
    }
    return out;
  }

  // Break a single piece (no newlines) that is longer than max into parts of
  // at most max chars, preferring sentence boundaries, then whitespace.
  function splitLongPiece(piece, max) {
    var parts = [];
    var sentences = splitSentences(piece);
    var cur = '';
    sentences.forEach(function (s) {
      if (s.length > max) {
        if (cur) { parts.push(cur); cur = ''; }
        // split by words
        var words = s.match(/\S+\s*/g) || [s];
        words.forEach(function (w) {
          while (w.length > max) { // a "word" longer than max (e.g. no spaces, CJK)
            if (cur) { parts.push(cur); cur = ''; }
            parts.push(w.slice(0, max));
            w = w.slice(max);
          }
          if ((cur + w).length > max) { parts.push(cur); cur = ''; }
          cur += w;
        });
      } else {
        if ((cur + s).length > max) { parts.push(cur); cur = ''; }
        cur += s;
      }
    });
    if (cur) parts.push(cur);
    return parts;
  }

  /**
   * Split text into chunks.
   * @returns {Array<{text: string, sep: string}>} - `text` is the chunk to
   *   translate (trimmed), `sep` the exact whitespace that followed it in the
   *   original (re-inserted when joining). `lead` holds leading whitespace of
   *   the whole text on the result array.
   */
  function chunkText(text, maxLen) {
    var max = Math.max(50, maxLen || DEFAULT_MAX);
    text = String(text == null ? '' : text).replace(/\r\n?/g, '\n');

    // Tokenize into "units": [content, followingWhitespace]. A unit is a line
    // (or a part of an over-long line). Separators containing newlines are
    // kept verbatim so paragraph structure survives.
    var units = [];
    var lead = (text.match(/^\s*/) || [''])[0];
    var body = text.slice(lead.length);
    var lineRe = /([^\n]*?)([ \t\u00a0]*(?:\n[ \t\u00a0]*)+|[ \t\u00a0]*$)/g;
    var m;
    while ((m = lineRe.exec(body)) !== null) {
      var content = m[1];
      var sep = m[2];
      if (content === '' && sep === '') break;
      if (content.length > max) {
        var parts = splitLongPiece(content, max);
        parts.forEach(function (p, i) {
          var pm = p.match(/^([\s\S]*?)(\s*)$/);
          units.push({ text: pm[1], sep: i === parts.length - 1 ? pm[2] + sep : pm[2] });
        });
      } else {
        units.push({ text: content, sep: sep });
      }
      if (lineRe.lastIndex >= body.length) break;
    }

    // Pack units into chunks <= max (counting separators).
    var chunks = [];
    var cur = null;
    units.forEach(function (u) {
      if (!cur) { cur = { text: u.text, sep: u.sep }; return; }
      var candidate = cur.text + cur.sep + u.text;
      if (candidate.length <= max) {
        cur = { text: candidate, sep: u.sep };
      } else {
        chunks.push(cur);
        cur = { text: u.text, sep: u.sep };
      }
    });
    if (cur) chunks.push(cur);

    // Drop chunks that are empty (only possible for whitespace-only input).
    chunks = chunks.filter(function (c) { return c.text.trim() !== ''; });
    chunks.lead = lead;
    return chunks;
  }

  /**
   * Join translated chunks using the separators recorded by chunkText.
   * Translated chunks are trimmed of trailing whitespace the server may add.
   */
  function joinChunks(chunks, translated) {
    var out = ''; // leading/trailing whitespace of the whole text is dropped
    for (var i = 0; i < chunks.length; i++) {
      var t = translated[i];
      if (t == null) t = '';
      t = String(t).replace(/^\s+|\s+$/g, '');
      out += t + (i < chunks.length - 1 ? chunks[i].sep : '');
    }
    return out;
  }

  /** Parse a translate_a/single (dt=t) JSON response. */
  function parseSingleResponse(data) {
    if (!Array.isArray(data)) throw new Error('Unexpected response');
    var text = '';
    if (Array.isArray(data[0])) {
      data[0].forEach(function (seg) {
        if (Array.isArray(seg) && typeof seg[0] === 'string') text += seg[0];
      });
    }
    var src = typeof data[2] === 'string' ? data[2] : '';
    return { text: text, src: src };
  }

  var api = {
    DEFAULT_MAX: DEFAULT_MAX,
    chunkText: chunkText,
    joinChunks: joinChunks,
    splitSentences: splitSentences,
    parseSingleResponse: parseSingleResponse
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TxChunker = api;
})(typeof self !== 'undefined' ? self : this);
