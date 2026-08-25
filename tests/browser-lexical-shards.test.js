'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Shards = require('../packages/lexical-index/browser-lexical-shards');
const BrowserBuild = require('../scripts/build-browser-lexical-runtime');

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
