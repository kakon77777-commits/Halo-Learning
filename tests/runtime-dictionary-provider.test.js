const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const Dictionary = require('../apps/extension/src/shared/dictionary-provider');
const BrowserIndex = require('../apps/extension/src/shared/runtime-index-browser');
const RuntimeDictionary = require('../apps/extension/src/shared/runtime-dictionary-provider');
const { importWordNetFiles } = require('../packages/lexical-data/en/wordnet-importer');
const { importCcCedict } = require('../packages/lexical-data/zh/cc-cedict-importer');
const {
  buildRuntimeLexicalIndex,
  loadRuntimeLexicalIndex,
  serializeRuntimeLexicalIndex
} = require('../packages/lexical-index/runtime-lexical-index');
const { canonicalJson, sha256Hex } = require('../packages/lexical-data/shared/build-utils');

const root = path.join(__dirname, '..');

function serializedFixture() {
  const enDir = path.join(root, 'fixtures/lexical/wordnet-3.0-synthetic');
  const zhDir = path.join(root, 'fixtures/lexical/cc-cedict-synthetic');
  const enManifest = JSON.parse(fs.readFileSync(path.join(enDir, 'dataset-manifest.json'), 'utf8'));
  const zhManifest = JSON.parse(fs.readFileSync(path.join(zhDir, 'dataset-manifest.json'), 'utf8'));
  const english = importWordNetFiles(enManifest.files.map((descriptor) => ({
    role: descriptor.role,
    path: descriptor.path,
    content: fs.readFileSync(path.join(enDir, descriptor.path))
  })), enManifest);
  const chinese = importCcCedict(
    fs.readFileSync(path.join(zhDir, zhManifest.files[0].path)),
    zhManifest
  );
  return serializeRuntimeLexicalIndex(buildRuntimeLexicalIndex(
    [...english.entries, ...chinese.entries],
    {
      indexId: 'runtime-provider-fixture',
      builtAt: '2026-08-25T00:00:00.000Z',
      datasetManifests: [enManifest, zhManifest],
      morphologyExceptions: []
    }
  ));
}

function bootstrapProvider() {
  return Dictionary.createDictionaryProvider([
    {
      surface: 'entity',
      lang: 'en',
      lemma: 'entity',
      pos: 'x',
      confidence: 0.2,
      source: 'bootstrap-fixture'
    },
    {
      surface: '學習',
      lang: 'zh',
      lemma: '學習',
      pos: 'v',
      confidence: 0.94,
      source: 'bootstrap-fixture'
    },
    {
      surface: '中文',
      lang: 'zh',
      lemma: '中文',
      pos: 'n',
      confidence: 0.94,
      source: 'bootstrap-fixture'
    }
  ], { id: 'bootstrap-fixture', version: '0.1.0', license: 'test-only' });
}

test('browser runtime loader verifies the same compact index and reconstructs neutral evidence', async () => {
  const index = await BrowserIndex.loadRuntimeLexicalIndex(serializedFixture(), {
    crypto: crypto.webcrypto
  });

  assert.equal(index.hash.value.length, 64);
  assert.equal(index.lookup('ENTITY', 'en')[0].simplifiedPos, 'n');
  assert.equal(index.longestMatch('正在學習', 2, 'zh-Hant').surface, '學習');
  assert.equal(Object.hasOwn(index.lookup('學習', 'zh-Hant')[0], 'recordData'), false);
});

test('browser runtime loader rejects a corrupt payload before exposing lookup', async () => {
  const document = JSON.parse(serializedFixture());
  document.chineseRows[0][1] = '偽造';

  await assert.rejects(
    BrowserIndex.loadRuntimeLexicalIndex(document, { crypto: crypto.webcrypto }),
    (error) => error instanceof BrowserIndex.RuntimeIndexBrowserError && error.code === 'HASH_MISMATCH'
  );
});

test('browser string loader validates canonical order without sorting the packaged row arrays', async () => {
  const serialized = serializedFixture();
  const originalSort = Array.prototype.sort;
  Array.prototype.sort = function prohibitedRuntimeSort() {
    throw new Error('runtime loader must not sort packaged arrays');
  };
  try {
    const index = await BrowserIndex.loadRuntimeLexicalIndex(serialized, { crypto: crypto.webcrypto });
    assert.equal(index.lookup('entity', 'en')[0].simplifiedPos, 'n');
    assert.equal(Object.isFrozen(index.datasets[0]), true);
  } finally {
    Array.prototype.sort = originalSort;
  }
});

test('browser runtime loader validates dataset locale and row POS after hash verification', async () => {
  function rehash(document) {
    const payload = { ...document };
    delete payload.hash;
    document.hash.value = sha256Hex(canonicalJson(payload));
    return document;
  }
  const badDataset = JSON.parse(serializedFixture());
  badDataset.datasets[0].locale = 'fr';
  await assert.rejects(
    BrowserIndex.loadRuntimeLexicalIndex(rehash(badDataset), { crypto: crypto.webcrypto }),
    (error) => error instanceof BrowserIndex.RuntimeIndexBrowserError && error.code === 'INVALID_DATASET'
  );

  const badRow = JSON.parse(serializedFixture());
  badRow.englishRows[0][2] = 'fabricated-pos';
  await assert.rejects(
    BrowserIndex.loadRuntimeLexicalIndex(rehash(badRow), { crypto: crypto.webcrypto }),
    (error) => error instanceof BrowserIndex.RuntimeIndexBrowserError && error.code === 'INVALID_ROW'
  );
});

