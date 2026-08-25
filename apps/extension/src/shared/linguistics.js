(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaloLinguistics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const POS = Object.freeze({
    N: 'n', V: 'v', ADJ: 'adj', ADV: 'adv', PREP: 'prep', CONJ: 'conj',
    DET: 'det', PRON: 'pron', AUX: 'aux', MODAL: 'modal', X: 'x'
  });

  const EN_CLOSED = Object.freeze({
    det: new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'each', 'every', 'some', 'any', 'no']),
    pron: new Set(['i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'theirs', 'who', 'whom', 'whose', 'which', 'what']),
    prep: new Set(['in', 'on', 'at', 'to', 'from', 'for', 'with', 'without', 'by', 'of', 'about', 'under', 'over', 'between', 'through', 'during', 'before', 'after', 'into', 'onto', 'across']),
    conj: new Set(['and', 'or', 'but', 'nor', 'yet', 'so', 'because', 'although', 'though', 'while', 'if', 'unless', 'when', 'where', 'whether']),
    aux: new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did']),
    modal: new Set(['can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would'])
  });

  const EN_COMMON = Object.freeze({
    adj: new Set(['quick', 'slow', 'happy', 'sad', 'good', 'bad', 'new', 'old', 'large', 'small', 'clear', 'important', 'basic', 'local', 'remote']),
    adv: new Set(['very', 'quite', 'rather', 'also', 'already', 'still', 'now', 'then', 'here', 'there', 'often', 'always', 'never']),
    v: new Set(['run', 'runs', 'learn', 'learns', 'study', 'studies', 'read', 'reads', 'write', 'writes', 'make', 'makes', 'use', 'uses', 'show', 'shows', 'mark', 'marks', 'work', 'works', 'need', 'needs']),
    n: new Set(['language', 'word', 'words', 'sentence', 'sentences', 'system', 'learning', 'story', 'stories', 'model', 'models', 'page', 'pages', 'color', 'colors', 'label', 'labels'])
  });

  const ZH_ENTRIES = [
    ['我們', 'pron'], ['你們', 'pron'], ['他們', 'pron'], ['她們', 'pron'], ['它們', 'pron'],
    ['因為', 'conj'], ['所以', 'conj'], ['如果', 'conj'], ['但是', 'conj'], ['而且', 'conj'], ['或者', 'conj'],
    ['正在', 'adv'], ['已經', 'adv'], ['可能', 'adv'], ['非常', 'adv'], ['比較', 'adv'], ['仍然', 'adv'],
    ['可以', 'modal'], ['應該', 'modal'], ['能夠', 'modal'], ['需要', 'v'], ['學習', 'v'], ['閱讀', 'v'], ['使用', 'v'], ['顯示', 'v'], ['標記', 'v'], ['理解', 'v'], ['生成', 'v'], ['完成', 'v'],
    ['英文', 'n'], ['中文', 'n'], ['語言', 'n'], ['詞性', 'n'], ['句子', 'n'], ['故事', 'n'], ['系統', 'n'], ['模型', 'n'], ['資料', 'n'], ['顏色', 'n'], ['標籤', 'n'], ['頁面', 'n'], ['字典', 'n'],
    ['重要', 'adj'], ['基本', 'adj'], ['快速', 'adj'], ['簡單', 'adj'], ['困難', 'adj'], ['清楚', 'adj'],
    ['我', 'pron'], ['你', 'pron'], ['他', 'pron'], ['她', 'pron'], ['它', 'pron'], ['這', 'pron'], ['那', 'pron'],
    ['的', 'det'], ['了', 'aux'], ['著', 'aux'], ['過', 'aux'], ['是', 'aux'], ['有', 'v'], ['在', 'prep'], ['從', 'prep'], ['到', 'prep'], ['對', 'prep'], ['和', 'conj'], ['與', 'conj'], ['或', 'conj'], ['但', 'conj'], ['被', 'prep'], ['把', 'prep'], ['將', 'modal']
  ];
  const ZH_LEXICON = new Map(ZH_ENTRIES);
  const ZH_MAX_LEN = Math.max(...ZH_ENTRIES.map(([surface]) => surface.length));

  function token(text, start, end, lang, pos, confidence, source) {
    return {
      text: text.slice(start, end), start, end, lang,
      pos: pos || POS.X,
      confidence,
      source,
      priority: pos && pos !== POS.X ? (['n', 'v', 'adj', 'adv'].includes(pos) ? 0.85 : 0.65) : 0.2
    };
  }

  function classifyEnglish(surface) {
    const lower = surface.toLowerCase();
    for (const pos of ['det', 'pron', 'prep', 'conj', 'aux', 'modal']) {
      if (EN_CLOSED[pos].has(lower)) return { pos, confidence: 0.99, source: 'closed-class' };
    }
    for (const pos of ['adj', 'adv', 'v', 'n']) {
      if (EN_COMMON[pos].has(lower)) return { pos, confidence: 0.92, source: 'bootstrap-lexicon' };
    }
    if (/ly$/i.test(surface) && surface.length > 3) return { pos: POS.ADV, confidence: 0.82, source: 'suffix-heuristic' };
    if (/(ing|ed|en|ify|ise|ize)$/i.test(surface) && surface.length > 4) return { pos: POS.V, confidence: 0.76, source: 'suffix-heuristic' };
    if (/(ous|ful|able|ible|al|ive|ic|less|ary|ent|ant)$/i.test(surface) && surface.length > 4) return { pos: POS.ADJ, confidence: 0.72, source: 'suffix-heuristic' };
    if (/(tion|sion|ment|ness|ity|ism|ist)$/i.test(surface) && surface.length > 4) return { pos: POS.N, confidence: 0.72, source: 'suffix-heuristic' };
    return { pos: POS.X, confidence: 0.25, source: 'unknown' };
  }

  function analyzeEnglish(text, offsetBase) {
    const base = Number.isInteger(offsetBase) ? offsetBase : 0;
    const out = [];
    const re = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
    let match;
    while ((match = re.exec(text))) {
      const start = base + match.index;
      const end = start + match[0].length;
      const cls = classifyEnglish(match[0]);
      out.push({
        text: match[0], start, end, lang: 'en', pos: cls.pos,
        confidence: cls.confidence, source: cls.source,
        priority: cls.pos !== POS.X ? (['n', 'v', 'adj', 'adv'].includes(cls.pos) ? 0.85 : 0.65) : 0.2
      });
    }
    return out;
  }

  function analyzeChinese(text, offsetBase) {
    const base = Number.isInteger(offsetBase) ? offsetBase : 0;
    const out = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (!/\p{Script=Han}/u.test(ch)) { i += 1; continue; }
      let matched = null;
      const max = Math.min(ZH_MAX_LEN, text.length - i);
      for (let len = max; len >= 1; len -= 1) {
        const candidate = text.slice(i, i + len);
        const pos = ZH_LEXICON.get(candidate);
        if (pos) { matched = { surface: candidate, pos }; break; }
      }
      if (matched) {
        const start = base + i;
        const end = start + matched.surface.length;
        out.push({
          text: matched.surface, start, end, lang: 'zh', pos: matched.pos,
          confidence: 0.94, source: 'bootstrap-lexicon',
          priority: ['n', 'v', 'adj', 'adv'].includes(matched.pos) ? 0.85 : 0.65
        });
        i += matched.surface.length;
      } else {
        const start = base + i;
        out.push(token(text, i, i + 1, 'zh', POS.X, 0.2, 'unknown'));
        out[out.length - 1].start = start;
        out[out.length - 1].end = start + 1;
        i += 1;
      }
    }
    return out;
  }

  function detectLanguage(text) {
    const en = (text.match(/[A-Za-z]/g) || []).length;
    const zh = (text.match(/\p{Script=Han}/gu) || []).length;
    if (en && zh) return 'both';
    if (zh) return 'zh';
    if (en) return 'en';
    return 'unknown';
  }

  function tokenize(text, languageMode) {
    const mode = languageMode || 'auto';
    const effective = mode === 'auto' ? detectLanguage(text) : mode;
    let tokens = [];
    if (effective === 'en' || effective === 'both') tokens = tokens.concat(analyzeEnglish(text));
    if (effective === 'zh' || effective === 'both') tokens = tokens.concat(analyzeChinese(text));
    return tokens.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  return Object.freeze({ POS, analyzeEnglish, analyzeChinese, detectLanguage, tokenize, classifyEnglish });
});
