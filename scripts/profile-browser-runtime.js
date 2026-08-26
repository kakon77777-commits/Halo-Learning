#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const zlib = require('node:zlib');
const {
  launchExtension,
  resolveChromiumExecutable
} = require('../tests/browser/helpers/extension-harness');

const REQUIRED_METRICS = Object.freeze([
  'compressedBytes',
  'uncompressedBytes',
  'fetchMs',
  'jsonParseMs',
  'sha256Ms',
  'integrityValidationMs',
  'deepFreezeMs',
  'englishMapMs',
  'chineseMapMs',
  'morphologyMapMs',
  'firstAnnotationMs',
  'warmAnnotationMs',
  'heapPeakBytes',
  'serviceWorkerRestart'
]);
const LEGACY_INDEX_HASH = 'f2a63b7b5af3673a7faea6acaed53776cb94bcf4146949d965a37b76003fca21';
const TIMING_METRICS = Object.freeze([
  'fetchMs',
  'jsonParseMs',
  'sha256Ms',
  'integrityValidationMs',
  'deepFreezeMs',
  'englishMapMs',
  'chineseMapMs',
  'morphologyMapMs',
  'firstAnnotationMs',
  'warmAnnotationMs'
]);
const DEFAULT_ARCHIVE_PATH = path.join(__dirname, '..', 'dist', 'halo-learning-magic-hand-v0.3.0.zip');
const DEFAULT_EVIDENCE_PATH = path.join(__dirname, '..', 'docs', 'validation', 'v0.4.0-browser-baseline.json');
const DEFAULT_COMPARISON_PATH = path.join(
  __dirname,
  '..',
  'docs',
  'validation',
  'v0.4.0-browser-shard-comparison.json'
);
const DEFAULT_SHARD_ADR_PATH = path.join(__dirname, '..', 'docs', 'adr', 'ADR-009-browser-lexical-sharding.md');
const DEFAULT_FIXTURE_TEXT = 'The students were learning models while 老師幫助學生學習。';
const SHARD_COMPARISON_BUDGETS = Object.freeze({
  coldRequiredShardsP95Ms: 300,
  warmLookupP95Ms: 100,
  longTaskMaxMs: 50
});
const SHARD_SELECTION_RULE = '64 if both pass; 128 if only 128 passes; blocked if neither passes';

function assertCompleteMeasurements(measurements) {
  for (const name of REQUIRED_METRICS) {
    if (measurements[name] === undefined) {
      throw new Error('browser baseline measurement is missing: ' + name);
    }
  }
  return measurements;
}

function readZipEntrySizes(archivePath, entryName) {
  const archive = fs.readFileSync(archivePath);
  const minimumEocdOffset = Math.max(0, archive.length - 65_557);
  let eocdOffset = -1;
  for (let offset = archive.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('legacy extension ZIP end record is missing');
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let offset = archive.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('legacy extension ZIP central directory is malformed');
    }
    const compressedBytes = archive.readUInt32LE(offset + 20);
    const uncompressedBytes = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === entryName) return { compressedBytes, uncompressedBytes };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`legacy extension ZIP entry is missing: ${entryName}`);
}

function replaceProfilerAnchor(source, anchor, replacement) {
  const offset = source.indexOf(anchor);
  if (offset < 0 || source.indexOf(anchor, offset + anchor.length) >= 0) {
    throw new Error('legacy runtime profiler anchor is missing or ambiguous');
  }
  return source.slice(0, offset) + replacement + source.slice(offset + anchor.length);
}

function instrumentLegacyRuntimeSource(source) {
  let instrumented = replaceProfilerAnchor(source,
    "  'use strict';\n\n  const SCHEMA_VERSION",
    "  'use strict';\n\n" +
    "  const profiler = root.__HALO_RUNTIME_PROFILE__ || null;\n" +
    "  function profileNow() { return root.performance.now(); }\n" +
    "  function recordStage(name, started) {\n" +
    "    if (profiler) profiler.stageMs[name] = profileNow() - started;\n" +
    "  }\n\n" +
    "  const SCHEMA_VERSION");
  instrumented = replaceProfilerAnchor(instrumented,
    '    let maxZhLength = 0;\n    for (const row of document.englishRows) {',
    '    let maxZhLength = 0;\n' +
    '    const englishMapStarted = profileNow();\n' +
    '    for (const row of document.englishRows) {');
  instrumented = replaceProfilerAnchor(instrumented,
    '    for (const row of document.chineseRows) {',
    "    recordStage('englishMapMs', englishMapStarted);\n" +
    '    const chineseMapStarted = profileNow();\n' +
    '    for (const row of document.chineseRows) {');
  instrumented = replaceProfilerAnchor(instrumented,
    '    for (const row of document.morphologyRows) {',
    "    recordStage('chineseMapMs', chineseMapStarted);\n" +
    '    const morphologyMapStarted = profileNow();\n' +
    '    for (const row of document.morphologyRows) {');
  instrumented = replaceProfilerAnchor(instrumented,
    '    return Object.freeze({\n      schemaVersion: document.schemaVersion,',
    "    recordStage('morphologyMapMs', morphologyMapStarted);\n" +
    '    return Object.freeze({\n      schemaVersion: document.schemaVersion,');
  instrumented = replaceProfilerAnchor(instrumented,
    '      raw = serializedText === null ? serialized : JSON.parse(serializedText);',
    '      const jsonParseStarted = profileNow();\n' +
    '      raw = serializedText === null ? serialized : JSON.parse(serializedText);\n' +
    "      recordStage('jsonParseMs', jsonParseStarted);");
  instrumented = replaceProfilerAnchor(instrumented,
    '    if (await sha256Hex(payloadText, cryptoValue) !== raw.hash.value) {',
    '    const sha256Started = profileNow();\n' +
    '    const actualHash = await sha256Hex(payloadText, cryptoValue);\n' +
    "    recordStage('sha256Ms', sha256Started);\n" +
    '    if (actualHash !== raw.hash.value) {');
  instrumented = replaceProfilerAnchor(instrumented,
    '    validateDocument(payload);\n    return runtimeFromDocument(deepFreeze({ ...payload, hash: { ...raw.hash } }));',
    '    const validationStarted = profileNow();\n' +
    '    validateDocument(payload);\n' +
    "    recordStage('integrityValidationMs', validationStarted);\n" +
    '    const deepFreezeStarted = profileNow();\n' +
    '    const frozenDocument = deepFreeze({ ...payload, hash: { ...raw.hash } });\n' +
    "    recordStage('deepFreezeMs', deepFreezeStarted);\n" +
    '    return runtimeFromDocument(frozenDocument);');
  return instrumented;
}

