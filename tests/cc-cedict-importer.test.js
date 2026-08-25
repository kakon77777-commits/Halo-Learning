const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  deriveCcCedictPos,
  importCcCedict
} = require('../packages/lexical-data/zh/cc-cedict-importer');

const fixtureText = [
  '# Synthetic CC-CEDICT-format fixture; not upstream corpus data.',
  '學習 学习 [xue2 xi2] /to learn/to study/',
  '銀行 银行 [yin2 hang2] /bank/financial institution/',
  '行 行 [xing2] /to walk/a row/',
  '魔法手 魔法手 [mo2 fa3 shou3] /Magic Hand/',
  '學習 学习 [xue2 xi2] /to learn/to study/',
  'malformed record',
  ''
].join('\n');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function manifestFor(text) {
  const descriptor = {
    role: 'dictionary',
    path: 'cedict_ts.u8',
    bytes: Buffer.byteLength(text),
    sha256: sha256(text)
  };
  return {
    schemaVersion: 1,
    datasetId: 'cc-cedict-synthetic',
    name: 'Synthetic CC-CEDICT format fixture',
    locale: 'zh-Hant',
    version: 'synthetic.1',
    source: {
      publisher: 'Halo Learning test fixtures',
      canonicalUrl: 'https://cc-cedict.org/wiki/syntax',
      acquiredAt: '2026-08-25T00:00:00.000Z',
      retrievalMode: 'synthetic-fixture'
    },
    license: {
      schemaVersion: 1,
      licenseId: 'LicenseRef-Halo-Synthetic-Fixture',
      name: 'Halo Learning synthetic test fixture',
      url: 'https://halo-learning.local/licenses/synthetic-fixture',
      commercialUse: 'allowed',
      redistribution: 'allowed',
      attributionRequired: false,
      shareAlike: false,
      redistributionNote: 'Synthetic records only; contains no CC-CEDICT corpus data.',
      verifiedAt: '2026-08-25',
      verificationUrl: 'https://cc-cedict.org/wiki/syntax'
    },
    hash: { algorithm: 'sha256', value: sha256(canonical([descriptor])) },
    files: [descriptor],
    bundled: true,
    redistributionNote: 'Only synthetic format fixtures are bundled.'
  };
}

test('CC-CEDICT importer preserves Traditional surface and source-only Simplified/pinyin evidence', () => {
  const result = importCcCedict(fixtureText, manifestFor(fixtureText));

  assert.equal(result.entries.length, 4);
  assert.equal(result.maxSurfaceLength, 3);
  const learning = result.entries.find((entry) => entry.surface === '學習');
  assert.equal(learning.normalizedSurface, '學習');
  assert.deepEqual(learning.aliases, []);
  assert.deepEqual(learning.source.recordData, {
    traditional: '學習',
    simplified: '学习',
    pinyin: 'xue2 xi2'
  });
  assert.equal(learning.provenance.fieldOrigins.pinyin, 'source:cedict_ts.u8:2:pinyin');
  assert.deepEqual(learning.glosses, [
    { text: 'to learn', locale: 'en', ref: 'cedict_ts.u8:2#gloss[0]' },
    { text: 'to study', locale: 'en', ref: 'cedict_ts.u8:2#gloss[1]' }
  ]);
  assert.equal(learning.pos, 'v');
  assert.equal(learning.posConfidence, 0.55);
  assert.ok(Object.isFrozen(learning.source.recordData));
});

test('CC-CEDICT POS derivation stays conservative for ambiguous or uncued glosses', () => {
  assert.deepEqual(deriveCcCedictPos(['to learn', 'to study']), {
    pos: 'v',
    confidence: 0.55,
    derivationId: 'derived:cc-cedict-gloss-cues-v1'
  });
  assert.deepEqual(deriveCcCedictPos(['to walk', 'a row']), {
    pos: 'x',
    confidence: 0,
    derivationId: 'derived:cc-cedict-gloss-cues-v1'
  });
  assert.deepEqual(deriveCcCedictPos(['bank']), {
    pos: 'x',
    confidence: 0,
    derivationId: 'derived:cc-cedict-gloss-cues-v1'
  });
});

test('CC-CEDICT duplicate and malformed records are visible and deterministic', () => {
  const first = importCcCedict(fixtureText, manifestFor(fixtureText));
  const second = importCcCedict(fixtureText, manifestFor(fixtureText));

  assert.deepEqual(second, first);
  assert.deepEqual(first.rejected, [
    {
      path: 'cedict_ts.u8',
      lineNumber: 6,
      code: 'DUPLICATE_RECORD',
      recordRef: 'cedict_ts.u8:6'
    },
    {
      path: 'cedict_ts.u8',
      lineNumber: 7,
      code: 'MALFORMED_RECORD',
      recordRef: 'cedict_ts.u8:7'
    }
  ]);
});

test('CC-CEDICT importer never indexes Simplified-only spellings as zh-Hant entries', () => {
  const result = importCcCedict(fixtureText, manifestFor(fixtureText));

  assert.equal(result.entries.some((entry) => entry.surface === '学习'), false);
  assert.equal(result.entries.some((entry) => entry.aliases.includes('学习')), false);
});

test('CC-CEDICT importer fails closed on a mismatched byte hash', () => {
  const manifest = manifestFor(fixtureText);
  manifest.hash.value = 'f'.repeat(64);

  assert.throws(() => importCcCedict(fixtureText, manifest), /sha256/i);
});

test('bundled synthetic CC-CEDICT fixture matches its byte-level manifest', () => {
  const fixtureDir = path.join(__dirname, '..', 'fixtures', 'lexical', 'cc-cedict-synthetic');
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'dataset-manifest.json'), 'utf8'));
  const text = fs.readFileSync(path.join(fixtureDir, manifest.files[0].path));
  const result = importCcCedict(text, manifest);

  assert.equal(result.entries.length, 4);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.receiptDraft.inputHash.value, manifest.hash.value);
});
