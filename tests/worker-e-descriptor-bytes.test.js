'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Shards = require('../packages/lexical-index/browser-lexical-shards');
const BrowserLoader = require('../apps/extension/src/shared/runtime-shard-browser');

function artifacts() {
  return Shards.buildBrowserLexicalArtifacts([
    {
      locale: 'en',
      row: ['model', 'model', 'n', 1, 'en:model', 'gloss:model', 0, 0],
      gloss: 'a representation'
    }
  ], {
    bucketCount: 64,
    builtAt: '2026-08-25T00:00:00.000Z',
    sourceIndex: {
      format: 'halo-runtime-lexical-index-v1',
      hash: { algorithm: 'sha256', value: 'd'.repeat(64) }
    },
    datasets: [{ datasetId: 'fixture-en', version: '1', locale: 'en' }]
  });
}

test('manifest descriptor bytes bind the delivered shard text rather than a second reconstructed serialization', async () => {
  const built = artifacts();
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const descriptor = manifest.shards.find((value) => value.locale === 'en' && value.rowCounts.lexical > 0);
  const canonical = built.serializedShards[descriptor.path];
  const nonCanonicalSamePayload = canonical.replace('"bucket":', '"bucket": ');

  assert.notEqual(nonCanonicalSamePayload.length, canonical.length);
  await assert.rejects(
    () => BrowserLoader.loadBrowserLexicalShard(nonCanonicalSamePayload, manifest),
    { code: 'SHARD_HASH_MISMATCH' }
  );
});