function prepareLegacyExtension(archivePath, temporaryRoot) {
  const extensionRoot = path.join(temporaryRoot, 'extension');
  fs.mkdirSync(extensionRoot, { recursive: true });
  const result = spawnSync('unzip', ['-q', archivePath, '-d', extensionRoot], {
    encoding: 'utf8'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`legacy extension unzip failed: ${(result.stderr || result.stdout).trim()}`);
  }
  const runtimePath = path.join(extensionRoot, 'src', 'shared', 'runtime-index-browser.js');
  const source = fs.readFileSync(runtimePath, 'utf8');
  fs.writeFileSync(runtimePath, instrumentLegacyRuntimeSource(source));
  return extensionRoot;
}

async function profileLegacyRuntime(options) {
  const settings = options || {};
  const coldContexts = settings.coldContexts === undefined ? 5 : settings.coldContexts;
  const warmAnnotations = settings.warmAnnotations === undefined ? 20 : settings.warmAnnotations;
  if (!Number.isInteger(coldContexts) || coldContexts < 5) {
    throw new Error('browser baseline requires at least five cold contexts');
  }
  if (!Number.isInteger(warmAnnotations) || warmAnnotations < 20) {
    throw new Error('browser baseline requires at least twenty warm annotations per context');
  }
  if (typeof settings.runColdContext !== 'function') {
    throw new TypeError('runColdContext: must be a function');
  }

  const coldSamples = [];
  const warmSamples = [];
  const restartSamples = [];
  let observedBrowserVersion = settings.browserVersion || null;
  for (let contextIndex = 0; contextIndex < coldContexts; contextIndex += 1) {
    const sample = await settings.runColdContext({
      contextIndex,
      fixtureText: settings.fixtureText,
      warmAnnotations
    });
    if (sample.browserVersion) {
      if (observedBrowserVersion && observedBrowserVersion !== sample.browserVersion) {
        throw new Error('browser version changed between cold contexts');
      }
      observedBrowserVersion = sample.browserVersion;
    }
    const measurements = assertCompleteMeasurements(sample.measurements);
    if (!Array.isArray(sample.warmAnnotationSamplesMs) || sample.warmAnnotationSamplesMs.length < warmAnnotations) {
      throw new Error('browser baseline is missing raw warm annotation samples');
    }
    coldSamples.push(Object.freeze({
      condition: 'cold',
      contextIndex,
      measurements: Object.freeze({ ...measurements })
    }));
    warmSamples.push(Object.freeze({
      condition: 'warm',
      contextIndex,
      samplesMs: Object.freeze(sample.warmAnnotationSamplesMs.slice())
    }));
    restartSamples.push(Object.freeze({
      condition: 'service-worker-restart',
      contextIndex,
      result: measurements.serviceWorkerRestart
    }));
  }

  return Object.freeze({
    schemaVersion: 1,
    profileFormat: 'BrowserRuntimeProfile/v1',
    generatedAt: (settings.now || (() => new Date().toISOString()))(),
    browser: Object.freeze({ name: 'Chromium', version: observedBrowserVersion }),
    host: Object.freeze({ ...settings.host }),
    fixture: Object.freeze({
      id: 'legacy-bilingual-annotation-v1',
      text: settings.fixtureText,
      languageMode: 'both'
    }),
    index: Object.freeze({
      condition: 'legacy-v0.3.0-monolith',
      hashAlgorithm: 'sha256',
      hash: settings.indexHash
    }),
    conditions: Object.freeze({
      cold: Object.freeze({ browserContexts: coldContexts, samples: Object.freeze(coldSamples) }),
      warm: Object.freeze({ annotationsPerContext: warmAnnotations, samples: Object.freeze(warmSamples) }),
      serviceWorkerRestart: Object.freeze({ samples: Object.freeze(restartSamples) })
    })
  });
}

function hostClasses() {
  const cpus = os.cpus();
  const cpuModel = cpus.length && cpus[0].model ? cpus[0].model.trim() : 'unknown-model';
  return Object.freeze({
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpuClass: `${cpus.length || 'unknown'} logical CPU; ${cpuModel}`,
    memoryClass: `${Math.ceil(os.totalmem() / (1024 ** 3))} GiB system memory`
  });
}

async function sendAnnotation(page, fixtureText) {
  return page.evaluate((text) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'HALO_ANNOTATE_BATCH',
      texts: [text],
      options: { languageMode: 'both', generatedAt: '2026-08-26T00:00:00.000Z' }
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.error || !Array.isArray(response.annotationSets) || response.annotationSets.length !== 1) {
        reject(new Error('legacy service worker returned an invalid annotation response'));
        return;
      }
      resolve(response.annotationSets[0].tokens.length);
    });
  }), fixtureText);
}