test('browser and Node loaders reject the same incomplete manifest/license evidence after canonical rehash', async () => {
  const mutations = [
    ['invalid acquiredAt', (dataset) => { dataset.source.acquiredAt = 'not-a-timestamp'; }],
    ['invalid license enum', (dataset) => { dataset.license.commercialUse = 'maybe'; }],
    ['invalid bundled type', (dataset) => { dataset.bundled = 'true'; }],
    ['missing redistribution note', (dataset) => { dataset.redistributionNote = ''; }],
    ['incomplete verified release', (dataset) => { dataset.source.retrievalMode = 'verified-release'; }]
  ];

  for (const [name, mutate] of mutations) {
    const document = JSON.parse(serializedFixture());
    mutate(document.datasets[0]);
    const payload = { ...document };
    delete payload.hash;
    document.hash.value = sha256Hex(canonicalJson(payload));

    assert.throws(
      () => loadRuntimeLexicalIndex(document),
      (error) => error && error.code === 'INVALID_DATASET',
      `Node loader accepted ${name}`
    );
    await assert.rejects(
      BrowserIndex.loadRuntimeLexicalIndex(document, { crypto: crypto.webcrypto }),
      (error) => error instanceof BrowserIndex.RuntimeIndexBrowserError && error.code === 'INVALID_DATASET',
      `browser loader accepted ${name}`
    );
  }
});

test('packaged provider chain gives verified runtime evidence precedence over bootstrap', async () => {
  const requested = [];
  const provider = await RuntimeDictionary.loadPackagedDictionaryProvider({
    path: 'data/lexical-runtime-index.json',
    readText: async (resourcePath) => {
      requested.push(resourcePath);
      return serializedFixture();
    },
    loadIndex: async (serialized) => loadRuntimeLexicalIndex(serialized),
    bootstrapProvider: bootstrapProvider()
  });

  const entity = provider.lookup('ENTITY', 'en');
  assert.deepEqual(requested, ['data/lexical-runtime-index.json']);
  assert.equal(entity.simplifiedPos, 'n');
  assert.equal(entity.datasetRef.datasetId, 'princeton-wordnet-3.0-synthetic');
  assert.equal(provider.lookupAll('ENTITY', 'en').length, 2);
  assert.equal(provider.lookupAll('ENTITY', 'en')[1].source, 'bootstrap-fixture');
  const learning = provider.longestMatch('正在學習', 2, 'zh-Hant');
  assert.equal(learning.entries[0].datasetRef.datasetId, 'cc-cedict-synthetic');
  assert.equal(learning.entries[1].source, 'bootstrap-fixture');
  assert.equal(provider.status().mode, 'ready');
  assert.equal(provider.status().fallbackActivated, false);
  assert.deepEqual(provider.status().failures, []);
});

test('missing or corrupt packaged index fails soft to a sanitized bootstrap provider', async () => {
  const missing = await RuntimeDictionary.loadPackagedDictionaryProvider({
    readText: async () => { throw new Error('/secret/install/path/index.json not found'); },
    loadIndex: async (serialized) => loadRuntimeLexicalIndex(serialized),
    bootstrapProvider: bootstrapProvider()
  });
  const corrupt = await RuntimeDictionary.loadPackagedDictionaryProvider({
    readText: async () => '{"corrupt":true}',
    loadIndex: async (serialized) => loadRuntimeLexicalIndex(serialized),
    bootstrapProvider: bootstrapProvider()
  });

  assert.equal(missing.lookup('中文', 'zh-Hant').source, 'bootstrap-fixture');
  assert.equal(corrupt.lookup('entity', 'en').source, 'bootstrap-fixture');
  for (const provider of [missing, corrupt]) {
    const status = provider.status();
    assert.equal(status.mode, 'degraded');
    assert.equal(status.fallbackActivated, true);
    assert.equal(status.failures.length, 1);
    assert.equal(Object.hasOwn(status.failures[0], 'message'), false);
    assert.equal(Object.hasOwn(status.failures[0], 'path'), false);
    assert.doesNotMatch(JSON.stringify(status), /secret|install/i);
  }
});

test('provider chain retains deterministic Chinese bootstrap longest match when corpus is unavailable', async () => {
  const bootstrap = Dictionary.createDictionaryProvider([
    { surface: '學習', lang: 'zh', pos: 'v', confidence: 0.94, source: 'bootstrap' },
    { surface: '中文', lang: 'zh', pos: 'n', confidence: 0.94, source: 'bootstrap' }
  ], { id: 'bootstrap-longest', version: '0.1.0' });
  const provider = await RuntimeDictionary.loadPackagedDictionaryProvider({
    readText: async () => { throw new Error('missing'); },
    loadIndex: async (serialized) => loadRuntimeLexicalIndex(serialized),
    bootstrapProvider: bootstrap
  });
  const match = provider.longestMatch('正在學習中文', 2, 'zh-Hant');

  assert.equal(match.surface, '學習');
  assert.equal(match.start, 2);
  assert.equal(match.end, 4);
  assert.equal(match.entries[0].source, 'bootstrap');
});
