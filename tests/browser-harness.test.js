const test = require('node:test');
const assert = require('node:assert/strict');

async function validBrowserProfileFixture() {
  const { profileLegacyRuntime, REQUIRED_METRICS } = require('../scripts/profile-browser-runtime');
  const measurements = Object.fromEntries(REQUIRED_METRICS.map((name, index) => [name, index + 1]));
  measurements.heapPeakBytes = 'unknown';
  measurements.serviceWorkerRestart = {
    supported: true,
    restarted: true,
    durationMs: 4,
    previousWorkerIdentity: 'version-1:target-1',
    restartedWorkerIdentity: 'version-1:target-2'
  };
  return profileLegacyRuntime({
    browserVersion: 'Chromium 140.0.0.0',
    fixtureText: 'The models learn. 學生學習。',
    host: { os: 'TestOS', cpuClass: 'fixture-cpu', memoryClass: 'fixture-memory' },
    indexHash: 'f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21',
    now: () => '2026-08-26T00:00:00.000Z',
    runColdContext: async () => ({
      measurements: { ...measurements },
      warmAnnotationSamplesMs: Array.from({ length: 20 }, (_value, index) => index + 0.25)
    })
  });
}

test('explicit Chromium path has priority and must be executable', () => {
  const Harness = require('./browser/helpers/extension-harness');
  const result = Harness.resolveChromiumExecutable({
    environment: { HALO_CHROMIUM_EXECUTABLE: '/fixture/chromium' },
    exists: (value) => value === '/fixture/chromium',
    playwrightExecutable: '/managed/chromium'
  });
  assert.equal(result.path, '/fixture/chromium');
  assert.equal(result.source, 'environment');
});

test('missing Chromium fails explicitly instead of skipping browser gates', () => {
  const Harness = require('./browser/helpers/extension-harness');
  assert.throws(() => Harness.resolveChromiumExecutable({
    environment: {},
    exists: () => false,
    playwrightExecutable: '/missing/chromium'
  }), /Chromium executable is required/);
});

test('browser shard comparison applies the fixed 64-first selection rule without rounding', () => {
  const { selectShardCandidate } = require('../scripts/profile-browser-runtime');
  const passing64 = { bucketCount: 64, allBlockingPassed: true };
  const passing128 = { bucketCount: 128, allBlockingPassed: true };
  const failing64 = { bucketCount: 64, allBlockingPassed: false };

  assert.deepEqual(selectShardCandidate([passing64, passing128]), {
    rule: '64 if both pass; 128 if only 128 passes; blocked if neither passes',
    status: 'selected',
    selectedBucketCount: 64
  });
  assert.equal(selectShardCandidate([failing64, passing128]).selectedBucketCount, 128);
  assert.deepEqual(selectShardCandidate([failing64, { ...passing128, allBlockingPassed: false }]), {
    rule: '64 if both pass; 128 if only 128 passes; blocked if neither passes',
    status: 'blocked',
    selectedBucketCount: null
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

    const response = await fetch(origin + '/lesson.html');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await response.text(), '<p>學習 English</p>');
  });
});

test('fixture server refuses encoded path traversal', async () => {
  const { withFixtureServer } = require('./browser/helpers/fixture-server');
  await withFixtureServer({
    '/lesson.html': { body: 'safe', contentType: 'text/plain' }
  }, async ({ origin }) => {
    const response = await fetch(origin + '/..%2flesson.html');
    assert.equal(response.status, 400);
    assert.equal(await response.text(), 'Invalid fixture path');
  });
});

test('browser profile rejects a sample with any required measurement missing', () => {
  const { assertCompleteMeasurements } = require('../scripts/profile-browser-runtime');
  assert.throws(
    () => assertCompleteMeasurements({ compressedBytes: 1 }),
    /browser baseline measurement is missing: uncompressedBytes/
  );
});

