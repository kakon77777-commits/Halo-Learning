const test = require('node:test');
const assert = require('node:assert/strict');

const Contracts = require('../packages/contracts/semantic-contracts');
const Semantic = require('../apps/extension/src/shared/semantic-annotations');

const GENERATED_AT = '2026-08-25T09:30:00.000Z';

function cedictEntry(traditional, simplified, options) {
  const settings = options || {};
  const recordRef = settings.recordRef || `cedict:${traditional}`;
  return Object.freeze({
    surface: traditional,
    normalizedSurface: traditional,
    language: 'zh-Hant',
    lemma: traditional,
    traditional,
    simplified,
    simplifiedPos: settings.pos || 'x',
    posConfidence: settings.posConfidence === undefined ? 0 : settings.posConfidence,
    lexicalRef: recordRef,
    glossRef: `${recordRef}#gloss`,
    gloss: settings.gloss || `${traditional} fixture gloss`,
    pinyin: settings.pinyin || null,
    datasetRef: {
      datasetId: 'cc-cedict-v1-fixture',
      datasetVersion: '2026-08-24T05:05:01Z-fixture',
      recordRef
    },
    provenance: ['dataset:cc-cedict-v1-fixture@2026-08-24T05:05:01Z-fixture']
  });
}

function bootstrapEntry(surface, pos, confidence) {
  return Object.freeze({ surface, lang: 'zh', lemma: surface, pos, confidence, source: 'bootstrap-lexicon' });
}

function fixtureProvider() {
  const values = [
    bootstrapEntry('我', 'pron', 0.99),
    bootstrapEntry('正在', 'adv', 0.94),
    cedictEntry('學習', '学习', { pos: 'v', posConfidence: 0.55, gloss: 'to learn', pinyin: 'xue2 xi2' }),
    cedictEntry('中文', '中文', { gloss: 'Chinese language', pinyin: 'Zhong1 wen2' }),
    cedictEntry('銀行', '银行', { gloss: 'bank', pinyin: 'yin2 hang2' }),
    bootstrapEntry('銀行', 'n', 0.94),
    cedictEntry('魔法', '魔法', { gloss: 'magic' }),
    cedictEntry('魔法手', '魔法手', { gloss: 'Magic Hand' }),
    cedictEntry('卡拉OK', '卡拉OK', { gloss: 'karaoke' })
  ];
  const bySurface = new Map();
  for (const value of values) {
    if (!bySurface.has(value.surface)) bySurface.set(value.surface, []);
    bySurface.get(value.surface).push(value);
  }
  const maxLength = Math.max(...values.map((value) => value.surface.length));
  return Object.freeze({
    id: 'halo-zh-fixture-provider',
    version: '0.3.0-test',
    lookup(surface, language) {
      const entries = this.lookupAll(surface, language);
      return entries[0] || null;
    },
    lookupAll(surface, language) {
      if (language !== 'zh-Hant' && language !== 'zh') return Object.freeze([]);
      return Object.freeze(bySurface.get(surface) || []);
    },
    longestMatch(text, start, language) {
      if (language !== 'zh-Hant') return null;
      for (let length = Math.min(maxLength, text.length - start); length > 0; length -= 1) {
        const surface = text.slice(start, start + length);
        const entries = bySurface.get(surface);
        if (entries) return Object.freeze({ surface, start, end: start + length, entries: Object.freeze(entries) });
      }
      return null;
    },
    status() {
      return Object.freeze({ mode: 'ready', fallbackActivated: false, failures: [] });
    }
  });
}

function annotate(text) {
  return Semantic.createSemanticEngine({ provider: fixtureProvider() }).annotateText(text, {
    languageMode: 'zh-Hant',
    generatedAt: GENERATED_AT
  });
}

