'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Shards = require('../packages/lexical-index/browser-lexical-shards');
const BrowserLoader = require('../apps/extension/src/shared/runtime-shard-browser');

function denseUniqueGlossArtifacts(rowCount) {
  const bucketCount = 64;
  const targetBucket = 0;
  const entries = [];
  for (let candidate = 0; entries.length < rowCount; candidate += 1) {
    const surface = `worker-e-gloss-${candidate}`;
    if (Shards.routeEnglishSurface(surface, bucketCount) !== targetBucket) continue;
    const gloss = `worker-e-unique-gloss-${String(entries.length).padStart(3, '0')}`;
    entries.push({
      locale: 'en',
      row: [surface, surface, 'n', 1, `en:${surface}`, `gloss:${surface}`, 0, entries.length],
      gloss
    });
  }
  return Shards.buildBrowserLexicalArtifacts(entries, {
    bucketCount,
    builtAt: '2026-08-25T00:00:00.000Z',
    sourceIndex: {
      format: 'halo-runtime-lexical-index-v1',
      hash: { algorithm: 'sha256', value: 'e'.repeat(64) }
    },
    datasets: [{ datasetId: 'fixture-en', version: '1', locale: 'en' }]
  });
}

test('canonical gloss-order validation encodes each gloss at most once for ordering', async () => {
  const rowCount = 32;
  const built = denseUniqueGlossArtifacts(rowCount);
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest);
  const descriptor = manifest.shards.find((value) => value.locale === 'en' && value.rowCounts.lexical === rowCount);
  assert.ok(descriptor, 'dense fixture must occupy one English shard');

  const OriginalTextEncoder = global.TextEncoder;
  let encodeCalls = 0;
  global.TextEncoder = class CountingTextEncoder {
    constructor() {
      this.delegate = new OriginalTextEncoder();
    }
    encode(value) {
      encodeCalls += 1;
      return this.delegate.encode(value);
    }
  };
  try {
    await BrowserLoader.loadBrowserLexicalShard(
      built.serializedShards[descriptor.path],
      manifest
    );
  } finally {
    global.TextEncoder = OriginalTextEncoder;
  }

  // One SHA input, one delivered-byte check, one row-order encoding per row,
  // one gloss-order encoding per gloss, and one routing encoding per row.
  assert.ok(
    encodeCalls <= (rowCount * 3) + 4,
    `expected linear gloss validation, observed ${encodeCalls} TextEncoder.encode calls for ${rowCount} rows/glosses`
  );
});
