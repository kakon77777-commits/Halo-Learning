const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const linguisticsPath = path.join(__dirname, '..', 'apps', 'extension', 'src', 'shared', 'linguistics.js');
const dictionaryPath = path.join(__dirname, '..', 'apps', 'extension', 'src', 'shared', 'dictionary-provider.js');

function loadModules() {
  const Linguistics = require(linguisticsPath);
  const Dictionary = require(dictionaryPath);
  return { Linguistics, Dictionary };
}

test('English closed-class and suffix POS are recognized conservatively', () => {
  const { Linguistics } = loadModules();
  const tokens = Linguistics.analyzeEnglish('The quick fox is running quickly.');
  const byText = Object.fromEntries(tokens.map((t) => [t.text.toLowerCase(), t]));
  assert.equal(byText.the.pos, 'det');
  assert.equal(byText.quick.pos, 'adj');
  assert.equal(byText.is.pos, 'aux');
  assert.equal(byText.running.pos, 'v');
  assert.equal(byText.quickly.pos, 'adv');
  assert.ok(byText.running.confidence >= 0.7);
});

test('Chinese tokenizer uses longest known lexical match', () => {
  const { Linguistics } = loadModules();
  const tokens = Linguistics.analyzeChinese('我正在學習英文。');
  assert.deepEqual(tokens.map((t) => t.text), ['我', '正在', '學習', '英文']);
  assert.deepEqual(tokens.map((t) => t.pos), ['pron', 'adv', 'v', 'n']);
});

test('token offsets map exactly back to the original string', () => {
  const { Linguistics } = loadModules();
  const text = 'Hello 世界，I am learning 中文。';
  const tokens = Linguistics.tokenize(text, 'both');
  assert.ok(tokens.length >= 6);
  for (const token of tokens) {
    assert.equal(text.slice(token.start, token.end), token.text);
  }
});

test('unknown words remain low-confidence instead of being promoted to known POS', () => {
  const { Linguistics } = loadModules();
  const en = Linguistics.analyzeEnglish('xqzvoria')[0];
  const zh = Linguistics.analyzeChinese('星艦');
  assert.ok(en.confidence < 0.5);
  assert.ok(!en.pos || en.pos === 'x');
  assert.ok(zh.every((t) => t.confidence < 0.5));
});

test('dictionary provider can supply future imported bilingual entries without changing the core API', () => {
  const { Dictionary } = loadModules();
  const provider = Dictionary.createDictionaryProvider([
    { surface: 'orbit', lang: 'en', pos: 'n', gloss: '軌道' },
    { surface: '量子', lang: 'zh', pos: 'n', gloss: 'quantum' }
  ], { id: 'fixture-dict', license: 'test-only' });
  assert.equal(provider.id, 'fixture-dict');
  assert.equal(provider.lookup('ORBIT', 'en').pos, 'n');
  assert.equal(provider.lookup('量子', 'zh').gloss, 'quantum');
  assert.equal(provider.lookup('missing', 'en'), null);
});