async function heapBytes(cdpSession) {
  try {
    const response = await cdpSession.send('Performance.getMetrics');
    const metric = response.metrics.find((value) => value.name === 'JSHeapUsedSize');
    return metric && Number.isFinite(metric.value) ? Math.round(metric.value) : 'unknown';
  } catch {
    return 'unknown';
  }
}

function workerIdentity(version) {
  if (!version || typeof version.versionId !== 'string' || !version.versionId ||
      typeof version.targetId !== 'string' || !version.targetId) {
    return null;
  }
  return `${version.versionId}:${version.targetId}`;
}

function waitForWorkerVersion(session, versions, predicate, description, timeoutMs) {
  const current = versions.find(predicate);
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.off('ServiceWorker.workerVersionUpdated', onUpdate);
      reject(new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`));
    }, timeoutMs);
    function onUpdate() {
      const match = versions.find(predicate);
      if (!match) return;
      clearTimeout(timeout);
      session.off('ServiceWorker.workerVersionUpdated', onUpdate);
      resolve(match);
    }
    session.on('ServiceWorker.workerVersionUpdated', onUpdate);
  });
}

async function restartServiceWorker(context, page, worker, fixtureText, options) {
  const settings = options || {};
  const timeoutMs = settings.timeoutMs || 5_000;
  const annotate = settings.sendAnnotation || sendAnnotation;
  const session = await context.newCDPSession(page);
  const versions = [];
  session.on('ServiceWorker.workerVersionUpdated', (event) => versions.splice(0, versions.length, ...event.versions));
  const started = performance.now();
  try {
    await session.send('ServiceWorker.enable');
    const version = await waitForWorkerVersion(
      session,
      versions,
      (value) => value.scriptURL === worker.url() && value.runningStatus === 'running',
      'running legacy service worker',
      timeoutMs
    );
    const previousWorkerIdentity = workerIdentity(version);
    if (!previousWorkerIdentity) {
      return Object.freeze({ supported: false, restarted: false, durationMs: performance.now() - started });
    }
    await session.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    await waitForWorkerVersion(
      session,
      versions,
      (value) => workerIdentity(value) === previousWorkerIdentity && value.runningStatus === 'stopped',
      'stopped legacy service worker',
      timeoutMs
    );
    const trigger = Promise.resolve()
      .then(() => annotate(page, fixtureText))
      .catch(() => null);
    try {
      const restartedVersion = await waitForWorkerVersion(
        session,
        versions,
        (value) => value.scriptURL === worker.url() && value.runningStatus === 'running' &&
          workerIdentity(value) !== null && workerIdentity(value) !== previousWorkerIdentity,
        'distinct restarted service worker',
        timeoutMs
      );
      await trigger;
      await annotate(page, fixtureText);
      return Object.freeze({
        supported: true,
        restarted: true,
        durationMs: performance.now() - started,
        previousWorkerIdentity,
        restartedWorkerIdentity: workerIdentity(restartedVersion)
      });
    } catch {
      return Object.freeze({
        supported: true,
        restarted: false,
        durationMs: performance.now() - started,
        previousWorkerIdentity,
        restartedWorkerIdentity: null
      });
    }
  } catch {
    return Object.freeze({ supported: false, restarted: false, durationMs: performance.now() - started });
  } finally {
    await session.detach().catch(() => {});
  }
}

async function runLegacyColdContext(options) {
  const context = await launchExtension({
    extensionRoot: options.extensionRoot,
    userDataDir: options.userDataDir,
    headless: true,
    executablePath: options.executablePath
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(worker.url()).hostname;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup.html`);
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('Performance.enable').catch(() => {});
    const versionInfo = await cdpSession.send('Browser.getVersion');
    const versionNumber = String(versionInfo.product || '').split('/').pop();
    const browserVersion = `Chromium ${versionNumber}`;
    const observedHeap = [await heapBytes(cdpSession)];

    await page.evaluate(() => {
      globalThis.__HALO_RUNTIME_PROFILE__ = { stageMs: {} };
    });
    await page.addScriptTag({ url: `chrome-extension://${extensionId}/src/shared/runtime-index-browser.js` });
    const loaderProfile = await page.evaluate(async () => {
      const fetchStarted = performance.now();
      const response = await fetch(chrome.runtime.getURL('data/lexical-runtime-index.json'), { cache: 'no-store' });
      if (!response.ok) throw new Error('legacy runtime index fetch failed');
      const serialized = await response.text();
      const fetchMs = performance.now() - fetchStarted;
      const runtime = await globalThis.HaloRuntimeIndexBrowser.loadRuntimeLexicalIndex(serialized);
      globalThis.__HALO_PROFILE_RUNTIME__ = runtime;
      return {
        fetchMs,
        indexHash: runtime.hash.value,
        serializedBytes: new TextEncoder().encode(serialized).byteLength,
        stageMs: { ...globalThis.__HALO_RUNTIME_PROFILE__.stageMs }
      };
    });
    if (loaderProfile.indexHash !== LEGACY_INDEX_HASH) {
      throw new Error('legacy browser runtime loaded an unexpected index hash');
    }
    if (loaderProfile.serializedBytes !== options.sizes.uncompressedBytes) {
      throw new Error('legacy browser fetch size differs from the release ZIP entry');
    }
    observedHeap.push(await heapBytes(cdpSession));

    const firstStarted = performance.now();
    await sendAnnotation(page, options.fixtureText);
    const firstAnnotationMs = performance.now() - firstStarted;
    observedHeap.push(await heapBytes(cdpSession));

    const warmAnnotationSamplesMs = [];
    for (let index = 0; index < options.warmAnnotations; index += 1) {
      const warmStarted = performance.now();
      await sendAnnotation(page, options.fixtureText);
      warmAnnotationSamplesMs.push(performance.now() - warmStarted);
      observedHeap.push(await heapBytes(cdpSession));
    }
    const warmAnnotationMs = warmAnnotationSamplesMs.reduce((total, value) => total + value, 0) /
      warmAnnotationSamplesMs.length;
    const serviceWorkerRestart = await restartServiceWorker(context, page, worker, options.fixtureText);
    observedHeap.push(await heapBytes(cdpSession));
    await cdpSession.detach().catch(() => {});
    const knownHeapSamples = observedHeap.filter(Number.isInteger);
    const heapPeakBytes = knownHeapSamples.length ? Math.max(...knownHeapSamples) : 'unknown';
    const measurements = {
      ...options.sizes,
      fetchMs: loaderProfile.fetchMs,
      jsonParseMs: loaderProfile.stageMs.jsonParseMs,
      sha256Ms: loaderProfile.stageMs.sha256Ms,
      integrityValidationMs: loaderProfile.stageMs.integrityValidationMs,
      deepFreezeMs: loaderProfile.stageMs.deepFreezeMs,
      englishMapMs: loaderProfile.stageMs.englishMapMs,
      chineseMapMs: loaderProfile.stageMs.chineseMapMs,
      morphologyMapMs: loaderProfile.stageMs.morphologyMapMs,
      firstAnnotationMs,
      warmAnnotationMs,
      heapPeakBytes,
      serviceWorkerRestart
    };
    return { browserVersion, measurements, warmAnnotationSamplesMs };
  } finally {
    await context.close();
  }
}

