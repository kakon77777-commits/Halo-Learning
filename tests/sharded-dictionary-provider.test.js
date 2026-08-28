'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Shards = require('../packages/lexical-index/browser-lexical-shards');
const BrowserLoader = require('../apps/extension/src/shared/runtime-shard-browser');
const { createShardedDictionaryProvider } = require('../apps/extension/src/shared/sharded-dictionary-provider');

const bootstrapProvider = Object.freeze({
  lookup(surface, language) {
    if (surface.toLocaleLowerCase('en-US') === 'model' && language === 'en') {
      return Object.freeze({ surface: 'model', source: 'bootstrap' });
    }
    return null;
  },
  lookupAll(surface, language) {
    const value = this.lookup(surface, language);
    return value ? Object.freeze([value]) : Object.freeze([]);
  },
  lookupMorphology() {
    return Object.freeze([]);
  },
  longestMatch() {
    return null;
  }
});

function artifacts() {
  return Shards.buildBrowserLexicalArtifacts([
    {
      locale: 'en',
      row: ['model', 'model', 'n', 1, 'en:model', 'gloss:model', 0, 0],
      gloss: 'a representation'
    },
    {
      locale: 'zh-Hant',
      row: ['學習', '学习', 'v', 0.8, 'zh:學習', 'gloss:學習', 0, 1, 'xue2 xi2'],
      gloss: 'to learn'
    }
  ], {
    bucketCount: 64,
    builtAt: '2026-08-25T00:00:00.000Z',
    sourceIndex: {
      format: 'halo-runtime-lexical-index-v1',
      hash: { algorithm: 'sha256', value: 'c'.repeat(64) }
    },
    datasets: [
      { datasetId: 'fixture-en', version: '1', locale: 'en' },
      { datasetId: 'fixture-zh', version: '1', locale: 'zh-Hant' }
    ],
    morphologyRows: [['models', 'model', 'n', 0, 'noun.exc:models']]
  });
}

async function createFixtureProvider(options) {
  const settings = options || {};
  const built = artifacts();
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const runtime = BrowserLoader.createBrowserLexicalRuntime({
    manifest,
    readText: async (resourcePath) => settings.corruptShard
      ? built.serializedShards[resourcePath].replace('"schemaVersion":1', '"schemaVersion":2')
      : built.serializedShards[resourcePath]
  });
  const ids = runtime.requiredShardIds(['model models 學習'], 'both');
  try {
    await runtime.ensureShards(ids);
  } catch (_error) {
    return createShardedDictionaryProvider({ runtime, pinnedShards: [], bootstrapProvider });
  }
  return runtime.withPinnedShards(ids, (pinnedShards) =>
    createShardedDictionaryProvider({ runtime, pinnedShards, bootstrapProvider }));
}

test('verified pinned shards take precedence and preserve provider-neutral lexical evidence', async () => {
  const provider = await createFixtureProvider();
  const entry = provider.lookup('Model', 'en');

  assert.equal(provider.id, 'halo-sharded-dictionary-chain');
  assert.equal(provider.version, '0.4.0');
  assert.equal(entry.gloss, 'a representation');
  assert.equal(entry.datasetRef.datasetId, 'fixture-en');
  assert.equal(provider.lookupMorphology('models', 'en')[0].lemma, 'model');
  assert.equal(provider.longestMatch('他在學習', 2, 'zh-Hant').surface, '學習');
});

test('a corrupt required shard falls back without exposing its bytes', async () => {
  const provider = await createFixtureProvider({ corruptShard: true });
  assert.equal(provider.lookup('model', 'en').source, 'bootstrap');
  assert.deepEqual(provider.status().failures, [{ code: 'SHARD_HASH_MISMATCH' }]);
  assert.equal(JSON.stringify(provider.status()).includes('schemaVersion'), false);
});

test('unsupported languages never consult shard or bootstrap evidence', async () => {
  const provider = await createFixtureProvider();
  assert.equal(provider.lookup('model', 'fr'), null);
  assert.deepEqual(provider.lookupAll('model', 'fr'), []);
  assert.deepEqual(provider.lookupMorphology('models', 'zh-Hant'), []);
});