test('Traditional-Chinese layer emits deterministic longest-match segmentation and exact offsets', () => {
  const text = '我正在學習中文。';
  const set = annotate(text);

  assert.doesNotThrow(() => Contracts.normalizeAnnotationSet(set));
  assert.deepEqual(set.tokens.map((token) => token.surface), ['我', '正在', '學習', '中文']);
  assert.deepEqual(set.tokens.map(({ start, end }) => [start, end]), [[0, 1], [1, 3], [3, 5], [5, 7]]);
  assert.deepEqual(set.tokens.map((token) => token.simplifiedPos), ['pron', 'adv', 'v', 'x']);
  for (const token of set.tokens) assert.equal(text.slice(token.start, token.end), token.surface);

  const learning = set.tokens[2];
  assert.equal(learning.lemma, '學習');
  assert.deepEqual(learning.lexicalRefs, ['cedict:學習']);
  assert.deepEqual(learning.glossRefs, ['cedict:學習#gloss']);
  assert.equal(learning.annotations.find((annotation) => annotation.type === 'traditional-form').value, '學習');
  assert.equal(learning.annotations.find((annotation) => annotation.type === 'simplified-form').value, '学习');
  assert.equal(learning.annotations.find((annotation) => annotation.type === 'pinyin').value, 'xue2 xi2');
  assert.equal(learning.annotations.find((annotation) => annotation.type === 'gloss').value, 'to learn');
  assert.equal(learning.annotations.find((annotation) => annotation.type === 'simplified-pos').confidence, 0.55);
});

test('curated POS supplementation preserves CC-CEDICT lexical truth and its uncertain POS candidate', () => {
  const bank = annotate('銀行').tokens[0];

  assert.equal(bank.lemma, '銀行');
  assert.equal(bank.simplifiedPos, 'n');
  assert.equal(bank.confidence, 0.98);
  assert.equal(bank.annotations.find((annotation) => annotation.type === 'simplified-pos').confidence, 0.94);
  assert.equal(bank.annotations.find((annotation) => annotation.type === 'simplified-pos').source, 'bootstrap-lexicon');
  assert.equal(bank.annotations.find((annotation) => annotation.type === 'lexical-pos-candidate').value, 'x');
  assert.equal(bank.annotations.find((annotation) => annotation.type === 'lexical-pos-candidate').confidence, 0);
  assert.equal(bank.annotations.find((annotation) => annotation.type === 'simplified-form').value, '银行');
  assert.deepEqual(bank.lexicalRefs, ['cedict:銀行']);
});

test('unknown Han text falls back one code point at a time with no invented lexical evidence', () => {
  const tokens = annotate('星艦').tokens;

  assert.deepEqual(tokens.map((token) => token.surface), ['星', '艦']);
  assert.ok(tokens.every((token) => token.simplifiedPos === 'x'));
  assert.ok(tokens.every((token) => !Object.hasOwn(token, 'lemma')));
  assert.ok(tokens.every((token) => token.lexicalRefs.length === 0 && token.glossRefs.length === 0));
  assert.ok(tokens.every((token) => token.confidence < 0.5));
});

test('Chinese segmentation always chooses the longest verified surface', () => {
  const tokens = annotate('魔法手').tokens;
  assert.deepEqual(tokens.map((token) => token.surface), ['魔法手']);
  assert.equal(tokens[0].lexicalRefs[0], 'cedict:魔法手');
});

test('Traditional-Chinese annotation is deterministic for fixed provider and timestamp', () => {
  const first = annotate('我正在學習中文。');
  for (let iteration = 0; iteration < 20; iteration += 1) {
    assert.deepEqual(annotate('我正在學習中文。'), first);
  }
});

test('both-language mode assigns mixed-script CC-CEDICT spans once without overlapping English tokens', () => {
  const set = Semantic.createSemanticEngine({ provider: fixtureProvider() }).annotateText('卡拉OK works', {
    languageMode: 'both',
    generatedAt: GENERATED_AT
  });

  assert.doesNotThrow(() => Contracts.normalizeAnnotationSet(set));
  assert.deepEqual(set.tokens.map((token) => [token.surface, token.language, token.start, token.end]), [
    ['卡拉OK', 'zh-Hant', 0, 4],
    ['works', 'en', 5, 10]
  ]);
});