async function runBrowserProfile(options) {
  const settings = options || {};
  const archivePath = settings.archivePath || DEFAULT_ARCHIVE_PATH;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-browser-profile-'));
  try {
    const extensionRoot = prepareLegacyExtension(archivePath, temporaryRoot);
    const sizes = readZipEntrySizes(archivePath, 'data/lexical-runtime-index.json');
    return profileLegacyRuntime({
      browserVersion: null,
      fixtureText: settings.fixtureText || DEFAULT_FIXTURE_TEXT,
      host: settings.host || hostClasses(),
      indexHash: LEGACY_INDEX_HASH,
      runColdContext: ({ contextIndex, fixtureText, warmAnnotations }) => runLegacyColdContext({
        contextIndex,
        executablePath: settings.executablePath,
        extensionRoot,
        fixtureText,
        sizes,
        userDataDir: path.join(temporaryRoot, `user-data-${contextIndex}`),
        warmAnnotations
      })
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function requireProfile(condition, message) {
  if (!condition) throw new Error(`invalid BrowserRuntimeProfile/v1: ${message}`);
}

function validRestartMeasurement(restart) {
  return restart && typeof restart === 'object' && restart.supported === true && restart.restarted === true &&
    Number.isFinite(restart.durationMs) && restart.durationMs >= 0 &&
    typeof restart.previousWorkerIdentity === 'string' && Boolean(restart.previousWorkerIdentity) &&
    typeof restart.restartedWorkerIdentity === 'string' && Boolean(restart.restartedWorkerIdentity) &&
    restart.previousWorkerIdentity !== restart.restartedWorkerIdentity;
}

function exactConditionTopology(samples, browserContexts, condition) {
  if (!Array.isArray(samples) || samples.length !== browserContexts) return false;
  const indexes = samples.map((sample) => sample && sample.contextIndex).sort((left, right) => left - right);
  return samples.every((sample) => sample && sample.condition === condition) &&
    indexes.every((value, index) => value === index);
}

function verifyBrowserRuntimeProfile(report) {
  requireProfile(report && typeof report === 'object' && !Array.isArray(report), 'report must be an object');
  requireProfile(report.schemaVersion === 1, 'schemaVersion must be 1');
  requireProfile(report.profileFormat === 'BrowserRuntimeProfile/v1', 'profileFormat is unsupported');
  requireProfile(typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(report.generatedAt)), 'generatedAt is invalid');
  requireProfile(report.browser && report.browser.name === 'Chromium' &&
    typeof report.browser.version === 'string' && report.browser.version.includes('Chromium'), 'actual Chromium version is required');
  requireProfile(report.host && ['os', 'cpuClass', 'memoryClass'].every((name) =>
    typeof report.host[name] === 'string' && Boolean(report.host[name])), 'host class evidence is incomplete');
  requireProfile(report.fixture && typeof report.fixture.text === 'string' && Boolean(report.fixture.text) &&
    report.fixture.languageMode === 'both', 'fixture evidence is incomplete');
  requireProfile(report.index && report.index.hashAlgorithm === 'sha256' &&
    report.index.hash === LEGACY_INDEX_HASH, 'legacy index hash does not match the v0.3.0 artifact');

  const conditions = report.conditions;
  requireProfile(conditions && conditions.cold && conditions.warm && conditions.serviceWorkerRestart,
    'cold, warm, and service-worker-restart conditions are required');
  requireProfile(Object.keys(conditions).sort().join(',') === 'cold,serviceWorkerRestart,warm',
    'condition topology is invalid');
  requireProfile(Number.isInteger(conditions.cold.browserContexts) && conditions.cold.browserContexts >= 5,
    'at least five cold browser contexts are required');
  requireProfile(exactConditionTopology(conditions.cold.samples, conditions.cold.browserContexts, 'cold'),
    'condition topology is invalid');
  for (const sample of conditions.cold.samples) {
    const measurements = assertCompleteMeasurements(sample.measurements || {});
    requireProfile(Number.isInteger(measurements.compressedBytes) && measurements.compressedBytes > 0,
      'compressedBytes must be a positive integer');
    requireProfile(Number.isInteger(measurements.uncompressedBytes) &&
      measurements.uncompressedBytes >= measurements.compressedBytes, 'uncompressedBytes is invalid');
    for (const name of TIMING_METRICS) {
      requireProfile(Number.isFinite(measurements[name]) && measurements[name] >= 0, `${name} must be a non-negative browser timing`);
    }
    requireProfile(measurements.heapPeakBytes === 'unknown' ||
      (Number.isInteger(measurements.heapPeakBytes) && measurements.heapPeakBytes >= 0),
    'heapPeakBytes must be a non-negative integer or unknown');
    const restart = measurements.serviceWorkerRestart;
    requireProfile(validRestartMeasurement(restart),
    'successful service-worker restart is required for canonical evidence');
  }

  requireProfile(Number.isInteger(conditions.warm.annotationsPerContext) &&
    conditions.warm.annotationsPerContext >= 20, 'at least twenty warm annotations per context are required');
  requireProfile(exactConditionTopology(conditions.warm.samples, conditions.cold.browserContexts, 'warm'),
    'condition topology is invalid');
  for (const sample of conditions.warm.samples) {
    requireProfile(Array.isArray(sample.samplesMs) &&
      sample.samplesMs.length >= conditions.warm.annotationsPerContext,
    'raw warm annotation samples must satisfy annotationsPerContext');
    requireProfile(sample.samplesMs.every((value) => Number.isFinite(value) && value >= 0),
      'warm annotation timings must be non-negative numbers');
  }
  requireProfile(exactConditionTopology(
    conditions.serviceWorkerRestart.samples,
    conditions.cold.browserContexts,
    'service-worker-restart'
  ), 'condition topology is invalid');
  for (const sample of conditions.serviceWorkerRestart.samples) {
    requireProfile(validRestartMeasurement(sample.result),
      'successful service-worker restart is required for canonical evidence');
  }
  return true;
}

function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0 ||
      values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('percentile values must be non-empty non-negative browser measurements');
  }
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

function evaluateShardCandidate(candidate) {
  const coldValues = candidate.conditions.cold.samples.map((sample) => sample.durationMs);
  const warmValues = candidate.conditions.warm.samples.flatMap((sample) => sample.samplesMs);
  const longTaskValues = candidate.conditions.longTasks.samples.flatMap((sample) => sample.durationsMs);
  const measurements = Object.freeze({
    coldRequiredShardsP95Ms: percentile(coldValues, 0.95),
    warmLookupP95Ms: percentile(warmValues, 0.95),
    longTaskMaxMs: longTaskValues.length ? Math.max(...longTaskValues) : 0
  });
  const gates = Object.freeze({
    coldRequiredShards: measurements.coldRequiredShardsP95Ms <= SHARD_COMPARISON_BUDGETS.coldRequiredShardsP95Ms,
    warmLookup: measurements.warmLookupP95Ms <= SHARD_COMPARISON_BUDGETS.warmLookupP95Ms,
    longTask: measurements.longTaskMaxMs <= SHARD_COMPARISON_BUDGETS.longTaskMaxMs
  });
  return Object.freeze({
    ...candidate,
    measurements,
    budgets: SHARD_COMPARISON_BUDGETS,
    gates,
    allBlockingPassed: Object.values(gates).every(Boolean)
  });
}

function selectShardCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length !== 2 ||
      candidates[0].bucketCount !== 64 || candidates[1].bucketCount !== 128) {
    throw new TypeError('shard candidates must be ordered exactly 64,128');
  }
  const selectedBucketCount = candidates[0].allBlockingPassed
    ? 64
    : (candidates[1].allBlockingPassed ? 128 : null);
  return Object.freeze({
    rule: SHARD_SELECTION_RULE,
    status: selectedBucketCount === null ? 'blocked' : 'selected',
    selectedBucketCount
  });
}

