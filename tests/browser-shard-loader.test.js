'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Shards = require('../packages/lexical-index/browser-lexical-shards');
const BrowserLoader = require('../apps/extension/src/shared/runtime-shard-browser');

const ENTRIES = Object.freeze([
  Object.freeze({
    locale: 'en',
    row: Object.freeze(['model', 'model', 'n', 1, 'en:model', 'gloss:model', 0, 0]),
    gloss: 'a representation'
  }),
  Object.freeze({
    locale: 'zh-Hant',
    row: Object.freeze(['學習', '学习', 'v', 0.8, 'zh:學習', 'gloss:學習', 0, 1, 'xue2 xi2']),
    gloss: 'to learn'
  })
]);

function artifacts() {
  return Shards.buildBrowserLexicalArtifacts(ENTRIES, {
    bucketCount: 64,
    builtAt: '2026-08-25T00:00:00.000Z',
    sourceIndex: {
      format: 'halo-runtime-lexical-index-v1',
      hash: { algorithm: 'sha256', value: 'b'.repeat(64) }
    },
    datasets: [
      { datasetId: 'fixture-en', version: '1', locale: 'en' },
      { datasetId: 'fixture-zh', version: '1', locale: 'zh-Hant' }
    ],
    morphologyRows: [['models', 'model', 'n', 0, 'noun.exc:models']]
  });
}

async function runtimeFixture(options) {
  const settings = options || {};
  const built = artifacts();
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const reads = [];
  const runtime = BrowserLoader.createBrowserLexicalRuntime({
    manifest,
    maxResidentShards: settings.maxResidentShards || 32,
    now: settings.now,
    readText: async (resourcePath) => {
      reads.push(resourcePath);
      const serialized = built.serializedShards[resourcePath];
      if (settings.corruptPath === resourcePath) {
        return serialized.replace('"schemaVersion":1', '"schemaVersion":2');
      }
      return serialized;
    }
  });
  return { built, manifest, reads, runtime };
}

test('a verified manifest routes and loads only the requested shard', async () => {
  const fixture = await runtimeFixture();
  const ids = fixture.runtime.requiredShardIds(['The model learns.'], 'en');
  await fixture.runtime.ensureShards(ids);

  assert.ok(fixture.reads.length > 0);
  assert.ok(fixture.reads.every((resourcePath) => resourcePath.includes('/en/')));
  assert.equal(fixture.runtime.status().residentCount, ids.length);
});

test('shard hash verification precedes schema validation and rejected promises are retriable', async () => {
  const built = artifacts();
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const descriptor = manifest.shards.find((value) => value.locale === 'en' && value.rowCounts.lexical > 0);
  let reads = 0;
  const runtime = BrowserLoader.createBrowserLexicalRuntime({
    manifest,
    readText: async () => {
      reads += 1;
      return built.serializedShards[descriptor.path].replace('"schemaVersion":1', '"schemaVersion":2');
    }
  });

  await assert.rejects(() => runtime.ensureShards([descriptor.id]), { code: 'SHARD_HASH_MISMATCH' });
  await assert.rejects(() => runtime.ensureShards([descriptor.id]), { code: 'SHARD_HASH_MISMATCH' });
  assert.equal(reads, 2);
  assert.deepEqual(runtime.status().failures, [{ code: 'SHARD_HASH_MISMATCH' }]);
});

test('bounded LRU evicts unpinned shards but preserves a shard pinned by an active callback', async () => {
  let clock = 0;
  const fixture = await runtimeFixture({ maxResidentShards: 1, now: () => ++clock });
  const first = fixture.manifest.shards[0];
  const second = fixture.manifest.shards[1];
  await fixture.runtime.ensureShards([first.id]);

  await fixture.runtime.withPinnedShards([first.id], async (pinned) => {
    assert.equal(pinned[0].id, first.id);
    await fixture.runtime.ensureShards([second.id]);
    assert.equal(fixture.runtime.status().pinnedCount, 1);
    assert.equal(fixture.runtime.status().residentCount, 1);
    assert.equal(fixture.runtime.withPinnedShards([first.id], (again) => again[0].id), first.id);
  });

  assert.equal(fixture.runtime.status().pinnedCount, 0);
  assert.equal(fixture.runtime.status().residentCount, 1);
});

test('pin acquisition is atomic when any requested shard is absent', async () => {
  const fixture = await runtimeFixture();
  const first = fixture.manifest.shards[0];
  await fixture.runtime.ensureShards([first.id]);

  assert.throws(
    () => fixture.runtime.withPinnedShards([first.id, 'missing-shard'], () => null),
    { code: 'SHARD_NOT_RESIDENT' }
  );
  assert.equal(fixture.runtime.status().pinnedCount, 0);
});

test('unsupported language modes route no shards and status exposes no resource paths or content', async () => {
  const fixture = await runtimeFixture();
  assert.deepEqual(fixture.runtime.requiredShardIds(['modèle 學習'], 'fr'), []);
  assert.equal(JSON.stringify(fixture.runtime.status()).includes('shards/'), false);
  assert.equal(JSON.stringify(fixture.runtime.status()).includes('model'), false);
});