test('legacy profile keeps five cold contexts and twenty raw warm annotations separated', async () => {
  const { profileLegacyRuntime, REQUIRED_METRICS } = require('../scripts/profile-browser-runtime');
  const calls = [];
  const baseMeasurements = Object.fromEntries(REQUIRED_METRICS.map((name, index) => [name, index + 1]));
  baseMeasurements.heapPeakBytes = 'unknown';
  baseMeasurements.serviceWorkerRestart = {
    supported: true,
    restarted: true,
    durationMs: 4,
    previousWorkerIdentity: 'version-1:target-1',
    restartedWorkerIdentity: 'version-1:target-2'
  };

  const report = await profileLegacyRuntime({
    browserVersion: 'Chromium 140.0.0.0',
    coldContexts: 5,
    fixtureText: 'The models learn. 學生學習。',
    host: { os: 'TestOS', cpuClass: 'fixture-cpu', memoryClass: 'fixture-memory' },
    indexHash: 'f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21',
    now: () => '2026-08-26T00:00:00.000Z',
    runColdContext: async ({ contextIndex, warmAnnotations }) => {
      calls.push({ contextIndex, warmAnnotations });
      return {
        measurements: { ...baseMeasurements },
        warmAnnotationSamplesMs: Array.from({ length: warmAnnotations }, (_value, index) => index + 0.25)
      };
    },
    warmAnnotations: 20
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.profileFormat, 'BrowserRuntimeProfile/v1');
  assert.equal(report.conditions.cold.samples.length, 5);
  assert.equal(report.conditions.warm.annotationsPerContext, 20);
  assert.deepEqual(report.conditions.warm.samples.map((sample) => sample.samplesMs.length), [20, 20, 20, 20, 20]);
  assert.deepEqual(calls, Array.from({ length: 5 }, (_value, contextIndex) => ({ contextIndex, warmAnnotations: 20 })));
  assert.equal(report.index.hash, 'f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21');
  assert.equal(report.browser.version, 'Chromium 140.0.0.0');
  assert.equal(report.fixture.text, 'The models learn. 學生學習。');
});

test('browser profile verification rejects a wrong legacy hash and incomplete warm evidence', async () => {
  const {
    profileLegacyRuntime,
    REQUIRED_METRICS,
    verifyBrowserRuntimeProfile
  } = require('../scripts/profile-browser-runtime');
  const measurements = Object.fromEntries(REQUIRED_METRICS.map((name, index) => [name, index + 1]));
  measurements.heapPeakBytes = 'unknown';
  measurements.serviceWorkerRestart = {
    supported: true,
    restarted: true,
    durationMs: 4,
    previousWorkerIdentity: 'version-1:target-1',
    restartedWorkerIdentity: 'version-1:target-2'
  };
  const report = await profileLegacyRuntime({
    browserVersion: 'Chromium 140.0.0.0',
    fixtureText: 'The models learn. 學生學習。',
    host: { os: 'TestOS', cpuClass: 'fixture-cpu', memoryClass: 'fixture-memory' },
    indexHash: 'f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21',
    now: () => '2026-08-26T00:00:00.000Z',
    runColdContext: async () => ({
      measurements: { ...measurements },
      warmAnnotationSamplesMs: Array.from({ length: 20 }, (_value, index) => index + 0.25)
    })
  });

  assert.equal(verifyBrowserRuntimeProfile(report), true);
  const wrongHash = JSON.parse(JSON.stringify(report));
  wrongHash.index.hash = '0'.repeat(64);
  assert.throws(() => verifyBrowserRuntimeProfile(wrongHash), /legacy index hash/);
  const incompleteWarm = JSON.parse(JSON.stringify(report));
  incompleteWarm.conditions.warm.samples[0].samplesMs.pop();
  assert.throws(
    () => verifyBrowserRuntimeProfile(incompleteWarm),
    /raw warm annotation samples must satisfy annotationsPerContext/
  );
  const mislabeledRestart = JSON.parse(JSON.stringify(report));
  mislabeledRestart.conditions.serviceWorkerRestart.samples[0].condition = 'warm';
  assert.throws(() => verifyBrowserRuntimeProfile(mislabeledRestart), /condition topology is invalid/);
});

test('canonical evidence rejects unsupported or failed service-worker restart observations', async () => {
  const { verifyBrowserRuntimeProfile } = require('../scripts/profile-browser-runtime');
  for (const restart of [
    { supported: false, restarted: false, durationMs: 4 },
    { supported: true, restarted: false, durationMs: 4 }
  ]) {
    const report = JSON.parse(JSON.stringify(await validBrowserProfileFixture()));
    report.conditions.cold.samples[0].measurements.serviceWorkerRestart = restart;
    report.conditions.serviceWorkerRestart.samples[0].result = restart;
    assert.throws(
      () => verifyBrowserRuntimeProfile(report),
      /successful service-worker restart is required for canonical evidence/
    );
  }
});

test('browser profile topology requires exactly one matching sample for every context index', async () => {
  const { verifyBrowserRuntimeProfile } = require('../scripts/profile-browser-runtime');
  const mutations = [
    (report) => report.conditions.cold.samples.push(report.conditions.cold.samples[0]),
    (report) => { delete report.conditions.cold.samples[0].contextIndex; },
    (report) => { report.conditions.warm.samples[4].contextIndex = 3; },
    (report) => { report.conditions.serviceWorkerRestart.samples[4].contextIndex = 8; }
  ];
  for (const mutate of mutations) {
    const report = JSON.parse(JSON.stringify(await validBrowserProfileFixture()));
    mutate(report);
    assert.throws(() => verifyBrowserRuntimeProfile(report), /condition topology is invalid/);
  }
});

test('warm sample counts satisfy the declared annotations per context', async () => {
  const { verifyBrowserRuntimeProfile } = require('../scripts/profile-browser-runtime');
  const report = JSON.parse(JSON.stringify(await validBrowserProfileFixture()));
  report.conditions.warm.annotationsPerContext = 21;
  assert.throws(
    () => verifyBrowserRuntimeProfile(report),
    /raw warm annotation samples must satisfy annotationsPerContext/
  );
});

test('service-worker restart does not accept an old-worker response without a new running identity', async () => {
  const { EventEmitter } = require('node:events');
  const { restartServiceWorker } = require('../scripts/profile-browser-runtime');
  const session = new EventEmitter();
  session.detach = async () => {};
  session.send = async (method) => {
    if (method === 'ServiceWorker.enable') {
      session.emit('ServiceWorker.workerVersionUpdated', {
        versions: [{
          versionId: 'version-1',
          targetId: 'target-1',
          scriptURL: 'chrome-extension://fixture/src/service-worker.js',
          runningStatus: 'running'
        }]
      });
    }
    if (method === 'ServiceWorker.stopWorker') {
      session.emit('ServiceWorker.workerVersionUpdated', {
        versions: [{
          versionId: 'version-1',
          targetId: 'target-1',
          scriptURL: 'chrome-extension://fixture/src/service-worker.js',
          runningStatus: 'stopped'
        }]
      });
    }
  };
  let annotations = 0;
  const result = await restartServiceWorker(
    { newCDPSession: async () => session },
    { waitForTimeout: async () => {}, evaluate: async () => { annotations += 1; } },
    { url: () => 'chrome-extension://fixture/src/service-worker.js' },
    'fixture text',
    { timeoutMs: 20 }
  );
  assert.equal(result.supported, true);
  assert.equal(result.restarted, false);
  assert.equal(annotations, 1);
});

test('service-worker restart measures only after observing a distinct running worker identity', async () => {
  const { EventEmitter } = require('node:events');
  const { restartServiceWorker } = require('../scripts/profile-browser-runtime');
  const session = new EventEmitter();
  session.detach = async () => {};
  session.send = async (method) => {
    if (method === 'ServiceWorker.enable') {
      session.emit('ServiceWorker.workerVersionUpdated', {
        versions: [{
          versionId: 'version-1',
          targetId: 'target-1',
          scriptURL: 'chrome-extension://fixture/src/service-worker.js',
          runningStatus: 'running'
        }]
      });
    }
    if (method === 'ServiceWorker.stopWorker') {
      session.emit('ServiceWorker.workerVersionUpdated', {
        versions: [{
          versionId: 'version-1',
          targetId: 'target-1',
          scriptURL: 'chrome-extension://fixture/src/service-worker.js',
          runningStatus: 'stopped'
        }]
      });
    }
  };
  let annotations = 0;
  const result = await restartServiceWorker(
    { newCDPSession: async () => session },
    {
      evaluate: async () => {
        annotations += 1;
        if (annotations === 1) {
          session.emit('ServiceWorker.workerVersionUpdated', {
            versions: [{
              versionId: 'version-1',
              targetId: 'target-2',
              scriptURL: 'chrome-extension://fixture/src/service-worker.js',
              runningStatus: 'running'
            }]
          });
        }
      }
    },
    { url: () => 'chrome-extension://fixture/src/service-worker.js' },
    'fixture text',
    { timeoutMs: 20 }
  );
  assert.equal(result.restarted, true);
  assert.equal(result.previousWorkerIdentity, 'version-1:target-1');
  assert.equal(result.restartedWorkerIdentity, 'version-1:target-2');
  assert.equal(annotations, 2);
});

test('legacy ZIP measurements use the packaged index entry sizes', () => {
  const path = require('node:path');
  const { readZipEntrySizes } = require('../scripts/profile-browser-runtime');
  assert.deepEqual(
    readZipEntrySizes(
      path.join(__dirname, '..', 'dist', 'halo-learning-magic-hand-v0.3.0.zip'),
      'data/lexical-runtime-index.json'
    ),
    { compressedBytes: 11367634, uncompressedBytes: 48544255 }
  );
});

test('legacy runtime instrumentation preserves the loader API and profiling sink', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { instrumentLegacyRuntimeSource } = require('../scripts/profile-browser-runtime');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'extension', 'src', 'shared', 'runtime-index-browser.js'),
    'utf8'
  );
  const context = {
    TextEncoder,
    __HALO_RUNTIME_PROFILE__: { stageMs: {} },
    crypto: require('node:crypto').webcrypto,
    performance: require('node:perf_hooks').performance
  };
  context.globalThis = context;
  vm.runInNewContext(instrumentLegacyRuntimeSource(source), context);
  assert.equal(typeof context.HaloRuntimeIndexBrowser.loadRuntimeLexicalIndex, 'function');
  assert.deepEqual(Object.keys(context.__HALO_RUNTIME_PROFILE__.stageMs), []);
});

test('legacy profiler extracts and instruments a temporary v0.3.0 extension copy', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { prepareLegacyExtension } = require('../scripts/profile-browser-runtime');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-profile-test-'));
  try {
    const extensionRoot = prepareLegacyExtension(
      path.join(__dirname, '..', 'dist', 'halo-learning-magic-hand-v0.3.0.zip'),
      temporaryRoot
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
    const instrumented = fs.readFileSync(
      path.join(extensionRoot, 'src', 'shared', 'runtime-index-browser.js'),
      'utf8'
    );
    assert.equal(manifest.version, '0.3.0');
    assert.match(instrumented, /__HALO_RUNTIME_PROFILE__/);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(extensionRoot, 'data', 'lexical-runtime-index.json'), 'utf8')).hash.value,
      'f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21'
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('profile write mode fails closed without Chromium and writes no evidence', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-profile-cli-test-'));
  const outputPath = path.join(temporaryRoot, 'baseline.json');
  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'scripts', 'profile-browser-runtime.js'),
      '--write',
      '--output', outputPath
    ], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, HALO_CHROMIUM_EXECUTABLE: path.join(temporaryRoot, 'missing-chromium') }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Chromium executable is required for Halo browser gates/);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
