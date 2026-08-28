'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const Shards = require('../packages/lexical-index/browser-lexical-shards');
const BrowserBuild = require('../scripts/build-browser-lexical-runtime');
const BrowserProfile = require('../scripts/profile-browser-runtime');

const ROOT = path.join(__dirname, '..');

const DATASETS = Object.freeze([
  Object.freeze({ datasetId: 'fixture-en', version: '1', locale: 'en' }),
  Object.freeze({ datasetId: 'fixture-zh', version: '1', locale: 'zh-Hant' })
]);

const FIXTURE_ENTRIES = Object.freeze([
  Object.freeze({
    locale: 'en',
    row: Object.freeze(['model', 'model', 'n', 1, 'en:model', 'gloss:model', 0, 0]),
    gloss: 'a representation'
  }),
  Object.freeze({
    locale: 'zh-Hant',
    row: Object.freeze(['學習', '学习', 'v', 0.8, 'zh:學習', 'gloss:學習', 0, 1, 'xue2 xi2']),
    gloss: 'to learn'
  }),
  Object.freeze({
    locale: 'en',
    row: Object.freeze(['learner', 'learner', 'n', 1, 'en:learner', 'gloss:learner', 0, 0]),
    gloss: 'a representation'
  })
]);

function fixtureOptions(bucketCount) {
  return {
    bucketCount,
    builtAt: '2026-08-25T00:00:00.000Z',
    sourceIndex: {
      format: 'halo-runtime-lexical-index-v1',
      hash: { algorithm: 'sha256', value: 'a'.repeat(64) }
    },
    datasets: DATASETS,
    morphologyRows: [
      ['models', 'model', 'n', 0, 'noun.exc:models']
    ]
  };
}

function comparisonCandidate(artifacts, bucketCount) {
  return BrowserProfile.evaluateShardCandidate({
    bucketCount,
    manifestHash: artifacts.manifest.hash,
    manifestRootHash: artifacts.manifest.rootHash,
    shardCount: artifacts.manifest.shards.length,
    sizes: { manifestBytes: 1, totalShardBytes: 2, totalShardGzipBytes: 1, maximumShardBytes: 1 },
    browserVersion: 'Chromium 140.0.0.0',
    conditions: {
      cold: {
        browserContexts: 5,
        samples: Array.from({ length: 5 }, (_value, contextIndex) => ({
          condition: 'cold', contextIndex, durationMs: 10, requiredShardCount: 1, residentShardCount: 1
        }))
      },
      warm: {
        annotationsPerContext: 20,
        samples: Array.from({ length: 5 }, (_value, contextIndex) => ({
          condition: 'warm', contextIndex, samplesMs: Array(20).fill(1)
        }))
      },
      longTasks: {
        samples: Array.from({ length: 5 }, (_value, contextIndex) => ({
          condition: 'long-tasks', contextIndex, durationsMs: []
        }))
      }
    }
  });
}

function comparisonEvidence(artifacts64, artifacts128) {
  const candidates = [comparisonCandidate(artifacts64, 64), comparisonCandidate(artifacts128, 128)];
  return {
    schemaVersion: 1,
    comparisonFormat: 'BrowserLexicalShardComparison/v1',
    generatedAt: '2026-08-26T00:00:00.000Z',
    browser: { name: 'Chromium', version: 'Chromium 140.0.0.0' },
    host: { os: 'TestOS', cpuClass: 'test-cpu', memoryClass: 'test-memory' },
    fixture: { id: 'bilingual-required-shards-v1', text: 'Models 學習', languageMode: 'both' },
    candidates,
    selection: BrowserProfile.selectShardCandidate(candidates)
  };
}

test('routing is deterministic, normalized, and language-specific', () => {
  assert.equal(Shards.routeEnglishSurface('Models', 64), Shards.routeEnglishSurface('models', 64));
  assert.equal(Shards.routeChineseSurface('學習', 64), Shards.routeChineseSurface('學者', 64));
  assert.notEqual(Shards.ROUTING.en.id, Shards.ROUTING['zh-Hant'].id);
});

