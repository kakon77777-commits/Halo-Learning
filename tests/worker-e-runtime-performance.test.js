'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Shards = require('../packages/lexical-index/browser-lexical-shards');
const BrowserLoader = require('../apps/extension/src/shared/runtime-shard-browser');
const {
  SHARD_COMPARISON_BUDGETS,
  evaluateShardCandidate,
  summarizeShardColdDecomposition
} = require('../scripts/profile-browser-runtime');

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
      hash: { algorithm: 'sha256', value: 'b'.repeat(64) }
    },
    datasets: [
      { datasetId: 'fixture-en', version: '1', locale: 'en' },
      { datasetId: 'fixture-zh', version: '1', locale: 'zh-Hant' }
    ],
    morphologyRows: [['models', 'model', 'n', 0, 'noun.exc:models']]
  });
}

function denseEnglishShardArtifacts(rowCount) {
  const bucketCount = 64;
  const targetBucket = 0;
  const entries = [];
  for (let candidate = 0; entries.length < rowCount; candidate += 1) {
    const surface = `worker-e-${candidate}`;
    if (Shards.routeEnglishSurface(surface, bucketCount) !== targetBucket) continue;
    entries.push({
      locale: 'en',
      row: [surface, surface, 'n', 1, `en:${surface}`, `gloss:${surface}`, 0, 0],
      gloss: 'shared Worker E gloss'
    });
  }
  return Shards.buildBrowserLexicalArtifacts(entries, {
    bucketCount,
    builtAt: '2026-08-25T00:00:00.000Z',
    sourceIndex: {
      format: 'halo-runtime-lexical-index-v1',
      hash: { algorithm: 'sha256', value: 'c'.repeat(64) }
    },
    datasets: [{ datasetId: 'fixture-en', version: '1', locale: 'en' }]
  });
}

test('verified browser shard loading exposes the required cold-path stage decomposition', async () => {
  const built = artifacts();
  const manifestProfile = { stageMs: {} };
  const manifest = await BrowserLoader.loadBrowserLexicalManifest(built.serializedManifest, {
    profile: manifestProfile
  });
  const descriptor = manifest.shards.find((value) => value.locale === 'en' && value.rowCounts.lexical > 0);
  const profile = { stageMs: {} };

  const shard = await BrowserLoader.loadBrowserLexicalShard(
    built.serializedShards[descriptor.path],
    manifest,
    { profile }
  );

  assert.equal(shard.id, descriptor.id);
  for (const name of [
    'manifestJsonParseMs',
    'manifestIntegrityMs',
    'manifestValidationMs',
    'manifestDeepFreezeMs'
  ]) {
    assert.ok(Number.isFinite(manifestProfile.stageMs[name]), `missing ${name}`);
    assert.ok(manifestProfile.stageMs[name] >= 0, `${name} must be non-negative`);
  }
  for (const name of [
    'shardJsonParseMs',
    'shardCanonicalizeMs',
    'shardSha256Ms',
    'shardDescriptorBytesMs',
    'shardValidationMs',
    'shardDeepFreezeMs',
    'shardMaterializationMs'
  ]) {
    assert.ok(Number.isFinite(profile.stageMs[name]), `missing ${name}`);
    assert.ok(profile.stageMs[name] >= 0, `${name} must be non-negative`);
  }
});

test('frozen Worker E shard gates accept measurements exactly on every budget boundary', () => {
  assert.deepEqual(SHARD_COMPARISON_BUDGETS, {
    coldRequiredShardsP95Ms: 300,
    warmLookupP95Ms: 100,
    longTaskMaxMs: 50
  });
  const candidate = {
    conditions: {
      cold: { samples: Array.from({ length: 5 }, () => ({ durationMs: 300 })) },
      warm: {
        samples: Array.from({ length: 5 }, () => ({
          samplesMs: Array.from({ length: 20 }, () => 100)
        }))
      },
      longTasks: {
        samples: Array.from({ length: 5 }, () => ({ durationsMs: [50] }))
      }
    }
  };

  const evaluated = evaluateShardCandidate(candidate);
  assert.deepEqual(evaluated.gates, {
    coldRequiredShards: true,
    warmLookup: true,
    longTask: true
  });
  assert.equal(evaluated.allBlockingPassed, true);
});

test('cold-path decomposition reports stable p50 p95 max stage statistics and load context', () => {
  const samples = [1, 2, 3, 4, 5].map((value) => ({
    decomposition: {
      stageMs: {
        manifestFetchMs: value,
        shardValidationMs: value * 10
      },
      bytesLoaded: value * 100,
      shardCount: value,
      usedJsHeapBytes: value === 5 ? 5000 : 'unknown'
    }
  }));

  assert.deepEqual(summarizeShardColdDecomposition(samples), {
    sampleCount: 5,
    stages: [
      { name: 'manifestFetchMs', p50Ms: 3, p95Ms: 5, maxMs: 5 },
      { name: 'shardValidationMs', p50Ms: 30, p95Ms: 50, maxMs: 50 }
    ],
    bytesLoaded: { p50: 300, p95: 500, max: 500 },
    shardCount: { p50: 3, p95: 5, max: 5 },
    usedJsHeapBytes: { measurableSamples: 1, max: 5000 }
  });
});

test('canonical row-order validation encodes each dense lexical row at most once for ordering', async () => {
  const rowCount = 32;
  const built = denseEnglishShardArtifacts(rowCount);
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

  // SHA input + descriptor bytes + one ordering encoding per lexical row +
  // one routing encoding per lexical row. Allow two calls of headroom for
  // future fixed-size metadata checks, but not the previous adjacent-pair re-encoding.
  assert.ok(
    encodeCalls <= (rowCount * 2) + 4,
    `expected linear row encoding work, observed ${encodeCalls} TextEncoder.encode calls for ${rowCount} rows`
  );
});
