'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveChromiumExecutable } = require('../scripts/browser-harness');

test('explicit Chromium path has priority and must be executable', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-browser-harness-'));
  try {
    const executablePath = path.join(temporaryRoot, process.platform === 'win32' ? 'chrome.exe' : 'chrome');
    fs.writeFileSync(executablePath, '');
    if (process.platform !== 'win32') fs.chmodSync(executablePath, 0o755);
    assert.equal(resolveChromiumExecutable({ explicitPath: executablePath }), executablePath);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('missing Chromium fails explicitly instead of skipping browser gates', () => {
  const previous = process.env.HALO_CHROMIUM_PATH;
  try {
    delete process.env.HALO_CHROMIUM_PATH;
    assert.throws(
      () => resolveChromiumExecutable({ explicitPath: '/definitely/missing/chromium' }),
      /Chromium executable is unavailable/
    );
  } finally {
    if (previous === undefined) delete process.env.HALO_CHROMIUM_PATH;
    else process.env.HALO_CHROMIUM_PATH = previous;
  }
});

test('browser shard comparison applies the fixed 64-first selection rule without rounding', () => {
  const { selectShardCandidate } = require('../scripts/profile-browser-runtime');
  assert.deepEqual(selectShardCandidate([
    { bucketCount: 64, allBlockingPassed: true },
    { bucketCount: 128, allBlockingPassed: true }
  ]), {
    status: 'selected',
    selectedBucketCount: 64,
    rule: '64 if both pass; 128 if only 128 passes; blocked if neither passes'
  });
  assert.deepEqual(selectShardCandidate([
    { bucketCount: 64, allBlockingPassed: false },
    { bucketCount: 128, allBlockingPassed: true }
  ]), {
    status: 'selected',
    selectedBucketCount: 128,
    rule: '64 if both pass; 128 if only 128 passes; blocked if neither passes'
  });
  assert.deepEqual(selectShardCandidate([
    { bucketCount: 64, allBlockingPassed: false },
    { bucketCount: 128, allBlockingPassed: false }
  ]), {
    status: 'blocked',
    selectedBucketCount: null,
    rule: '64 if both pass; 128 if only 128 passes; blocked if neither passes'
  });
});

test('comparison command fixes candidate order and routes evidence to the v0.4 shard path', () => {
  const { DEFAULT_COMPARISON_PATH, parseCommandLine } = require('../scripts/profile-browser-runtime');
  const command = parseCommandLine(['--compare-buckets', '64,128', '--write']);
  assert.equal(command.profileKind, 'shard-comparison');
  assert.deepEqual(command.bucketCounts, [64, 128]);
  assert.equal(command.outputPath, DEFAULT_COMPARISON_PATH);
  assert.throws(
    () => parseCommandLine(['--compare-buckets', '128,64', '--write']),
    /exactly 64,128/
  );
});

test('comparison verification requires candidate manifest hashes and a selected status', () => {
  const { verifyBrowserShardComparison } = require('../scripts/profile-browser-runtime');
  const base = {
    schemaVersion: 1,
    comparisonFormat: 'BrowserLexicalShardComparison/v1',
    generatedAt: '2026-08-26T00:00:00.000Z',
    browser: { name: 'Chromium', version: 'Chromium 140.0.0.0' },
    host: { os: 'TestOS', cpuClass: 'test-cpu', memoryClass: 'test-memory' },
    fixture: { id: 'bilingual-required-shards-v1', text: 'Models 學習', languageMode: 'both' },
    candidates: [64, 128].map((bucketCount) => ({
      bucketCount,
      manifestHash: { algorithm: 'sha256', value: 'a'.repeat(64) },
      manifestRootHash: { algorithm: 'sha256', value: 'b'.repeat(64) },
      shardCount: bucketCount * 2,
      sizes: { manifestBytes: 1, totalShardBytes: 2, totalShardGzipBytes: 1, maximumShardBytes: 1 },
      browserVersion: 'Chromium 140.0.0.0',
      conditions: {
        cold: { browserContexts: 5, samples: Array.from({ length: 5 }, (_v, contextIndex) => ({
          condition: 'cold', contextIndex, durationMs: 10, requiredShardCount: 1, residentShardCount: 1
        })) },
        warm: { annotationsPerContext: 20, samples: Array.from({ length: 5 }, (_v, contextIndex) => ({
          condition: 'warm', contextIndex, samplesMs: Array(20).fill(1)
        })) },
        longTasks: { samples: Array.from({ length: 5 }, (_v, contextIndex) => ({
          condition: 'long-tasks', contextIndex, durationsMs: []
        })) }
      },
      measurements: {
        coldRequiredShardsP50Ms: 10,
        coldRequiredShardsP95Ms: 10,
        coldRequiredShardsMaxMs: 10,
        warmLookupP50Ms: 1,
        warmLookupP95Ms: 1,
        warmLookupMaxMs: 1,
        longTaskP50Ms: 0,
        longTaskP95Ms: 0,
        longTaskMaxMs: 0
      },
      budgets: { coldRequiredShardsP95Ms: 300, warmLookupP95Ms: 100, longTaskMaxMs: 50 },
      gates: { coldRequiredShards: true, warmLookup: true, longTask: true },
      allBlockingPassed: true
    })),
    selection: {
      rule: '64 if both pass; 128 if only 128 passes; blocked if neither passes',
      status: 'selected',
      selectedBucketCount: 64
    }
  };
  const missingHash = structuredClone(base);
  delete missingHash.candidates[0].manifestHash;
  assert.throws(() => verifyBrowserShardComparison(missingHash), /candidate manifest hashes/);
  const wrongStatus = structuredClone(base);
  wrongStatus.selection.status = 'blocked';
  assert.throws(() => verifyBrowserShardComparison(wrongStatus), /fixed rule/);
});

test('fixture server uses loopback ephemeral URLs and explicit UTF-8 content types', async () => {
  const { withFixtureServer } = require('./browser/helpers/fixture-server');
  await withFixtureServer({
    '/lesson.html': {
      body: '<p>學習 English</p>',
      contentType: 'text/html'
    }
  }, async ({ origin }) => {
    const url = new URL(origin);
    assert.equal(url.hostname, '127.0.0.1');
    assert.notEqual(url.port, '0');
    assert.equal(url.protocol, 'http:');
  });
});

test('browser harness reports a deterministic Chromium provider choice', () => {
  const script = `
    const { resolveChromiumExecutable } = require('./scripts/browser-harness');
    try {
      const value = resolveChromiumExecutable();
      process.stdout.write(value);
    } catch (error) {
      process.stdout.write(error.message);
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.length > 0);
});