test('same corpus and bucket count produce byte-identical manifest and shards', () => {
  const first = Shards.buildBrowserLexicalArtifacts(FIXTURE_ENTRIES, fixtureOptions(64));
  const second = Shards.buildBrowserLexicalArtifacts([...FIXTURE_ENTRIES].reverse(), fixtureOptions(64));

  assert.equal(first.serializedManifest, second.serializedManifest);
  assert.deepEqual(first.serializedShards, second.serializedShards);
  assert.equal(Object.keys(first.serializedShards).length, 128);
  assert.equal(first.manifest.statistics.rejectedCount, 0);
});

test('build-time shard attestation cryptographically binds the exact canonical delivered bytes', () => {
  const artifacts = Shards.buildBrowserLexicalArtifacts(FIXTURE_ENTRIES, fixtureOptions(64));
  for (const descriptor of artifacts.manifest.shards) {
    const serialized = artifacts.serializedShards[descriptor.path];
    assert.deepEqual(descriptor.validation, {
      id: 'halo-browser-lexical-build-validation',
      version: '1.0.0'
    });
    assert.equal(descriptor.serializedHash.algorithm, 'sha256');
    assert.equal(
      descriptor.serializedHash.value,
      crypto.createHash('sha256').update(serialized, 'utf8').digest('hex')
    );
  }
});

test('every shard uses a canonical local gloss table and binds to the manifest root', () => {
  const artifacts = Shards.buildBrowserLexicalArtifacts(FIXTURE_ENTRIES, fixtureOptions(64));
  const populated = Object.values(artifacts.serializedShards)
    .map(JSON.parse)
    .filter((shard) => shard.statistics.lexicalRowCount > 0);

  assert.deepEqual(populated.map((shard) => shard.glosses), [
    ['a representation'],
    ['a representation'],
    ['to learn']
  ]);
  assert.ok(populated.every((shard) => shard.manifestRoot.value === artifacts.manifest.rootHash.value));
  assert.ok(populated.every((shard) => shard.hash.algorithm === 'sha256'));
});

test('canonical dataset sorting remaps every lexical and morphology provenance index', () => {
  const options = fixtureOptions(64);
  const artifacts = Shards.buildBrowserLexicalArtifacts([
    { locale: 'zh-Hant', row: ['學習', '学习', 'v', 0.8, 'zh:學習', 'gloss:學習', 0, 0, 'xue2 xi2'], gloss: 'to learn' },
    { locale: 'en', row: ['model', 'model', 'n', 1, 'en:model', 'gloss:model', 0, 1], gloss: 'a representation' }
  ], {
    ...options,
    datasets: [DATASETS[1], DATASETS[0]],
    morphologyRows: [['models', 'model', 'n', 1, 'noun.exc:models']]
  });
  const shards = Object.values(artifacts.serializedShards).map(JSON.parse);
  const english = shards.find((shard) => shard.locale === 'en' && shard.lexicalRows.length);
  const chinese = shards.find((shard) => shard.locale === 'zh-Hant' && shard.lexicalRows.length);
  const morphology = shards.find((shard) => shard.morphologyRows.length);

  assert.deepEqual(artifacts.manifest.datasets.map((dataset) => dataset.datasetId), ['fixture-en', 'fixture-zh']);
  assert.equal(artifacts.manifest.datasets[english.lexicalRows[0][7]].datasetId, 'fixture-en');
  assert.equal(artifacts.manifest.datasets[chinese.lexicalRows[0][7]].datasetId, 'fixture-zh');
  assert.equal(artifacts.manifest.datasets[morphology.morphologyRows[0][3]].datasetId, 'fixture-en');
});

test('candidate build emits the exact language shard count with no hidden canonical selection', () => {
  const artifacts = BrowserBuild.buildBrowserRuntimeArtifacts({
    englishDir: path.join(ROOT, 'fixtures/lexical/wordnet-3.0-synthetic'),
    chineseDir: path.join(ROOT, 'fixtures/lexical/cc-cedict-synthetic'),
    builtAt: BrowserBuild.CANONICAL_BUILD_TIME,
    bucketCount: 128
  });

  assert.equal(artifacts.manifest.bucketCount, 128);
  assert.equal(artifacts.manifest.shards.length, 256);
  assert.equal(Object.keys(artifacts.files).filter((name) => name.startsWith('shards/')).length, 256);
  assert.equal(artifacts.manifest.statistics.rejectedCount, 3);
  assert.equal(artifacts.dataManifest.selectionStatus, 'candidate-unselected');
});

