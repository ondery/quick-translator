/*
 * languages.js - target languages supported by the Google Translate web
 * endpoint, with English and Turkish display names.
 * Exposes self.TxLanguages (classic script / importScripts / Node).
 */
(function (root) {
  'use strict';
  // [code, English name, Turkish name]
  var LIST = [
    ["af", "Afrikaans", "Afrikaanca"],
    ["sq", "Albanian", "Arnavutça"],
    ["am", "Amharic", "Amharca"],
    ["ar", "Arabic", "Arapça"],
    ["hy", "Armenian", "Ermenice"],
    ["as", "Assamese", "Assamca"],
    ["ay", "Aymara", "Aymara"],
    ["az", "Azerbaijani", "Azerbaycan dili"],
    ["bm", "Bambara", "Bambara"],
    ["eu", "Basque", "Baskça"],
    ["be", "Belarusian", "Belarusça"],
    ["bn", "Bengali", "Bengalce"],
    ["bho", "Bhojpuri", "Bhojpuri"],
    ["bs", "Bosnian", "Boşnakça"],
    ["bg", "Bulgarian", "Bulgarca"],
    ["ca", "Catalan", "Katalanca"],
    ["ceb", "Cebuano", "Sebuano"],
    ["ny", "Chichewa", "Çiçeva"],
    ["zh-CN", "Chinese (Simplified)", "Çince (Basitleştirilmiş)"],
    ["zh-TW", "Chinese (Traditional)", "Çince (Geleneksel)"],
    ["co", "Corsican", "Korsikaca"],
    ["hr", "Croatian", "Hırvatça"],
    ["cs", "Czech", "Çekçe"],
    ["da", "Danish", "Danca"],
    ["dv", "Dhivehi", "Divehi dili"],
    ["doi", "Dogri", "Dogri"],
    ["nl", "Dutch", "Felemenkçe"],
    ["en", "English", "İngilizce"],
    ["eo", "Esperanto", "Esperanto"],
    ["et", "Estonian", "Estonca"],
    ["ee", "Ewe", "Ewe"],
    ["tl", "Filipino", "Filipince"],
    ["fi", "Finnish", "Fince"],
    ["fr", "French", "Fransızca"],
    ["fy", "Frisian", "Frizce"],
    ["gl", "Galician", "Galiçyaca"],
    ["ka", "Georgian", "Gürcüce"],
    ["de", "German", "Almanca"],
    ["el", "Greek", "Yunanca"],
    ["gn", "Guarani", "Guarani dili"],
    ["gu", "Gujarati", "Güceratça"],
    ["ht", "Haitian Creole", "Haiti Kreolü"],
    ["ha", "Hausa", "Hausa dili"],
    ["haw", "Hawaiian", "Hawaii dili"],
    ["iw", "Hebrew", "İbranice"],
    ["hi", "Hindi", "Hintçe"],
    ["hmn", "Hmong", "Hmong"],
    ["hu", "Hungarian", "Macarca"],
    ["is", "Icelandic", "İzlandaca"],
    ["ig", "Igbo", "İbo dili"],
    ["ilo", "Ilocano", "İlokano"],
    ["id", "Indonesian", "Endonezce"],
    ["ga", "Irish", "İrlandaca"],
    ["it", "Italian", "İtalyanca"],
    ["ja", "Japanese", "Japonca"],
    ["jw", "Javanese", "Cava dili"],
    ["kn", "Kannada", "Kannada dili"],
    ["kk", "Kazakh", "Kazakça"],
    ["km", "Khmer", "Khmer dili"],
    ["rw", "Kinyarwanda", "Kinyarwanda"],
    ["gom", "Konkani", "Konkani dili"],
    ["ko", "Korean", "Korece"],
    ["kri", "Krio", "Krio"],
    ["ku", "Kurdish (Kurmanji)", "Kürtçe (Kurmanci)"],
    ["ckb", "Kurdish (Sorani)", "Kürtçe (Sorani)"],
    ["ky", "Kyrgyz", "Kırgızca"],
    ["lo", "Lao", "Lao dili"],
    ["la", "Latin", "Latince"],
    ["lv", "Latvian", "Letonca"],
    ["ln", "Lingala", "Lingala"],
    ["lt", "Lithuanian", "Litvanca"],
    ["lg", "Luganda", "Luganda"],
    ["lb", "Luxembourgish", "Lüksemburgca"],
    ["mk", "Macedonian", "Makedonca"],
    ["mai", "Maithili", "Maithili"],
    ["mg", "Malagasy", "Malgaşça"],
    ["ms", "Malay", "Malayca"],
    ["ml", "Malayalam", "Malayalam dili"],
    ["mt", "Maltese", "Maltaca"],
    ["mi", "Maori", "Maori dili"],
    ["mr", "Marathi", "Marathi dili"],
    ["mni-Mtei", "Meiteilon (Manipuri)", "Meitei (Manipuri)"],
    ["lus", "Mizo", "Mizo"],
    ["mn", "Mongolian", "Moğolca"],
    ["my", "Myanmar (Burmese)", "Birmanca"],
    ["ne", "Nepali", "Nepalce"],
    ["no", "Norwegian", "Norveççe"],
    ["or", "Odia (Oriya)", "Oriya dili"],
    ["om", "Oromo", "Oromo dili"],
    ["ps", "Pashto", "Peştuca"],
    ["fa", "Persian", "Farsça"],
    ["pl", "Polish", "Lehçe"],
    ["pt", "Portuguese", "Portekizce"],
    ["pa", "Punjabi", "Pencapça"],
    ["qu", "Quechua", "Keçuva dili"],
    ["ro", "Romanian", "Rumence"],
    ["ru", "Russian", "Rusça"],
    ["sm", "Samoan", "Samoa dili"],
    ["sa", "Sanskrit", "Sanskritçe"],
    ["gd", "Scots Gaelic", "İskoç Galcesi"],
    ["nso", "Sepedi", "Sepedi"],
    ["sr", "Serbian", "Sırpça"],
    ["st", "Sesotho", "Güney Sotho dili"],
    ["sn", "Shona", "Şona dili"],
    ["sd", "Sindhi", "Sindhi dili"],
    ["si", "Sinhala", "Sinhali dili"],
    ["sk", "Slovak", "Slovakça"],
    ["sl", "Slovenian", "Slovence"],
    ["so", "Somali", "Somalice"],
    ["es", "Spanish", "İspanyolca"],
    ["su", "Sundanese", "Sunda dili"],
    ["sw", "Swahili", "Svahili dili"],
    ["sv", "Swedish", "İsveççe"],
    ["tg", "Tajik", "Tacikçe"],
    ["ta", "Tamil", "Tamilce"],
    ["tt", "Tatar", "Tatarca"],
    ["te", "Telugu", "Telugu dili"],
    ["th", "Thai", "Tayca"],
    ["ti", "Tigrinya", "Tigrinya dili"],
    ["ts", "Tsonga", "Tsonga"],
    ["tr", "Turkish", "Türkçe"],
    ["tk", "Turkmen", "Türkmence"],
    ["ak", "Twi", "Tvi"],
    ["uk", "Ukrainian", "Ukraynaca"],
    ["ur", "Urdu", "Urduca"],
    ["ug", "Uyghur", "Uygurca"],
    ["uz", "Uzbek", "Özbekçe"],
    ["vi", "Vietnamese", "Vietnamca"],
    ["cy", "Welsh", "Galce"],
    ["xh", "Xhosa", "Zosa dili"],
    ["yi", "Yiddish", "Yidiş"],
    ["yo", "Yoruba", "Yorubaca"],
    ["zu", "Zulu", "Zuluca"]
  ];

  var ALIASES = { he: 'iw', jv: 'jw', fil: 'tl', nb: 'no', zh: 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', mni: 'mni-Mtei' };
  var RTL = ['ar', 'iw', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb'];

  function find(code) {
    if (!code) return null;
    var c = ALIASES[code] || code;
    for (var i = 0; i < LIST.length; i++) if (LIST[i][0].toLowerCase() === c.toLowerCase()) return LIST[i];
    return null;
  }

  // Google code -> BCP 47 code understood by Intl.DisplayNames
  var INTL_CODE = { iw: 'he', jw: 'jv', 'mni-Mtei': 'mni', 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', tl: 'fil' };
  var dnCache = {};

  /** 'pt_BR' -> 'pt-BR' */
  function bcp47(ui) { return String(ui || 'en').replace('_', '-'); }

  function intlName(code, ui) {
    try {
      var key = bcp47(ui);
      if (!dnCache[key]) dnCache[key] = new Intl.DisplayNames([key], { type: 'language', fallback: 'none' });
      var n = dnCache[key].of(INTL_CODE[code] || code);
      if (n) return n.charAt(0).toLocaleUpperCase(key) + n.slice(1);
    } catch (e) { /* ignore */ }
    return '';
  }

  /**
   * Display name of a language code in the given UI language
   * ('en', 'tr', 'de', 'fr', 'es', 'it', 'pt_BR', 'ru', 'ar', 'ja', ...).
   * English and Turkish use the curated list; other UI languages use the
   * browser's built-in CLDR data (Intl.DisplayNames), falling back to English.
   */
  function name(code, ui) {
    var row = find(code);
    ui = ui || 'en';
    if (row) {
      if (ui === 'en') return row[1];
      if (ui === 'tr') return row[2];
      return intlName(row[0], ui) || row[1];
    }
    return intlName(code, ui) || code || '';
  }

  /** List sorted alphabetically by the UI-language name. */
  function sorted(ui) {
    var collator;
    try { collator = new Intl.Collator(bcp47(ui)); } catch (e) { collator = new Intl.Collator('en'); }
    return LIST.map(function (r) { return { code: r[0], name: name(r[0], ui) }; })
      .sort(function (a, b) { return collator.compare(a.name, b.name); });
  }

  function isRtl(code) { return RTL.indexOf(code) !== -1; }

  var api = { LIST: LIST, find: find, name: name, sorted: sorted, isRtl: isRtl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TxLanguages = api;
})(typeof self !== 'undefined' ? self : this);