function writeTreeFiles(rootPath, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(rootPath, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function prepareShardCandidateExtension(artifacts, temporaryRoot) {
  const extensionRoot = path.join(temporaryRoot, `extension-${artifacts.manifest.bucketCount}`);
  const dataFiles = Object.fromEntries(Object.entries(artifacts.files).map(([name, content]) => [`data/${name}`, content]));
  writeTreeFiles(extensionRoot, dataFiles);
  const sharedRoot = path.join(extensionRoot, 'src', 'shared');
  fs.mkdirSync(sharedRoot, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'apps', 'extension', 'src', 'shared', 'runtime-shard-browser.js'),
    path.join(sharedRoot, 'runtime-shard-browser.js')
  );
  fs.writeFileSync(path.join(extensionRoot, 'service-worker.js'), "'use strict';\n");
  fs.writeFileSync(path.join(extensionRoot, 'profile.html'), [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<title>Halo shard comparison</title>',
    '<script src="src/shared/runtime-shard-browser.js"></script>'
  ].join('\n'));
  fs.writeFileSync(path.join(extensionRoot, 'manifest.json'), `${JSON.stringify({
    manifest_version: 3,
    name: `Halo lexical shard candidate ${artifacts.manifest.bucketCount}`,
    version: '0.4.0',
    background: { service_worker: 'service-worker.js' }
  }, null, 2)}\n`);
  return extensionRoot;
}

async function runShardColdContext(options) {
  const context = await launchExtension({
    extensionRoot: options.extensionRoot,
    userDataDir: options.userDataDir,
    headless: true,
    executablePath: options.executablePath
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(worker.url()).hostname;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/profile.html`);
    const cdpSession = await context.newCDPSession(page);
    const versionInfo = await cdpSession.send('Browser.getVersion');
    await cdpSession.detach().catch(() => {});
    const browserVersion = `Chromium ${String(versionInfo.product || '').split('/').pop()}`;
    const sample = await page.evaluate(async ({ fixtureText, warmAnnotations }) => {
      const longTasks = [];
      let observer = null;
      if (typeof PerformanceObserver === 'function' &&
          PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        observer.observe({ type: 'longtask', buffered: true });
      }
      const coldStarted = performance.now();
      const manifestResponse = await fetch(chrome.runtime.getURL('data/manifest.json'), { cache: 'no-store' });
      if (!manifestResponse.ok) throw new Error('candidate manifest fetch failed');
      const manifest = await globalThis.HaloRuntimeShardBrowser.loadBrowserLexicalManifest(await manifestResponse.text());
      const runtime = globalThis.HaloRuntimeShardBrowser.createBrowserLexicalRuntime({
        manifest,
        readText: async (resourcePath, loadOptions) => {
          const response = await fetch(chrome.runtime.getURL(`data/${resourcePath}`), {
            cache: 'no-store',
            signal: loadOptions && loadOptions.signal
          });
          if (!response.ok) throw new Error('candidate shard fetch failed');
          return response.text();
        }
      });
      const ids = runtime.requiredShardIds([fixtureText], 'both');
      await runtime.ensureShards(ids);
      const coldDurationMs = performance.now() - coldStarted;
      function lookupFixture(shards) {
        let evidenceCount = 0;
        for (const shard of shards) {
          evidenceCount += shard.lookup('models', 'en').length;
          evidenceCount += shard.lookupMorphology('learning', 'en').length;
          const match = shard.longestMatch('學生學習', 0, 'zh-Hant');
          if (match) evidenceCount += match.entries.length;
        }
        return evidenceCount;
      }
      const warmSamplesMs = [];
      let evidenceCount = 0;
      for (let index = 0; index < warmAnnotations; index += 1) {
        const started = performance.now();
        evidenceCount += runtime.withPinnedShards(ids, lookupFixture);
        warmSamplesMs.push(performance.now() - started);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (observer) observer.disconnect();
      return {
        coldDurationMs,
        warmSamplesMs,
        longTaskDurationsMs: longTasks,
        requiredShardCount: ids.length,
        evidenceCount,
        residentShardCount: runtime.status().residentCount
      };
    }, { fixtureText: options.fixtureText, warmAnnotations: options.warmAnnotations });
    return { browserVersion, ...sample };
  } finally {
    await context.close();
  }
}

function candidateSizes(artifacts) {
  const shardContents = Object.entries(artifacts.files).filter(([name]) => name.startsWith('shards/'));
  return Object.freeze({
    manifestBytes: Buffer.byteLength(artifacts.files['manifest.json']),
    totalShardBytes: shardContents.reduce((total, [, content]) => total + Buffer.byteLength(content), 0),
    totalShardGzipBytes: shardContents.reduce((total, [, content]) => total + zlib.gzipSync(content).length, 0),
    maximumShardBytes: Math.max(...shardContents.map(([, content]) => Buffer.byteLength(content)))
  });
}

async function profileShardCandidate(options) {
  const coldContexts = options.coldContexts === undefined ? 5 : options.coldContexts;
  const warmAnnotations = options.warmAnnotations === undefined ? 20 : options.warmAnnotations;
  if (!Number.isInteger(coldContexts) || coldContexts < 5 ||
      !Number.isInteger(warmAnnotations) || warmAnnotations < 20) {
    throw new Error('shard comparison requires at least five cold contexts and twenty warm lookups per context');
  }
  const coldSamples = [];
  const warmSamples = [];
  const longTaskSamples = [];
  let browserVersion = null;
  for (let contextIndex = 0; contextIndex < coldContexts; contextIndex += 1) {
    const sample = await options.runColdContext({ contextIndex, warmAnnotations });
    if (browserVersion && browserVersion !== sample.browserVersion) throw new Error('browser version changed between candidates');
    browserVersion = sample.browserVersion;
    if (!Array.isArray(sample.warmSamplesMs) || sample.warmSamplesMs.length < warmAnnotations ||
        !Array.isArray(sample.longTaskDurationsMs) || !Number.isFinite(sample.coldDurationMs)) {
      throw new Error('browser shard comparison sample is incomplete');
    }
    coldSamples.push(Object.freeze({
      condition: 'cold',
      contextIndex,
      durationMs: sample.coldDurationMs,
      requiredShardCount: sample.requiredShardCount,
      residentShardCount: sample.residentShardCount
    }));
    warmSamples.push(Object.freeze({
      condition: 'warm',
      contextIndex,
      samplesMs: Object.freeze(sample.warmSamplesMs.slice())
    }));
    longTaskSamples.push(Object.freeze({
      condition: 'long-tasks',
      contextIndex,
      durationsMs: Object.freeze(sample.longTaskDurationsMs.slice())
    }));
  }
  return evaluateShardCandidate(Object.freeze({
    bucketCount: options.artifacts.manifest.bucketCount,
    manifestHash: options.artifacts.manifest.hash,
    manifestRootHash: options.artifacts.manifest.rootHash,
    shardCount: options.artifacts.manifest.shards.length,
    sizes: candidateSizes(options.artifacts),
    browserVersion,
    conditions: Object.freeze({
      cold: Object.freeze({ browserContexts: coldContexts, samples: Object.freeze(coldSamples) }),
      warm: Object.freeze({ annotationsPerContext: warmAnnotations, samples: Object.freeze(warmSamples) }),
      longTasks: Object.freeze({ samples: Object.freeze(longTaskSamples) })
    })
  }));
}

async function runShardComparison(options) {
  const settings = options || {};
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-browser-shard-comparison-'));
  try {
    const { buildBrowserRuntimeArtifacts } = require('./build-browser-lexical-runtime');
    const candidates = [];
    let browserVersion = null;
    for (const bucketCount of [64, 128]) {
      const artifacts = buildBrowserRuntimeArtifacts({
        englishDir: path.join(__dirname, '..', 'data', 'corpora', 'princeton-wordnet-3.0'),
        chineseDir: path.join(__dirname, '..', 'data', 'corpora', 'cc-cedict-v1-2026-08-24'),
        builtAt: '2026-08-25T00:00:00.000Z',
        bucketCount
      });
      const extensionRoot = prepareShardCandidateExtension(artifacts, temporaryRoot);
      const candidate = await profileShardCandidate({
        artifacts,
        runColdContext: ({ contextIndex, warmAnnotations }) => runShardColdContext({
          contextIndex,
          executablePath: settings.executablePath,
          extensionRoot,
          fixtureText: settings.fixtureText || DEFAULT_FIXTURE_TEXT,
          userDataDir: path.join(temporaryRoot, `user-data-${bucketCount}-${contextIndex}`),
          warmAnnotations
        })
      });
      if (browserVersion && browserVersion !== candidate.browserVersion) throw new Error('browser version changed between candidates');
      browserVersion = candidate.browserVersion;
      candidates.push(candidate);
    }
    const selection = selectShardCandidate(candidates);
    return Object.freeze({
      schemaVersion: 1,
      comparisonFormat: 'BrowserLexicalShardComparison/v1',
      generatedAt: (settings.now || (() => new Date().toISOString()))(),
      browser: Object.freeze({ name: 'Chromium', version: browserVersion }),
      host: hostClasses(),
      fixture: Object.freeze({
        id: 'bilingual-required-shards-v1',
        text: settings.fixtureText || DEFAULT_FIXTURE_TEXT,
        languageMode: 'both'
      }),
      candidates: Object.freeze(candidates),
      selection
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function verifyBrowserShardComparison(report) {
  requireProfile(report && report.schemaVersion === 1 &&
    report.comparisonFormat === 'BrowserLexicalShardComparison/v1', 'shard comparison format is unsupported');
  requireProfile(typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(report.generatedAt)),
    'shard comparison generatedAt is invalid');
  requireProfile(report.browser && report.browser.name === 'Chromium' &&
    typeof report.browser.version === 'string' && report.browser.version.includes('Chromium'),
  'actual Chromium version is required');
  requireProfile(report.host && ['os', 'cpuClass', 'memoryClass'].every((name) =>
    typeof report.host[name] === 'string' && Boolean(report.host[name])), 'host class evidence is incomplete');
  requireProfile(report.fixture && report.fixture.id === 'bilingual-required-shards-v1' &&
    typeof report.fixture.text === 'string' && Boolean(report.fixture.text) &&
    report.fixture.languageMode === 'both', 'shard comparison fixture evidence is incomplete');
  requireProfile(Array.isArray(report.candidates) && report.candidates.length === 2 &&
    report.candidates[0].bucketCount === 64 && report.candidates[1].bucketCount === 128,
  'shard candidates must be ordered exactly 64,128');
  for (const candidate of report.candidates) {
    const validHash = (value) => value && value.algorithm === 'sha256' && /^[a-f0-9]{64}$/.test(value.value || '');
    requireProfile(validHash(candidate.manifestHash) && validHash(candidate.manifestRootHash),
      'candidate manifest hashes are incomplete');
    requireProfile(candidate.shardCount === candidate.bucketCount * 2,
      'candidate shard count is inconsistent');
    requireProfile(candidate.browserVersion === report.browser.version,
      'candidate browser version is inconsistent');
    requireProfile(candidate.sizes && ['manifestBytes', 'totalShardBytes', 'totalShardGzipBytes', 'maximumShardBytes']
      .every((name) => Number.isInteger(candidate.sizes[name]) && candidate.sizes[name] > 0),
    'candidate size evidence is incomplete');
    requireProfile(candidate.conditions && candidate.conditions.cold.browserContexts >= 5 &&
      candidate.conditions.cold.samples.length === candidate.conditions.cold.browserContexts,
    'candidate cold browser samples are incomplete');
    requireProfile(candidate.conditions.cold.samples.every((sample, contextIndex) =>
      sample.condition === 'cold' && sample.contextIndex === contextIndex &&
      Number.isFinite(sample.durationMs) && sample.durationMs >= 0 &&
      Number.isInteger(sample.requiredShardCount) && sample.requiredShardCount >= 0 &&
      Number.isInteger(sample.residentShardCount) && sample.residentShardCount >= 0),
    'candidate cold browser samples are incomplete');
    requireProfile(candidate.conditions.warm.annotationsPerContext >= 20 &&
      candidate.conditions.warm.samples.length === candidate.conditions.cold.browserContexts &&
      candidate.conditions.warm.samples.every((sample, contextIndex) =>
        sample.condition === 'warm' && sample.contextIndex === contextIndex &&
        sample.samplesMs.length >= candidate.conditions.warm.annotationsPerContext &&
        sample.samplesMs.every((value) => Number.isFinite(value) && value >= 0)),
    'candidate warm browser samples are incomplete');
    requireProfile(candidate.conditions.longTasks &&
      candidate.conditions.longTasks.samples.length === candidate.conditions.cold.browserContexts &&
      candidate.conditions.longTasks.samples.every((sample, contextIndex) =>
        sample.condition === 'long-tasks' && sample.contextIndex === contextIndex &&
        Array.isArray(sample.durationsMs) &&
        sample.durationsMs.every((value) => Number.isFinite(value) && value >= 0)),
    'candidate long-task browser samples are incomplete');
    const evaluated = evaluateShardCandidate(candidate);
    requireProfile(JSON.stringify(evaluated.measurements) === JSON.stringify(candidate.measurements) &&
      JSON.stringify(candidate.budgets) === JSON.stringify(SHARD_COMPARISON_BUDGETS) &&
      JSON.stringify(evaluated.gates) === JSON.stringify(candidate.gates) &&
      evaluated.allBlockingPassed === candidate.allBlockingPassed,
    'candidate gates do not match raw browser samples');
  }
  requireProfile(JSON.stringify(selectShardCandidate(report.candidates)) === JSON.stringify(report.selection),
    'shard selection does not match the fixed rule');
  return true;
}

function writeShardSelectionAdr(adrPath, comparison) {
  const selected = comparison && comparison.selection && comparison.selection.selectedBucketCount;
  if (![64, 128].includes(selected)) throw new Error('refusing to write ADR without a passing browser-selected candidate');
  const content = `# ADR-009: Browser lexical sharding\n\n` +
    `- Status: Accepted\n- Date: ${comparison.generatedAt.slice(0, 10)}\n\n` +
    `Real Chromium comparison evidence selected ${selected} buckets per language. ` +
    `Node diagnostics were not used as browser evidence.\n\n` +
    '```javascript\n' +
    'const decision = Object.freeze({\n' +
    '  candidates: Object.freeze([64, 128]),\n' +
    `  selected: ${selected},\n` +
    `  rule: '${SHARD_SELECTION_RULE}',\n` +
    "  browserProfile: 'docs/validation/v0.4.0-browser-baseline.json',\n" +
    "  comparisonEvidence: 'docs/validation/v0.4.0-browser-shard-comparison.json',\n" +
    "  manifestFormat: 'halo-browser-lexical-manifest-v1',\n" +
    "  shardFormat: 'halo-browser-lexical-shard-v1'\n" +
    '});\n```\n';
  const parent = path.dirname(adrPath);
  fs.mkdirSync(parent, { recursive: true });
  const temporaryPath = `${adrPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, content, { flag: 'wx' });
    fs.renameSync(temporaryPath, adrPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
  }
}

function parseCommandLine(args) {
  const modes = ['--write', '--verify'].filter((mode) => args.includes(mode));
  if (modes.length !== 1) throw new Error('Use exactly one of --write or --verify');
  const outputIndex = args.indexOf('--output');
  if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error('--output requires a path');
  const comparisonIndex = args.indexOf('--compare-buckets');
  const profileKind = comparisonIndex >= 0 ? 'shard-comparison' : 'legacy-baseline';
  let bucketCounts = null;
  if (comparisonIndex >= 0) {
    if (args[comparisonIndex + 1] !== '64,128') {
      throw new Error('--compare-buckets must be exactly 64,128');
    }
    bucketCounts = Object.freeze([64, 128]);
  }
  return Object.freeze({
    mode: modes[0],
    profileKind,
    bucketCounts,
    outputPath: outputIndex >= 0
      ? path.resolve(args[outputIndex + 1])
      : (profileKind === 'shard-comparison' ? DEFAULT_COMPARISON_PATH : DEFAULT_EVIDENCE_PATH)
  });
}

function writeEvidence(outputPath, report) {
  const parent = path.dirname(outputPath);
  fs.mkdirSync(parent, { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
  }
}

async function main(args) {
  const command = parseCommandLine(args);
  if (command.mode === '--verify') {
    const report = JSON.parse(fs.readFileSync(command.outputPath, 'utf8'));
    if (command.profileKind === 'shard-comparison') {
      verifyBrowserShardComparison(report);
      process.stdout.write(`Verified BrowserLexicalShardComparison/v1: ${command.outputPath}\n`);
    } else {
      verifyBrowserRuntimeProfile(report);
      process.stdout.write(`Verified BrowserRuntimeProfile/v1: ${command.outputPath}\n`);
    }
    return;
  }

  const { chromium } = require('playwright');
  const executable = resolveChromiumExecutable({
    environment: process.env,
    exists: fs.existsSync,
    playwrightExecutable: chromium.executablePath()
  });
  if (command.profileKind === 'shard-comparison') {
    const comparison = await runShardComparison({ executablePath: executable.path });
    verifyBrowserShardComparison(comparison);
    writeEvidence(command.outputPath, comparison);
    writeShardSelectionAdr(DEFAULT_SHARD_ADR_PATH, comparison);
    process.stdout.write(
      `Wrote BrowserLexicalShardComparison/v1 from ${executable.source} Chromium: ${command.outputPath}\n`
    );
  } else {
    const report = await runBrowserProfile({ executablePath: executable.path });
    verifyBrowserRuntimeProfile(report);
    writeEvidence(command.outputPath, report);
    process.stdout.write(`Wrote BrowserRuntimeProfile/v1 from ${executable.source} Chromium: ${command.outputPath}\n`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  DEFAULT_COMPARISON_PATH,
  DEFAULT_EVIDENCE_PATH,
  DEFAULT_SHARD_ADR_PATH,
  LEGACY_INDEX_HASH,
  REQUIRED_METRICS,
  SHARD_COMPARISON_BUDGETS,
  assertCompleteMeasurements,
  evaluateShardCandidate,
  instrumentLegacyRuntimeSource,
  main,
  parseCommandLine,
  percentile,
  prepareLegacyExtension,
  prepareShardCandidateExtension,
  profileShardCandidate,
  profileLegacyRuntime,
  readZipEntrySizes,
  restartServiceWorker,
  runBrowserProfile,
  runLegacyColdContext,
  runShardColdContext,
  runShardComparison,
  selectShardCandidate,
  verifyBrowserShardComparison,
  writeShardSelectionAdr,
  verifyBrowserRuntimeProfile
});