test('candidate publication stages a whole tree and verify mode never repairs a mismatch', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-browser-shards-test-'));
  const outputRoot = path.join(temporaryRoot, 'candidate-64');
  const artifacts = BrowserBuild.buildBrowserRuntimeArtifacts({
    englishDir: path.join(ROOT, 'fixtures/lexical/wordnet-3.0-synthetic'),
    chineseDir: path.join(ROOT, 'fixtures/lexical/cc-cedict-synthetic'),
    builtAt: BrowserBuild.CANONICAL_BUILD_TIME,
    bucketCount: 64
  });
  try {
    BrowserBuild.publishCandidateTree(artifacts, { outputRoot, mode: 'write' });
    BrowserBuild.publishCandidateTree(artifacts, { outputRoot, mode: 'verify' });
    const manifestPath = path.join(outputRoot, 'manifest.json');
    fs.writeFileSync(manifestPath, '{"corrupt":true}\n');
    assert.throws(
      () => BrowserBuild.publishCandidateTree(artifacts, { outputRoot, mode: 'verify' }),
      /does not match deterministic build/
    );
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), '{"corrupt":true}\n');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('canonical verify defaults to browser comparison evidence and cannot infer a winner', () => {
  const command = BrowserBuild.parseCommandLine(['--verify']);
  assert.equal(command.mode, 'verify');
  assert.equal(command.bucketCount, null);
  assert.equal(command.selectionFile, path.join(ROOT, BrowserBuild.DEFAULT_SELECTION_FILE));
});

test('canonical selection rejects fabricated integer-only and stale manifest evidence', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-browser-selection-test-'));
  const selectionPath = path.join(temporaryRoot, 'comparison.json');
  const options = {
    englishDir: path.join(ROOT, 'fixtures/lexical/wordnet-3.0-synthetic'),
    chineseDir: path.join(ROOT, 'fixtures/lexical/cc-cedict-synthetic'),
    builtAt: BrowserBuild.CANONICAL_BUILD_TIME
  };
  const artifacts64 = BrowserBuild.buildBrowserRuntimeArtifacts({ ...options, bucketCount: 64 });
  const artifacts128 = BrowserBuild.buildBrowserRuntimeArtifacts({ ...options, bucketCount: 128 });
  try {
    fs.writeFileSync(selectionPath, JSON.stringify({ selection: { selectedBucketCount: 64 } }));
    assert.throws(() => BrowserBuild.readSelectedComparison(selectionPath), /invalid BrowserRuntimeProfile\/v1/);

    const stale = structuredClone(comparisonEvidence(artifacts64, artifacts128));
    stale.candidates[0].manifestHash = { algorithm: 'sha256', value: 'd'.repeat(64) };
    fs.writeFileSync(selectionPath, JSON.stringify(stale));
    const verified = BrowserBuild.readSelectedComparison(selectionPath);
    assert.throws(
      () => BrowserBuild.assertSelectedArtifactBinding(artifacts64, verified),
      /does not match freshly rebuilt artifacts/
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('selected publication stages extension shards and distribution manifests as one operation', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-browser-selected-test-'));
  const artifacts = BrowserBuild.buildBrowserRuntimeArtifacts({
    englishDir: path.join(ROOT, 'fixtures/lexical/wordnet-3.0-synthetic'),
    chineseDir: path.join(ROOT, 'fixtures/lexical/cc-cedict-synthetic'),
    builtAt: BrowserBuild.CANONICAL_BUILD_TIME,
    bucketCount: 64,
    selectionStatus: 'selected-by-browser-comparison'
  });
  try {
    BrowserBuild.publishSelectedTrees(artifacts, { projectRoot: temporaryRoot, mode: 'write' });
    BrowserBuild.publishSelectedTrees(artifacts, { projectRoot: temporaryRoot, mode: 'verify' });
    assert.equal(
      fs.existsSync(path.join(temporaryRoot, BrowserBuild.CANONICAL_EXTENSION_ROOT, 'shards/en/00.json')),
      true
    );
    assert.deepEqual(
      fs.readdirSync(path.join(temporaryRoot, BrowserBuild.CANONICAL_DIST_ROOT)).sort(),
      ['build-receipt.json', 'data-manifest.json', 'manifest.json']
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
