(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloDictionary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function key(surface, lang) {
    const value = String(surface || '');
    const language = lang === 'zh-Hant' ? 'zh' : (lang || 'und');
    return `${language}:${language === 'en' ? value.toLowerCase() : value}`;
  }

  function createDictionaryProvider(entries, meta) {
    const info = meta || {};
    const index = new Map();
    let maxZhLength = 0;
    for (const raw of entries || []) {
      const language = raw && (raw.lang || raw.language);
      if (!raw || !raw.surface || !language) continue;
      const normalized = Object.freeze({ ...raw, lang: language === 'zh-Hant' ? 'zh' : language });
      const entryKey = key(raw.surface, language);
      if (!index.has(entryKey)) index.set(entryKey, []);
      index.get(entryKey).push(normalized);
      if (language === 'zh' || language === 'zh-Hant') maxZhLength = Math.max(maxZhLength, raw.surface.length);
    }
    for (const [entryKey, values] of index) index.set(entryKey, Object.freeze(values));
    const empty = Object.freeze([]);
    return Object.freeze({
      id: info.id || 'dictionary-provider',
      version: info.version || '0.1.0',
      license: info.license || 'unspecified',
      size: index.size,
      status() {
        return Object.freeze({
          mode: info.mode === 'bootstrap' ? 'bootstrap' : 'ready',
          fallbackActivated: info.mode === 'bootstrap',
          failures: Object.freeze([])
        });
      },
      lookup(surface, lang) {
        const values = index.get(key(surface, lang));
        return values ? values[0] : null;
      },
      lookupAll(surface, lang) {
        return index.get(key(surface, lang)) || empty;
      },
      lookupMorphology() {
        return empty;
      },
      longestMatch(text, start, lang) {
        const language = lang === 'zh-Hant' ? 'zh' : lang;
        if (language !== 'zh' || typeof text !== 'string' || !Number.isInteger(start) || start < 0 || start >= text.length) {
          return null;
        }
        const upperBound = Math.min(maxZhLength, text.length - start);
        for (let length = upperBound; length > 0; length -= 1) {
          const surface = text.slice(start, start + length);
          const values = index.get(key(surface, language));
          if (values) return Object.freeze({ surface, start, end: start + length, entries: values });
        }
        return null;
      }
    });
  }

  const EN_BOOTSTRAP_GROUPS = Object.freeze({
    det: ['a', 'an', 'the', 'this', 'that', 'these', 'those', 'each', 'every', 'some', 'any', 'no'],
    pron: ['i', 'me', 'we', 'us', 'you', 'he', 'him', 'she', 'her', 'it', 'they', 'them', 'who', 'whom', 'which', 'what'],
    prep: ['in', 'on', 'at', 'to', 'from', 'for', 'with', 'without', 'by', 'of', 'about', 'under', 'over', 'between', 'through', 'during', 'before', 'after', 'into', 'onto', 'across'],
    conj: ['and', 'or', 'but', 'nor', 'yet', 'so', 'because', 'although', 'though', 'while', 'if', 'unless', 'when', 'where', 'whether'],
    aux: ['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did'],
    modal: ['can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would'],
    adj: ['quick', 'slow', 'happy', 'sad', 'good', 'bad', 'new', 'old', 'large', 'small', 'clear', 'important', 'basic', 'local', 'remote'],
    adv: ['very', 'quite', 'rather', 'also', 'already', 'still', 'now', 'then', 'here', 'there', 'often', 'always', 'never'],
    v: ['run', 'learn', 'study', 'read', 'write', 'make', 'use', 'show', 'mark', 'work', 'need'],
    n: ['language', 'word', 'sentence', 'system', 'learning', 'story', 'model', 'page', 'color', 'label', 'dictionary']
  });
  const ZH_BOOTSTRAP_GROUPS = Object.freeze({
    pron: ['我們', '你們', '他們', '她們', '它們', '我', '你', '他', '她', '它', '這', '那'],
    conj: ['因為', '所以', '如果', '但是', '而且', '或者', '和', '與', '或', '但'],
    adv: ['正在', '已經', '可能', '非常', '比較', '仍然'],
    modal: ['可以', '應該', '能夠', '將'],
    v: ['需要', '學習', '閱讀', '使用', '顯示', '標記', '理解', '生成', '完成', '有'],
    n: ['英文', '中文', '語言', '詞性', '句子', '故事', '系統', '模型', '資料', '顏色', '標籤', '頁面', '字典', '分詞', '新詞', '單字'],
    adj: ['重要', '基本', '快速', '簡單', '困難', '清楚', '本地'],
    det: ['的', '這個', '那個'],
    aux: ['了', '著', '過', '是'],
    prep: ['在', '從', '到', '對', '被', '把']
  });
  const EN_BOOTSTRAP_LEMMAS = Object.freeze({
    am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
    has: 'have', had: 'have', does: 'do', did: 'do'
  });

  function bootstrapEntries() {
    const entries = [];
    for (const [pos, surfaces] of Object.entries(EN_BOOTSTRAP_GROUPS)) {
      for (const surface of surfaces) entries.push({
        surface,
        lang: 'en',
        lemma: EN_BOOTSTRAP_LEMMAS[surface] || surface,
        pos,
        confidence: ['det', 'pron', 'prep', 'conj', 'aux', 'modal'].includes(pos) ? 0.99 : 0.92,
        source: 'bootstrap-lexicon'
      });
    }
    for (const [pos, surfaces] of Object.entries(ZH_BOOTSTRAP_GROUPS)) {
      for (const surface of surfaces) entries.push({
        surface,
        lang: 'zh',
        lemma: surface,
        pos,
        confidence: 0.94,
        source: 'bootstrap-lexicon'
      });
    }
    return Object.freeze(entries.map((entry) => Object.freeze(entry)));
  }

  const BOOTSTRAP_ENTRIES = bootstrapEntries();

  function createBootstrapDictionaryProvider() {
    return createDictionaryProvider(BOOTSTRAP_ENTRIES, {
      id: 'halo-bootstrap-dictionary',
      version: '0.3.0',
      license: 'Halo Learning authored bootstrap lexicon',
      mode: 'bootstrap'
    });
  }

  return Object.freeze({ BOOTSTRAP_ENTRIES, createDictionaryProvider, createBootstrapDictionaryProvider });
});
